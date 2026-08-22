// ════════════════════════════════════════════════════════
// api/assistant.ts —— AI 助手核心：召回候选 → 模型输出动作 JSON → 本地校验/分发（5 个 function calling 工具）
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
import type { AssistantTurnMessage, AssistantReply, OperateOp, OperateStep, ChatMessage, SearchSnippet, SearchFolder } from './types'
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

// ---------- 操作分类元数据（D17：动作 × 对象，行为规则由分类推导）----------
// 13 种操作 = 9 个原子动作 × 3 个对象（片段/收藏夹/库）的矩阵（见 架构决策记录.md D17）。
// 散落的 VALID_OPS / REVERSIBLE_OPS / NON_COMPOSABLE_OPS / 校验分支 / store 的 folderOps 全由这张表推导，
// 新增操作（复制片段、导出收藏夹等）= 表里加一行，其余代码零改动。
interface OpMeta {
  action: 'create' | 'modify' | 'rename' | 'meta' | 'favorite' | 'unfavorite' | 'delete' | 'clear' | 'export'
  target: 'snippet' | 'folder' | 'library'
  reversible: boolean // 语义可逆（低风险、可撤销/可重做）
  generative: boolean // 生成式：需二次流式生成内容 + 审阅（modify/create），执行走专用流程，不进 ops 自动执行
}
const OP_META: Record<OperateOp, OpMeta> = {
  create:       { action: 'create',     target: 'snippet', reversible: false, generative: true },
  modify:       { action: 'modify',     target: 'snippet', reversible: true,  generative: true },
  rename:       { action: 'rename',     target: 'snippet', reversible: true,  generative: false },
  meta:         { action: 'meta',       target: 'snippet', reversible: true,  generative: false },
  favorite:     { action: 'favorite',   target: 'snippet', reversible: true,  generative: false },
  unfavorite:   { action: 'unfavorite', target: 'snippet', reversible: true,  generative: false },
  delete:       { action: 'delete',     target: 'snippet', reversible: false, generative: false },
  export:       { action: 'export',     target: 'snippet', reversible: true,  generative: false },
  createFolder: { action: 'create',     target: 'folder',  reversible: true,  generative: false },
  renameFolder: { action: 'rename',     target: 'folder',  reversible: true,  generative: false },
  deleteFolder: { action: 'delete',     target: 'folder',  reversible: false, generative: false },
  clearFolder:  { action: 'clear',      target: 'folder',  reversible: false, generative: false },
  clear:        { action: 'clear',      target: 'library', reversible: false, generative: false }
}
// 合法操作全集（含 modify）：单一事实源，不再散落字面量
const VALID_OPS = Object.keys(OP_META) as OperateOp[]
// 按长度倒序：长 op（unfavorite/clearFolder…）先匹配，避免 favorite 抢在 unfavorite、clear 抢在 clearFolder 前
const VALID_OPS_BY_LENGTH = [...VALID_OPS].sort((a, b) => b.length - a.length)
// 可自动执行（可逆且非生成式）：单操作 store 直接执行（不弹确认卡）；复合操作（ops）也仅限这些。
// 导出供 store 复用（单一事实源）。modify/create 因生成式（需流式生成+审阅）不在其中。
export const REVERSIBLE_OPS: OperateOp[] = VALID_OPS.filter(op => OP_META[op].reversible && !OP_META[op].generative)
// 不可进 ops 组合：不可逆需单独确认（delete/clear/deleteFolder/clearFolder）+ 生成式需审阅（modify/create）
const NON_COMPOSABLE_OPS = new Set<OperateOp>(VALID_OPS.filter(op => !OP_META[op].reversible || OP_META[op].generative))
// 收藏夹操作（按对象推导）：store/校验判断"夹操作按夹名指代、不需要片段编号"复用
export const OP_FOLDER = VALID_OPS.filter(op => OP_META[op].target === 'folder') as OperateOp[]

const ACTIONS = ['search', 'summarize', 'operate', 'ask', 'chat'] as const

// 模型偶发在 op 字段里混入 XML 工具调用残留（实测如 favorite"><parameter name="ids">[1]），
// 导致 op 校验失败、复合操作整轮掉进通用 ask。从字符串开头匹配最长的合法 op 前缀救回污染值。
function matchOp(value: unknown): OperateOp | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  for (const op of VALID_OPS_BY_LENGTH) {
    if (v.startsWith(op)) return op
  }
  return null
}

// ---------- function calling 工具注册 ----------
// 5 个动作各注册一个 tool，模型「选工具」代替「写 action 字段」。parameters 是 JSON Schema，
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
      name: 'operate',
      description: '用户想做库操作（删除/重命名/导出/收藏/取消收藏/新建/清空/收藏夹管理/改描述或语言/修改代码）。只能提议，绝不直接执行，实际写入由用户确认后前端完成。修改代码是 op:"modify"（ids=目标编号、value=修改需求，必须说清怎么改，空泛"优化一下"不算有效需求）；用户没说改哪个、或只说"帮我改下/优化一下"没说清改成什么样 → 改用 ask 澄清，不要调本工具。一条指令做多件事时用 ops 数组列出所有步骤（仅限可逆操作：收藏/取消收藏/导出/新建夹/改名/移动/改描述语言；不含修改代码与新建代码）。',
      parameters: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: VALID_OPS, description: '操作类型（单操作时用；用 ops 时忽略）' },
          ops: {
            type: 'array',
            description: '复合操作：一次要求做多件事（如「新建收藏夹并把第 1 个放进去」）时按顺序列出所有步骤；每个步骤 op/ids/value/target/field 与单操作同义；只限可逆操作，不要包含删除/清空/新建代码/修改代码',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: VALID_OPS, description: '操作类型' },
                ids: { type: 'array', items: { type: 'integer' }, description: '目标片段编号（delete/favorite/unfavorite 支持多个；新建收藏夹并放入片段时，收藏那步写要放入的编号）' },
                value: { type: 'string', description: 'rename 的新标题 / favorite、unfavorite 的收藏夹名 / 各 folder 操作的夹名 / meta 的新值' },
                target: { type: 'string', description: 'renameFolder 的旧夹名（从「当前收藏夹」里选）' },
                field: { type: 'string', enum: ['description', 'language'], description: 'meta 的目标字段' }
              },
              required: ['op']
            }
          },
          ids: { type: 'array', items: { type: 'integer' }, description: '目标片段编号（delete/favorite/unfavorite/modify 支持多个；create/clear 不需要；新建收藏夹并放入片段时，用 ops 里第二步 favorite 的 ids）' },
          value: { type: 'string', description: 'rename 的新标题 / favorite、unfavorite 的收藏夹名 / create 的标题或需求 / 各 folder 操作的夹名 / meta 的新值 / modify 的修改需求' },
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
// 各处动作（search/summarize 与 operate 各 op 的目标片段）共用同一套编号校验。
function mapValidIds(ids: unknown, max: number): number[] {
  return [...new Set(
    Array.isArray(ids) ? ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= max) : []
  )]
}

// 复合操作里混入新建代码时的引导文案：create 必须先编辑页确认保存，与收藏夹等同步操作无法一组落地。
// 模型只会把用户完整意图写进 ops，这里统一转 ask 分两步（先建代码，再建夹+放入）——
// 否则模型会随机只做其中一部分（实测：只建夹不建代码、或只建代码把收藏夹丢进 note）
const CREATE_COMBO_ASK = '新建代码需要先进入编辑页确认保存，不能和收藏夹等操作一起做。建议分两步：先单独说「新建一个 xx 的代码」保存好，再对我说「新建收藏夹 xx，把刚才的放进去」，我一步完成。'

// 修改代码 + 库操作混合请求（"把第 1 个改成 xx，顺便放进新建的 常用 夹"）引导文案：
// 与 CREATE_COMBO_ASK 同模式——modify 是生成式操作（流式生成+diff 审阅）、库操作是声明式，两类无法一组落地。
// 双保险：模型把 modify 混进 ops → NON_COMPOSABLE_OPS 整组拒转 ask；模型只挑单 op（丢弃另一半）→ hasMixedIntent 兜底。
const MODIFY_COMBO_ASK = '修改代码和收藏夹等库操作不能一步完成。建议分两步：先单独说「把要改的片段改成 xx」，确认保存好改动；再对我说「新建收藏夹 xx，把刚才的放进去」，我一步完成。'

// 混合请求本地兜底词表：模型已选 operate 时，检测用户原文是否同时含"改代码"与"库操作"意图，
// 命中说明另一半被静默丢弃 → 转 MODIFY_COMBO_ASK 分步。词表刻意保守，两处注意：
// ①「改名/重命名/改描述/改语言」是库操作（模型该走 operate），不能进 MODIFY_WORDS，否则"改名并收藏"这类
//   纯声明式复合会被误杀；
// ② 不用裸"修改/优化"——作名词/过去指代太常见（实测"新建收藏夹，把刚才修改的代码放进去"被误伤成混合请求），
//   只收主动改代码短语（改成/改一下/帮我改/修改成/优化一下…）。
// 宁可漏杀（漏了还有 prompt 规则 + validateOperateStep 双保险）也不误伤正常复合操作。
const MODIFY_WORDS = ['改成', '改一下', '改改', '帮我改', '给我改', '修改成', '修改一下', '帮我修改', '优化一下', '优化下', '重写', '重构', '换成', '精简', '美化']
const LIB_OP_WORDS = ['收藏', '新建', '放入', '放进', '夹', '重命名', '改名', '导出', '删除', '清空', '移动']
function hasMixedIntent(message: string): boolean {
  return MODIFY_WORDS.some(w => message.includes(w)) && LIB_OP_WORDS.some(w => message.includes(w))
}

// 复合操作单步校验：op 合法、参数齐全（片段编号/夹名/新值），且不是非可逆操作。
// 任一步不过 → 整组转 ask 分步，避免「建夹了但片段没放进去」这类部分执行。
function validateOperateStep(
  raw: Record<string, unknown>,
  candidates: SearchSnippet[]
): { ok: true; step: OperateStep } | { ok: false; ask: string } {
  const op = matchOp(raw.op)
  if (!op) return { ok: false, ask: '我没太理解你想做什么操作，请说清楚，比如「把第一个删了」「收藏到默认收藏」。' }
  if (NON_COMPOSABLE_OPS.has(op)) {
    // create 是「转编辑页审阅保存」的异步流程，与同步可逆操作粒度不同，专门引导分两步并给出示例说法
    if (op === 'create') {
      return { ok: false, ask: CREATE_COMBO_ASK }
    }
    // modify 是生成式操作（流式生成+diff 审阅），与声明式库操作无法一组落地，引导分步
    if (op === 'modify') {
      return { ok: false, ask: MODIFY_COMBO_ASK }
    }
    return { ok: false, ask: '这个操作包含删除/清空等不可逆步骤，需要单独确认。建议先做收藏/改名等可逆部分，删除/清空单独告诉我，我会弹确认框。' }
  }
  const value = typeof raw.value === 'string' && raw.value.trim() ? raw.value.trim() : ''
  const toIds = (ids: unknown) => mapValidIds(ids, candidates.length).map(n => candidates[n - 1].id)
  if (OP_FOLDER.includes(op)) {
    if (op === 'renameFolder') {
      const target = typeof raw.target === 'string' && raw.target.trim() ? raw.target.trim() : ''
      if (!value || !target) return { ok: false, ask: '要把哪个收藏夹改叫什么名字？比如「把 学习 夹改名叫 工作」。' }
      return { ok: true, step: { op, value, target } }
    }
    if (!value) {
      const q = op === 'createFolder' ? '新夹想叫什么名字？比如「新建一个收藏夹叫 常用」。' : op === 'deleteFolder' ? '要删哪个收藏夹？告诉我夹名。' : '要清空哪个收藏夹？告诉我夹名。'
      return { ok: false, ask: q }
    }
    return { ok: true, step: { op, value } }
  }
  if (op === 'meta') {
    const field = raw.field === 'description' || raw.field === 'language' ? raw.field : null
    if (!field || !value) return { ok: false, ask: '要改哪个片段的描述或语言？说下目标和新的值。' }
    const ids = toIds(raw.ids)
    if (ids.length === 0) return { ok: false, ask: '你想改哪个片段？告诉我是第几个。' }
    return { ok: true, step: { op, ids, value, field } }
  }
  // rename / export / favorite / unfavorite：片段操作
  const ids = toIds(raw.ids)
  if (ids.length === 0) return { ok: false, ask: '你想操作哪个片段？告诉我是第几个，比如「把第一个收藏到 常用」。' }
  if ((op === 'rename' || op === 'favorite' || op === 'unfavorite') && !value) {
    const q = op === 'rename' ? '重命名成什么标题？' : op === 'favorite' ? '收藏到哪个收藏夹？' : '从哪个收藏夹移出？'
    return { ok: false, ask: q }
  }
  return { ok: true, step: { op, ids, value: value || undefined } }
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

  if (action === 'operate') {
    // 混合请求兜底：模型选 operate 说明用户主意图是库操作，若原文还含改代码意图则被丢弃 → 转分步
    if (hasMixedIntent(message)) {
      return done('ask', { action: 'ask', text: MODIFY_COMBO_ASK, ids: [], note: '' })
    }
    // 复合操作：一次指令做多件事（建夹+放入、改名+收藏、移动等）→ 逐条校验，任一步不过转 ask 分步
    const rawOps = obj?.ops
    if (Array.isArray(rawOps) && rawOps.length > 0) {
      const rawStepList = rawOps as Record<string, unknown>[]
      // 新建代码 + 收藏夹等混在一组：create 可能在任意位置（模型实测会放中间/末尾），先整组判定，
      // 统一转 CREATE_COMBO_ASK 分步——避免逐条校验只卡住 create 而让收藏夹步骤先行部分执行
      if (rawStepList.length > 1 && rawStepList.some(s => matchOp(s.op) === 'create')) {
        return done('ask', { action: 'ask', text: CREATE_COMBO_ASK, ids: [], note: '' })
      }
      const steps: OperateStep[] = []
      for (const raw of rawStepList) {
        const v = validateOperateStep(raw, candidates)
        if (!v.ok) {
          return done('ask', { action: 'ask', text: v.ask, ids: [], note: '' })
        }
        steps.push(v.step)
      }
      return done('operate', {
        action: 'operate',
        text: '',
        ids: [],
        note: typeof obj?.note === 'string' && obj.note.trim() ? obj.note.trim() : '',
        ops: steps
      })
    }
    const op = matchOp(obj?.op)
    if (!op) {
      return done('ask', { action: 'ask', text: '我没太理解你想做什么操作，请说清楚，比如「把第一个删了」「收藏到默认收藏」。', ids: [], note: '' })
    }
    const note = typeof obj?.note === 'string' && obj.note.trim() ? obj.note.trim() : ''
    // clear / create 不需要目标片段编号
    if (op === 'clear') {
      return done('operate', { action: 'operate', text: '', ids: [], note, op })
    }
    const value = typeof obj?.value === 'string' && obj.value.trim() ? obj.value.trim() : ''
    // 修改代码（op:'modify'，归入 operate 的单操作）：校验目标编号 + 具体需求；
    // 空泛需求本地兜底：只说"优化/改进/美化"没说清改成什么样 → 转 ask，别让模型臆测需求白跑一次慢修改。
    // 词表刻意保守、限定长度，避免误杀"改成红色主题"这类短但具体的需求；与 prompt 规则双保险
    if (op === 'modify') {
      const dedup = mapValidIds(obj?.ids, candidates.length)
      if (dedup.length === 0) {
        return done('ask', { action: 'ask', text: '你想修改哪个片段？告诉我是第几个，比如「把第一个改成 xx」。', ids: [], note: '' })
      }
      if (!value) {
        return done('ask', { action: 'ask', text: '你想怎么改这个片段？说下具体需求，比如「改成支持 options 参数」。', ids: [], note: '' })
      }
      const vagueWords = ['优化', '改进', '美化', '精简', '调整', '改一下', '优化一下', '改进一下', '美化一下', '精简一下', '修改代码', '改代码', '改好看点', '弄好看点', '改改']
      if (vagueWords.includes(value) || (value.length <= 6 && vagueWords.some(w => value.startsWith(w)))) {
        return done('ask', { action: 'ask', text: '你想把这段代码改成什么样？说下具体改法，比如「改成支持 options 参数」「精简成 20 行」。', ids: [], note: '' })
      }
      return done('operate', {
        action: 'operate',
        text: '',
        ids: dedup.map(n => candidates[n - 1].id),
        note: note || '以下是 AI 的建议改动，请确认后再保存。',
        op: 'modify',
        value
      })
    }
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
