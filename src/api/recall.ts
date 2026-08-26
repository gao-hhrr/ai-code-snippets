// ════════════════════════════════════════════════════════
// api/recall.ts —— 本地召回：两级检索第一级（从 assistant.ts 拆出）
// ════════════════════════════════════════════════════════
// recallCandidates：把全库物理缩小到候选集，模型只在候选里选（成本与库规模解耦）。
// 精确/相关的语义判断仍交给模型（见 assistant.ts 头部设计），本文件只做廉价的数据准备。
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
  // 将用户输入拆成检索token：英文完整单词、中文双字bigram
  const tokens = extractQueryTokens(query)
  // 构建收藏夹查表Map：key=收藏夹id，value=收藏夹名称，用于id转名字
  const folderName = new Map(folders.map(f => [f.id, f.name]))

  // 关键词打分召回：遍历全部片段，多字段加权算分数，得到命中的片段列表
  const hitSnippets = snippets
    .map(s => {
      // 当前片段可能归属多个收藏夹；通过folderIds查表拿到收藏夹名字，空格拼接成文本，用于检索打分
      // folderName.get(id)拿不到时（收藏夹已删除）兜底为空字符串，避免出现undefined
      const folderText = s.folderIds.map(id => folderName.get(id) || '').join(' ')
      let score = 0
      for (const t of tokens) {
        if (s.title.toLowerCase().includes(t)) score += 4        // 标题权重最高
        if (s.description.toLowerCase().includes(t)) score += 3  // 描述
        if (folderText.toLowerCase().includes(t)) score += 3    // 收藏夹名称
        if (s.language.toLowerCase().includes(t)) score += 2     // 代码语言
        if (s.code.toLowerCase().includes(t)) score += 0.5      // 代码正文权重最低，减少噪声
      }
      return { s, score }
    })
    .filter(h => h.score > 0)          // 只保留至少命中一个token的片段
    .sort((a, b) => b.score - a.score) // 分数降序，分数高排前面
    .slice(0, limit)                   // 截断数量
    .map(h => h.s)                     // 丢弃分数字段，只保留片段对象

  // 收集历史对话中AI曾经返回过的片段（histSnippets，追问优先）
  const histSnippets: SearchSnippet[] = []
  // for...of遍历history历史消息数组，m代表单条历史会话消息
  for (const m of history) {
    // m.searchIds ?? []：如果searchIds为null/undefined，兜底空数组防止循环报错
    for (const id of m.searchIds ?? []) {
      // 根据id在全片段库找到对应的片段对象
      const s = snippets.find(x => x.id === id)
      // 片段存在，并且histSnippets数组内还没有该id，才push进去，避免内部重复
      if (s && !histSnippets.some(x => x.id === s.id)) histSnippets.push(s)
    }
  }

  // 工具函数：复制数组，按创建时间倒序排序，最新创建的片段排在前面
  const byRecent = (rest: SearchSnippet[]) =>
    [...rest].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  // 工具函数：对象数组按id去重
  // 原理：Map的key具备唯一性；把片段id作为Map的key，相同id会被合并；高优先级数据必须放在数组前面
  // 注意：Set不能直接去重对象，只能去重字符串/数字基础类型
  const dedup = (arr: SearchSnippet[]) => [...new Map(arr.map(s => [s.id, s])).values()]

  // 三来源合并：优先级从高到低：历史追问片段 > 当前关键词命中片段 > 最近新增兜底片段
  // 执行去重，再截断limit条，返回最终候选片段列表交给大模型
  return dedup([...histSnippets, ...hitSnippets, ...byRecent(snippets)]).slice(0, limit)
}