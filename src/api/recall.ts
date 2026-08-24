// ════════════════════════════════════════════════════════
// api/recall.ts —— 本地召回与解析：两级检索第一级 + content JSON 提取降级（从 assistant.ts 拆出）
// ════════════════════════════════════════════════════════
// recallCandidates：把全库物理缩小到候选集，模型只在候选里选（成本与库规模解耦）；
//   tryExtractJSON：模型未走工具、content 直出 JSON 时的降级解析（assistantTurn 兜底用）。
// 精确/相关的语义判断仍交给模型（见 assistant.ts 头部设计），本文件只做廉价的数据准备与解析恢复。
import type { SearchSnippet, SearchFolder, AssistantTurnMessage } from './types'

// 从模型输出中提取 JSON 对象：括号配平扫描（跳过字符串内括号与转义），
// 支持嵌套 JSON——非贪婪正则 \{\[\s\S\]*?\} 会在 {"action":"search","intent":{...}} 上提前截断
export function tryExtractJSON(text: string): Record<string, unknown> | null {
  let start = -1
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1))
          return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
        } catch {
          start = -1
        }
      }
    }
  }
  return null
}

// 从查询中提取检索 token：英文/数字整词 + 中文相邻双字（bigram）。
// 中文不分词，bigram 命中即子串包含，"渐变背景"→ 渐变/变背/背景 都命中标题"CSS 渐变背景"。
function extractQueryTokens(query: string): string[] {
  const tokens = new Set<string>()
  for (const w of query.toLowerCase().match(/[a-z0-9_]+/g) || []) tokens.add(w)
  for (const hz of query.match(/[一-鿿]+/g) || []) {
    if (hz.length >= 2) {
      for (let i = 0; i + 1 < hz.length; i++) tokens.add(hz.slice(i, i + 2))
    }
  }
  return [...tokens]
}

// 第一级召回（本地、零成本）：候选 = 上文搜索结果 + query token 命中 + 最近添加兜底，三源合并去重。
// - 上文 searchIds 排最前：追问（"有注释的呢""更简单点的"）语义是在上一轮结果里继续筛，纯召回会把
//   上文片段丢掉（用户实测 bug：性能优化 3 条后问"有注释的呢"，返回了全库其他带注释的片段）。
// - 召回命中其次：换话题/新主题（防抖上下文问"渐变背景"）由 prompt 规则兜底（全量时代实测 5/5），
//   不靠纯召回物理排除。
// - 最近添加兜底：覆盖"最近的"这类无文本特征的查询，以及否定查询（"没有注释的"——被排除的"注释"
//   命中片段 + 最近兜底混合，"无 X"本身没有文本特征可召回）。
export function recallCandidates(
  query: string,
  snippets: SearchSnippet[],
  folders: SearchFolder[],
  history: AssistantTurnMessage[],
  limit: number
): SearchSnippet[] {
  const tokens = extractQueryTokens(query)
  const folderName = new Map(folders.map(f => [f.id, f.name]))
  const hitSnippets = snippets
    .map(s => {
      const folderText = s.folderIds.map(id => folderName.get(id) || '').join(' ')
      let score = 0
      for (const t of tokens) {
        if (s.title.toLowerCase().includes(t)) score += 4
        if (s.description.toLowerCase().includes(t)) score += 3
        if (folderText.toLowerCase().includes(t)) score += 3
        if (s.language.toLowerCase().includes(t)) score += 2
        if (s.code.toLowerCase().includes(t)) score += 0.5
      }
      return { s, score }
    })
    .filter(h => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(h => h.s)

  const histSnippets: SearchSnippet[] = []
  for (const m of history) {
    for (const id of m.searchIds ?? []) {
      const s = snippets.find(x => x.id === id)
      if (s && !histSnippets.some(x => x.id === s.id)) histSnippets.push(s)
    }
  }

  const byRecent = (rest: SearchSnippet[]) =>
    [...rest].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  const dedup = (arr: SearchSnippet[]) => [...new Map(arr.map(s => [s.id, s])).values()]
  return dedup([...histSnippets, ...hitSnippets, ...byRecent(snippets)]).slice(0, limit)
}
