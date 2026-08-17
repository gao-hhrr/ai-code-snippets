// 第一级本地召回：query token 提取 + 注释/日期标注 + 候选组装（零成本，不进模型）
import type { SearchSnippet, SearchFolder, AssistantTurnMessage } from './types'

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

// 本地检测片段是否含注释（只看开头，避开字符串/正则误报）：候选列表给模型标注"含注释/无注释"，
// 模型判断"有注释的 python"这类组合约束时看标注即可，比自己读代码猜稳定得多
// （实测纯 prompt 规则压不住：模型明知要找带注释的仍混入无注释片段）。
// 行首匹配：# 只在行首是注释（Python），CSS 颜色值 #667eea 在行中不误报。
// CSS 例外：行首 # 是 ID 选择器/色值不是注释（#main { } / #667eea），CSS 只认 /* 与 <!--。
export function hasComment(code: string, language: string): boolean {
  const isCss = language.toLowerCase() === 'css'
  const pattern = isCss ? /^\s*(?:\/\/|\/\*)|<!--/m : /^\s*(?:\/\/|\/\*|#)|<!--/m
  return pattern.test(code.slice(0, 500))
}

// 创建日期标注（M/D）：候选行给模型看日期，让它能判断"最近添加的/最新的"这类无文本特征的查询。
// 没有日期信息时模型无从比较新旧，实测"最近添加的"返回空、"最新的那个"反问（都因无法判断而放弃）。
export function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // 跨年（非今年）的日期带上年份，避免"创建于 5/12"分不清是哪年
  if (d.getFullYear() !== new Date().getFullYear()) {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
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
