// ════════════════════════════════════════════════════════
// api/assistant.ts —— AI 助手核心：召回候选 → 模型输出动作 JSON → 本地校验/分发（6 个 function calling 工具）
// ════════════════════════════════════════════════════════
// 设计：不做意图解析、不做属性过滤。全库片段（标题/语言/AI 生成的人话描述/收藏夹/完整代码）
// 一次进 prompt，模型自主阅读内容决策：输出符合的编号、或澄清（ask）、或寒暄（chat）。
// 本地只做数据准备（编号、字段拼装）与结果渲染——精确/相关的判断全部交给模型读内容。
// 千奇百怪的表达（"防抖""看起来像随便写的""代码量最少的"）不需要枚举，模型自己读。
// 规模边界：库 <50 条直接全量；上量后加一级召回缩小候选（assistantTurn 接口不变）。
// prompt 组装逻辑在 assistantPrompt.ts（本文件只保留数据准备与校验/分发）。
import { chat } from './client'
import { AIError, isAbortError } from './client'
import type { ChatResult, ChatTool } from './client'
import type { AssistantTurnMessage, AssistantReply, OperateOp, ChatMessage, SearchSnippet, SearchFolder } from './types'
import { buildAssistantPrompt, buildSummaryPrompt } from './assistantPrompt'

// 推理模型 reasoning_content 与 content 共用 max_tokens 预算：超长推理会把 content 挤空。
// 实测属性/对比类查询（"哪个代码量最少"）推理可到 3000-9000+ 字符，2000 时 content 挤空
// → JSON 解析失败 → 兜底 ask"没听明白"；4000 下正常返回。代价：仅超长推理的病理查询多烧输出 token。
const ASSISTANT_MAX_TOKENS = 4000
// 每条代码进 prompt 的长度上限：防御超长片段撑爆上下文（正常片段全量可见）
const SNIPPET_CODE_LIMIT = 3000
// 两级检索的候选上限：第一级本地关键词召回 Top N 进 prompt，成本与库规模解耦
// （全量进 prompt 在库 100-200 条时会爆 DeepSeek 上下文窗口 + 成本/首字延迟翻倍）
const RECALL_LIMIT = 25

const VALID_OPS: OperateOp[] = ['delete', 'rename', 'export', 'favorite', 'unfavorite', 'create', 'clear', 'createFolder', 'renameFolder', 'deleteFolder', 'clearFolder', 'meta']
const ACTIONS = ['search', 'summarize', 'modify', 'operate', 'ask', 'chat'] as const

// ---------- function calling 工具注册 ----------
// 6 个动作各注册一个 tool，模型「选工具」代替「写 action 字段」。parameters 是 JSON Schema，
// 模型产出的 arguments 由 API 协议保证为合法 JSON——替代手写 tryExtractJSON（截断/嵌套/转义不再怕）。
// 行为规则（追问范围、否定查询、组合约束、能力边界）仍写在 prompt 里，Schema 只负责形状。
const ASSISTANT_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'search',
      description: '用户想找代码片段。ids 是符合要求的片段编号（按相关度从高到低排列）；用户明确说了要几个就输出几个；一个都不符合时输出空数组。note 可一句话说明筛选依据。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, description: '符合要求的片段编号 1..N' },
          note: { type: 'string', description: '可选：一句话说明筛选依据，如「代码最短的前 2 条」' }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize',
      description: '用户想让你总结/讲解/对比分析选中的片段。ids 是被分析的编号，text 是中文分析（可用 markdown）。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, description: '被分析的片段编号：用户说了几个就几个，没说明确个数挑最相关的 1-2 个，总结整个库这类无具体指代时给空数组' },
          text: { type: 'string', description: '中文分析，可用 markdown（分点、加粗），要结合代码讲具体，不要空泛' }
        },
        required: ['ids', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'modify',
      description: '用户明确说了要修改已有片段的代码，且说清了改哪个 + 具体怎么改（"把第一个改成支持 options 参数"）。若没说改哪个片段、或只说"帮我改下/优化一下"这类空泛需求没说清改成什么样 → 不要调用本工具，改用 ask 澄清。只能提议，绝不直接改。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, description: '要修改的片段编号，通常 1 个' },
          requirement: { type: 'string', description: '提炼后的修改需求，必须包含具体改法（改成什么样/加什么能力/怎么调整），去掉「帮我」「第一个」这类对话词；空泛的"优化/改进"不算有效需求' },
          note: { type: 'string', description: '可选：一句提醒用户确认改动的说明' }
        },
        required: ['ids', 'requirement']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'operate',
      description: '用户想做库结构操作（删除/重命名/导出/收藏/取消收藏/新建/清空/收藏夹管理/改描述或语言）。只能提议，绝不直接执行，实际写入由用户确认后前端完成。',
      parameters: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: VALID_OPS, description: '操作类型' },
          ids: { type: 'array', items: { type: 'integer' }, description: '目标片段编号（delete/favorite/unfavorite 支持多个；create/clear/收藏夹类不需要）' },
          value: { type: 'string', description: 'rename 的新标题 / favorite、unfavorite 的收藏夹名 / create 的标题或需求 / 各 folder 操作的夹名 / meta 的新值' },
          target: { type: 'string', description: 'renameFolder 的旧夹名（从「当前收藏夹」里选）' },
          field: { type: 'string', enum: ['description', 'language'], description: 'meta 的目标字段' },
          language: { type: 'string', description: 'create 的代码语言' },
          note: { type: 'string', description: '可选：操作提醒（删除/清空等不可逆操作提醒「请确认」）' }
        },
        required: ['op']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask',
      description: '用户想找片段但意图模糊（只说了"你好""随便看看"），用一句话向用户确认要找什么。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '确认要找什么的一句话提问' }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'chat',
      description: '与找片段无关（寒暄、闲聊、天气等），简短中文回复。',
      parameters: {
        type: 'object',
        properties: {
          reply: { type: 'string', description: '简短中文回复' }
        },
        required: ['reply']
      }
    }
  }
]

// 从模型输出中提取 JSON 对象：括号配平扫描（跳过字符串内括号与转义），
// 支持嵌套 JSON——非贪婪正则 \{\[\s\S\]*?\} 会在 {"action":"search","intent":{...}} 上提前截断
function tryExtractJSON(text: string): Record<string, unknown> | null {
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

// 每轮助手调用的本地诊断日志（localStorage 环形 100 条 + console）：记录候选数/prompt 大小/耗时/结果。
// 调试者 F12 看 console，或读 localStorage 的 ai-call-log 复盘；Node 环境无 localStorage 时静默跳过。
interface AiCallLog {
  t: string
  action: string
  candidates: number
  promptChars: number
  ms: number
  errCode?: string
  errMsg?: string
}
function logAiCall(entry: Omit<AiCallLog, 't' | 'ms'> & { ms: number }) {
  try {
    const key = 'ai-call-log'
    const list: AiCallLog[] = JSON.parse(localStorage.getItem(key) || '[]')
    list.push({ t: new Date().toISOString(), ...entry })
    const last = list.slice(-100)
    localStorage.setItem(key, JSON.stringify(last))
    // 正常调用只沉淀到 localStorage（排障数据不丢）；出错才在 console 出声，控制台保持干净
    if (entry.errCode) console.warn('[ai-call]', last[last.length - 1])
  } catch { /* 环境不支持时忽略 */ }
}

// 模型输出偶发无效（无工具调用 / content 空 / JSON 被截断）：校验函数检测到无有效输出时重试一次，
// 仍失败则原样返回（上层有 ask 兜底）。带 tools：模型按 function calling 返回结构化工具调用。
async function chatRetryIfEmpty(
  messages: ChatMessage[],
  maxTokens: number,
  isValid: (res: ChatResult) => boolean,
  signal?: AbortSignal,
  onRetry?: (attempt: number) => void,
  onReasoning?: (delta: string) => void,
  onChunk?: (delta: string) => void
): Promise<ChatResult> {
  let res = await chat({ messages, maxTokens, tools: ASSISTANT_TOOLS, signal, onRetry, onReasoning, onChunk })
  if (!isValid(res)) res = await chat({ messages, maxTokens, tools: ASSISTANT_TOOLS, signal, onRetry, onReasoning, onChunk })
  return res
}

// 模型输出编号 → 候选下标：去重、丢弃越界/非整数（编号对应候选集，返回时映射回真实 id）。
// 五处动作（search/summarize/modify/operate/meta）共用同一套校验。
function mapValidIds(ids: unknown, max: number): number[] {
  return [...new Set(
    Array.isArray(ids) ? ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= max) : []
  )]
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
function recallCandidates(
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

// ---------- 能力边界 ----------
// 库操作（删除/重命名/收藏/导出/新建/清空）与代码生成已全部放行：AI 一律输出 operate 提议，
// 由用户在看确认卡后手动确认，前端才真正落库。安全性不再靠本地物理拦截，而是靠「提议不执行 +
// 确认卡分级确认」（删除弹确认框、清空加重警告）。

// 思考过程二次总结（独立调用、非流式）：把模型自由推理的 reasoning_content 整理成固定四步文本
// （① 分析请求 ② 梳理依据 ③ 解读意图 ④ 构思回应，每步一行），结果出来后折叠「AI 思考过程」展示。
// 这是增值功能：失败/超时/思考太短一律返回 null，上层兜底展示原文，绝不影响主流程。
// 调用方：store 在消息 push 后后台补全（不阻塞主回复显示，见 backfillSummary）；assistantTurn 主流程不再调用。
export async function summarizeThinking(
  reasoning: string,
  opts: { signal?: AbortSignal } = {}
): Promise<string | null> {
  const text = reasoning.trim()
  if (text.length < 30) return null
  const prompt = buildSummaryPrompt(text)
  try {
    const res = await chat({ messages: [{ role: 'user', content: prompt }], maxTokens: 1000, signal: opts.signal })
    const summary = res.content.trim()
    return summary.length >= 10 ? summary : null
  } catch {
    return null
  }
}

// 助手对话轮次：历史 + 当前消息 + 全库片段 → 模型一次调用完成
// "动作判断 + 自主分析"——无任何本地过滤/排序逻辑
export async function assistantTurn(
  history: AssistantTurnMessage[],
  message: string,
  snippets: SearchSnippet[],
  folders: SearchFolder[],
  opts: { signal?: AbortSignal; onRetry?: (attempt: number) => void; onReasoning?: (delta: string) => void; onChunk?: (delta: string) => void } = {}
): Promise<AssistantReply> {
  const startedAt = Date.now()
  // 空库短路：没有任何片段时查找/分析都是空转，直接提示，不白跑模型
  if (snippets.length === 0) {
    logAiCall({ action: 'chat', candidates: 0, promptChars: 0, ms: Date.now() - startedAt })
    return { action: 'chat', text: '你的代码库还是空的——先在侧边栏点「新建片段」保存几段代码，我才能帮你查找和分析。', ids: [], note: '' }
  }
  // 每个 return 出口统一记一条诊断日志，errCode 用于调试者定位
  const done = (action: string, reply: AssistantReply, errCode?: string, errMsg?: string) => {
    logAiCall({ action, candidates: candidates.length, promptChars: prompt.length, ms: Date.now() - startedAt, errCode, errMsg })
    return { ...reply }
  }
  // 两级检索第一级：本地关键词召回候选集（编号只对应候选，返回时映射回真实 id）
  const candidates = recallCandidates(message, snippets, folders, history, RECALL_LIMIT)
  // 候选多时压缩单条代码上限：全量 25 条 × 3000 字符 ≈ 7.5 万字符，长历史时逼近上下文/成本膨胀。
  // 按候选数自适应（总代码量封顶约 SNIPPET_CODE_LIMIT×12），候选越多每条分得越少，库内代码总量有界。
  const codeLimit = Math.min(SNIPPET_CODE_LIMIT, Math.max(800, Math.floor((SNIPPET_CODE_LIMIT * 12) / Math.max(candidates.length, 1))))

  // 最近两轮搜索结果的候选编号并集：追问（"有注释的呢""更简单点的"）只能在这批编号里筛，
  // 模型若不知道范围，会从候选里挑"更匹配"的其他片段（用户实测 bug）。换话题/新主题才可越界。
  // 用最近两轮并集而非单轮：上一条若被收窄到极少数（如"有注释的呢"只剩 1 条），
  // "更简单点的"这类反向调整会想回退到更早那轮的结果，单轮并集挡死、模型宁返回空（实测）。
  const lastSearches = history.filter(m => m.role === 'assistant' && m.searchIds && m.searchIds.length > 0).slice(-2)
  const lastSearchNums = [...new Set(
    lastSearches.flatMap(m => m.searchIds!.map(id => candidates.findIndex(c => c.id === id) + 1).filter(n => n > 0))
  )]

  const prompt = buildAssistantPrompt({ candidates, snippets, folders, history, message, codeLimit, lastSearchNums })

  // 合法响应：有已识别的工具调用，或 content 里能解析出合法动作 JSON（模型未走工具时的降级路径）
  const isValidResult = (r: ChatResult) => {
    const tc = r.toolCalls?.[0]
    if (tc && (ACTIONS as readonly string[]).includes(tc.name)) return true
    const obj = tryExtractJSON(r.content)
    return !!obj && (ACTIONS as readonly string[]).includes(String(obj.action))
  }
  let result: ChatResult
  try {
    result = await chatRetryIfEmpty(
      [{ role: 'user', content: prompt }],
      ASSISTANT_MAX_TOKENS,
      isValidResult,
      opts.signal,
      opts.onRetry,
      opts.onReasoning,
      opts.onChunk
    )
  } catch (err) {
    if (isAbortError(err)) throw err
    // chat 已抛出具体原因（503 过载/400 上下文超限等），透传给 UI 展示，不吞成笼统文案
    if (err instanceof AIError) {
      logAiCall({ action: 'error', candidates: candidates.length, promptChars: prompt.length, ms: Date.now() - startedAt, errCode: err.code, errMsg: err.message })
      throw err
    }
    logAiCall({ action: 'error', candidates: candidates.length, promptChars: prompt.length, ms: Date.now() - startedAt, errCode: 'ERR_FALLBACK', errMsg: String(err) })
    throw new AIError('AI 助手请求失败，请重试', 'ERR_FALLBACK')
  }

  // 动作对象统一成 {action, ids, note, ...} 形状：优先取工具调用（name=动作、arguments=参数），
  // 模型未走工具（content 直出 JSON）时降级用 tryExtractJSON。下方分发逻辑与之前完全一致。
  const tc = result.toolCalls?.[0]
  const obj: Record<string, unknown> = tc
    ? { action: tc.name, ...tc.arguments }
    : (tryExtractJSON(result.content) as Record<string, unknown> | null) || {}
  const action = typeof obj.action === 'string' && (ACTIONS as readonly string[]).includes(obj.action) ? obj.action : 'ask'

  if (action === 'search') {
    // 编号 → 片段：去重、越界丢弃（编号对应候选集，映射回真实 id）
    const dedup = mapValidIds(obj?.ids, candidates.length)
    if (dedup.length === 0) {
      return done('search', { action: 'search', text: '', ids: [], note: '没有找到与你的描述相符的片段' })
    }
    const note = typeof obj?.note === 'string' && obj.note.trim() ? obj.note.trim() : ''
    return done('search', {
      action: 'search',
      text: '',
      ids: dedup.map(n => candidates[n - 1].id),
      note
    })
  }

  if (action === 'summarize') {
    const dedup = mapValidIds(obj?.ids, candidates.length)
    const summary = typeof obj?.text === 'string' && obj.text.trim()
      ? obj.text.trim()
      : dedup.length > 0
        ? `以下是这 ${dedup.length} 个片段的总结：`
        : '我没有找到可总结的片段。'
    return done('summarize', {
      action: 'summarize',
      text: summary,
      ids: dedup.map(n => candidates[n - 1].id),
      note: ''
    })
  }

  if (action === 'modify') {
    // 目标片段编号：通常 1 个；多取只改第一个（首版锁定单片段，改完看效果再扩展）
    const dedup = mapValidIds(obj?.ids, candidates.length)
    if (dedup.length === 0) {
      return done('ask', { action: 'ask', text: '你想修改哪个片段？告诉我是第几个，比如「把第一个改成 xx」。', ids: [], note: '' })
    }
    const requirement = typeof obj?.requirement === 'string' && obj.requirement.trim() ? obj.requirement.trim() : ''
    if (!requirement) {
      return done('ask', { action: 'ask', text: '你想怎么改这个片段？说下具体需求，比如「改成支持 options 参数」。', ids: [], note: '' })
    }
    // 空泛需求本地兜底：只说"优化/改进/美化"没说清改成什么样 → 转 ask，别让模型臆测需求白跑一次慢修改。
    // 词表刻意保守、限定长度，避免误杀"改成红色主题"这类短但具体的需求；与 prompt 规则双保险
    const vagueWords = ['优化', '改进', '美化', '精简', '调整', '改一下', '优化一下', '改进一下', '美化一下', '精简一下', '修改代码', '改代码', '改好看点', '弄好看点', '改改']
    if (vagueWords.includes(requirement) || (requirement.length <= 6 && vagueWords.some(w => requirement.startsWith(w)))) {
      return done('ask', { action: 'ask', text: '你想把这段代码改成什么样？说下具体改法，比如「改成支持 options 参数」「精简成 20 行」。', ids: [], note: '' })
    }
    const note = typeof obj?.note === 'string' && obj.note.trim()
      ? obj.note.trim()
      : '以下是 AI 的建议改动，请确认后再保存。'
    const replyText = typeof obj?.text === 'string' && obj.text.trim()
      ? obj.text.trim()
      : `好的，我来修改第 ${dedup[0]} 个片段，改完给你确认。`
    return done('modify', {
      action: 'modify',
      text: replyText,
      ids: dedup.map(n => candidates[n - 1].id),
      note,
      requirement
    })
  }

  if (action === 'operate') {
    const op = typeof obj?.op === 'string' && (VALID_OPS as string[]).includes(obj.op) ? (obj.op as OperateOp) : null
    if (!op) {
      return done('ask', { action: 'ask', text: '我没太理解你想做什么操作，请说清楚，比如「把第一个删了」「收藏到默认收藏」。', ids: [], note: '' })
    }
    const note = typeof obj?.note === 'string' && obj.note.trim() ? obj.note.trim() : ''
    // clear / create 不需要目标片段编号
    if (op === 'clear') {
      return done('operate', { action: 'operate', text: '', ids: [], note, op })
    }
    const value = typeof obj?.value === 'string' && obj.value.trim() ? obj.value.trim() : ''
    if (op === 'create') {
      if (!value) {
        return done('ask', { action: 'ask', text: '你想新建什么样的代码？说一下需求或标题，比如「新建一个防抖的片段」。', ids: [], note: '' })
      }
      const language = typeof obj?.language === 'string' && obj.language.trim() ? obj.language.trim() : ''
      return done('operate', { action: 'operate', text: '', ids: [], note, op, value, language })
    }
    // 收藏夹类操作与改描述/语言：按夹名/value 指代，不需要通用片段编号流程
    if (op === 'createFolder' || op === 'deleteFolder' || op === 'clearFolder') {
      if (!value) {
        const q = op === 'createFolder' ? '新夹想叫什么名字？比如「新建一个收藏夹叫 常用」。' : op === 'deleteFolder' ? '要删哪个收藏夹？告诉我夹名。' : '要清空哪个收藏夹？告诉我夹名。'
        return done('ask', { action: 'ask', text: q, ids: [], note: '' })
      }
      return done('operate', { action: 'operate', text: '', ids: [], note, op, value })
    }
    if (op === 'renameFolder') {
      const target = typeof obj?.target === 'string' && obj.target.trim() ? obj.target.trim() : ''
      if (!value || !target) {
        return done('ask', { action: 'ask', text: '要把哪个收藏夹改叫什么名字？比如「把 学习 夹改名叫 工作」。', ids: [], note: '' })
      }
      return done('operate', { action: 'operate', text: '', ids: [], note, op, value, target })
    }
    if (op === 'meta') {
      const field = obj?.field === 'description' || obj?.field === 'language' ? obj.field : null
      if (!field || !value) {
        return done('ask', { action: 'ask', text: '要改哪个片段的描述或语言？说下目标和新的值，比如「把第一个的描述改成 防抖按钮」。', ids: [], note: '' })
      }
      const dedup = mapValidIds(obj?.ids, candidates.length)
      if (dedup.length === 0) {
        return done('ask', { action: 'ask', text: '你想改哪个片段？告诉我是第几个。', ids: [], note: '' })
      }
      return done('operate', { action: 'operate', text: '', ids: dedup.slice(0, 1).map(n => candidates[n - 1].id), note, op, value, field })
    }
    const dedup = mapValidIds(obj?.ids, candidates.length)
    if (dedup.length === 0) {
      return done('ask', { action: 'ask', text: '你想操作哪个片段？告诉我是第几个，比如「把第一个删了」。', ids: [], note: '' })
    }
    if ((op === 'rename' || op === 'favorite' || op === 'unfavorite') && !value) {
      const q = op === 'rename' ? '重命名成什么标题？' : op === 'favorite' ? '收藏到哪个收藏夹？' : '从哪个收藏夹移出？'
      return done('ask', { action: 'ask', text: q, ids: [], note: '' })
    }
    return done('operate', {
      action: 'operate',
      text: '',
      ids: dedup.map(n => candidates[n - 1].id),
      note,
      op,
      value: value || undefined
    })
  }

  if (action === 'ask') {
    const question = typeof obj?.question === 'string' && obj.question.trim() ? obj.question.trim() : '没太听懂你想找什么，能再说得具体一点吗？'
    return done('ask', { action: 'ask', text: question, ids: [], note: '' })
  }

  const reply = typeof obj?.reply === 'string' && obj.reply.trim() ? obj.reply.trim() : '我在的，跟我说说你想找什么代码片段吧。'
  return done('chat', { action: 'chat', text: reply, ids: [], note: '' })
}
