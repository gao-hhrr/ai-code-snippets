// AI 助手核心：候选拼 prompt → 模型输出动作 JSON → 本地校验/分发
// 设计：不做意图解析、不做属性过滤。全库片段（标题/语言/AI 生成的人话描述/收藏夹/完整代码）
// 一次进 prompt，模型自主阅读内容决策：输出符合的编号、或澄清（ask）、或寒暄（chat）。
// 本地只做数据准备（编号、字段拼装）与结果渲染——精确/相关的判断全部交给模型读内容。
// 千奇百怪的表达（"防抖""看起来像随便写的""代码量最少的"）不需要枚举，模型自己读。
// 规模边界：库 <50 条直接全量；上量后加一级召回缩小候选（assistantTurn 接口不变）。
import { chat } from './client'
import { AIError, isAbortError } from './errors'
import type { AssistantTurnMessage, AssistantReply, OperateOp, ChatMessage, SearchSnippet, SearchFolder } from './types'
import { recallCandidates, hasComment, fmtDate } from './recall'

// 推理模型 reasoning_content 与 content 共用 max_tokens 预算：超长推理会把 content 挤空。
// 实测属性/对比类查询（"哪个代码量最少"）推理可到 3000-9000+ 字符，2000 时 content 挤空
// → JSON 解析失败 → 兜底 ask"没听明白"；4000 下正常返回。代价：仅超长推理的病理查询多烧输出 token。
const ASSISTANT_MAX_TOKENS = 4000
// 历史消息最多保留最近 12 条（6 轮对话），防止上下文无限膨胀
const ASSISTANT_HISTORY_LIMIT = 12
// 每条代码进 prompt 的长度上限：防御超长片段撑爆上下文（正常片段全量可见）
const SNIPPET_CODE_LIMIT = 3000
// 两级检索的候选上限：第一级本地关键词召回 Top N 进 prompt，成本与库规模解耦
// （全量进 prompt 在库 100-200 条时会爆 DeepSeek 上下文窗口 + 成本/首字延迟翻倍）
const RECALL_LIMIT = 25

const VALID_OPS: OperateOp[] = ['delete', 'rename', 'export', 'favorite', 'unfavorite', 'create', 'clear', 'createFolder', 'renameFolder', 'deleteFolder', 'clearFolder', 'meta']

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
    console.info('[ai-call]', last[last.length - 1])
  } catch { /* 环境不支持时忽略 */ }
}

// 模型输出偶发为空或 JSON 被截断（推理模型 max_tokens 留余量仍可能挤空 content）：
// 校验函数检测到无有效输出时重试一次，仍失败则原样返回（上层有 ask 兜底）
async function chatRetryIfEmpty(
  messages: ChatMessage[],
  maxTokens: number,
  isValid: (text: string) => boolean,
  signal?: AbortSignal,
  onRetry?: (attempt: number) => void,
  onReasoning?: (delta: string) => void,
  onChunk?: (delta: string) => void
): Promise<string> {
  let text = await chat({ messages, maxTokens, signal, onRetry, onReasoning, onChunk })
  if (!isValid(text)) text = await chat({ messages, maxTokens, signal, onRetry, onReasoning, onChunk })
  return text
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
  const prompt = [
    '以下是 AI 助手在回答前的一段思考过程（模型内部推理，可能凌乱、不完整）：',
    '```',
    text.slice(0, 4000),
    '```',
    '请把这整段思考忠实整理成四步总结，严格按下面格式逐条输出：',
    '每步独占一行、以 ① ② ③ ④ 开头、编号后跟冒号，四行顺序固定、禁止省略编号或冒号，不要任何多余文字、不要 markdown 代码块：',
    '① 分析请求：用户这句话的诉求（找代码 / 总结讲解 / 修改代码 / 库操作 / 澄清 / 闲聊等）',
    '② 梳理依据：从候选片段、对话上文、收藏夹里找到了什么与诉求相关的信息',
    '③ 解读意图：判断要执行的动作（search / summarize / modify / operate / ask / chat）及依据',
    '④ 构思回应：准备如何作答或提议',
    '要求：只概括原文确实提到的内容，不要编造原文没有的分析；每步一到两句简洁中文；某步原文没有对应内容时写「（原文未涉及）」；必须完整输出四行。'
  ].join('\n')
  try {
    const out = await chat({ messages: [{ role: 'user', content: prompt }], maxTokens: 1000, signal: opts.signal })
    const summary = out.trim()
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
  const folderName = (id: string) => folders.find(f => f.id === id)?.name || id
  // 两级检索第一级：本地关键词召回候选集（编号只对应候选，返回时映射回真实 id）
  const candidates = recallCandidates(message, snippets, folders, history, RECALL_LIMIT)
  // 候选多时压缩单条代码上限：全量 25 条 × 3000 字符 ≈ 7.5 万字符，长历史时逼近上下文/成本膨胀。
  // 按候选数自适应（总代码量封顶约 SNIPPET_CODE_LIMIT×12），候选越多每条分得越少，库内代码总量有界。
  const codeLimit = Math.min(SNIPPET_CODE_LIMIT, Math.max(800, Math.floor((SNIPPET_CODE_LIMIT * 12) / Math.max(candidates.length, 1))))
  const snippetLines = candidates
    .map((s, i) => {
      const parts = [`${i + 1}. [${s.language}] ${s.title}`]
      // 注释/收藏状态显式标注：模型判断"有注释的""我收藏的"看标注，不自己读代码/猜（未收藏必须标出，
      // 否则模型默认所有候选都算收藏——实测"我收藏的"返回全部候选，note"所有片段均收藏于默认收藏"）
      const commentMark = hasComment(s.code, s.language) ? '含注释' : '无注释'
      const folderMark = s.folderIds.length > 0 ? `收藏于：${s.folderIds.map(folderName).join('、')}` : '未收藏'
      const dateMark = fmtDate(s.createdAt) ? `创建于 ${fmtDate(s.createdAt)}` : ''
      parts.push(`（${[commentMark, folderMark, dateMark].filter(Boolean).join(' · ')}）`)
      if (s.description) parts.push(`（${s.description}）`)
      return `${parts.join(' ')}\n\`\`\`\n${s.code.slice(0, codeLimit)}\n\`\`\``
    })
    .join('\n\n')

  const historyLines = history.filter(m => !m.divider).slice(-ASSISTANT_HISTORY_LIMIT).map(m => {
    if (m.role === 'user') return `[用户] ${m.content}`
    if (m.searchIds && m.searchIds.length > 0) {
      const titles = m.searchIds.map(id => snippets.find(s => s.id === id)?.title || id).join('、')
      return `[助手] 找到 ${m.searchIds.length} 条：${titles}`
    }
    return `[助手] ${m.content}`
  })

  // 最近两轮搜索结果的候选编号并集：追问（"有注释的呢""更简单点的"）只能在这批编号里筛，
  // 模型若不知道范围，会从候选里挑"更匹配"的其他片段（用户实测 bug）。换话题/新主题才可越界。
  // 用最近两轮并集而非单轮：上一条若被收窄到极少数（如"有注释的呢"只剩 1 条），
  // "更简单点的"这类反向调整会想回退到更早那轮的结果，单轮并集挡死、模型宁返回空（实测）。
  const lastSearches = history.filter(m => m.role === 'assistant' && m.searchIds && m.searchIds.length > 0).slice(-2)
  const lastSearchNums = [...new Set(
    lastSearches.flatMap(m => m.searchIds!.map(id => candidates.findIndex(c => c.id === id) + 1).filter(n => n > 0))
  )]

  const prompt = [
    '你是「代码片段库」的 AI 助手。用户保存了一些代码片段，下面列出了本次检索到的候选片段（编号只对应这些候选），请阅读后自主判断哪些符合用户想找的。',
    `本次检索到 ${candidates.length} 个候选片段：`,
    '',
    snippetLines,
    ...(folders.length > 0 ? ['', `当前收藏夹：${folders.map(f => f.name).join('、')}`] : []),
    '',
    '以下是本次对话：',
    ...historyLines,
    '',
    `当前用户消息：「${message}」`,
    '',
    '输出前请先在思维链中按四步分析（只在思维链思考，禁止在 JSON 前输出任何文字、禁止思考写进最终输出）：',
    '① 分析请求：拆解用户诉求点（组合条件如"有注释的 python"拆成"python+含注释"）；判断是找片段/总结分析/修改代码/库操作/意图模糊/闲聊',
    '② 梳理依据：候选片段（语言/标题/描述/收藏夹/日期/注释标注）、当前收藏夹列表、对话上文中与诉求相关的信息',
    '③ 解读意图：确定动作 search / summarize / modify / operate / ask / chat 及目标——查找/总结/修改在编号范围 1..N 内选片段，库操作按夹名或编号定位',
    '④ 构思回应：查找/总结/修改拟 ids、note、text；库操作拟 op、value、target、field；编号不重复、夹名真实，完整写进最终 JSON',
    '思考尽量简洁，寒暄等简单请求一两句带过即可，不必长篇推理。',
    '',
    '请判断用户本轮想做什么，只返回一个 JSON：',
    '{"action":"search","ids":[1,3],"note":"..."} —— 用户想找片段：ids 是符合要求的片段编号，按相关度从高到低排列；用户明确说了要几个（"两个""3 个"）就输出几个；一个都不符合时输出空数组 []。note 可选：一句话说明筛选依据（如"代码最短的前 2 条"），没有可省略。',
    '{"action":"ask","question":"..."} —— 找片段的意图模糊（如只说了"你好""随便看看"），用一句话向用户确认要找什么',
    '{"action":"chat","reply":"..."} —— 与找片段无关（寒暄、闲聊、天气等），简短中文回复',
    '{"action":"summarize","ids":[1,3],"text":"..."} —— 用户想让你总结/讲解/对比分析选中的片段：ids 是被分析的片段编号（用户说了几个就几个，如"两个"就 2 个；没说明确个数就挑最相关的 1-2 个；总结整个库这类没有具体指代时可输出空数组 []）；text 是中文分析，可用 markdown（分点、加粗），要结合代码讲具体，不要空泛。',
    '{"action":"modify","ids":[1],"requirement":"改成支持 options 参数","note":"..."} —— 用户想修改已有片段的代码（"把第一个改成 xx""优化一下这段代码"）：ids 是要改的片段编号（通常 1 个，多个时选最相关的一个）；requirement 是提炼后的修改需求，要干净、具体、可执行，去掉"帮我""第一个"这类对话词；note 可选：一句提醒用户确认改动的说明（如"请确认改动后再保存"）。',
    '{"action":"operate","op":"delete","ids":[1,2,3],"note":"..."} —— 用户想删除片段（"把第一个删了""把这几个删了""删掉这三条"）：ids 是要删的编号（1 个或多个），note 提醒"删除不可恢复"。只能提议，绝不直接删。',
    '{"action":"operate","op":"rename","ids":[1],"value":"新标题","note":"..."} —— 用户想重命名（"把第一个改名叫 xx"）：value 是新的完整标题。',
    '{"action":"operate","op":"export","ids":[1]} —— 用户想导出某片段（"导出第一个""下载下来"）。',
    '{"action":"operate","op":"favorite","ids":[1,2],"value":"收藏夹名"} —— 用户想收藏到收藏夹（"把第一个收藏到 xx""把这几个收藏到 xx"）：ids 是编号（1 个或多个），value 是收藏夹名，只能选候选标注里出现过的「收藏于：xx」夹名、当前收藏夹列表里的夹名，或用户明确说的夹名。',
    '{"action":"operate","op":"unfavorite","ids":[1,2],"value":"收藏夹名"} —— 用户想从某夹取消收藏（"把第一个移出 xx 夹""把这几个移出 xx 夹"）：ids 是编号（1 个或多个）。',
    '{"action":"operate","op":"create","value":"标题或需求","language":"javascript","note":"..."} —— 用户想新建/生成一个代码片段（"新建一个防抖的片段""写个冒泡排序"）：value 是片段标题或一句话需求，language 是语言（javascript/python/css 等）。不需要 ids。前端会生成代码给你确认，确认后才存库。',
    '{"action":"operate","op":"clear","note":"..."} —— 用户想清空/删除全部片段（"清空""全部删掉"）：不需要 ids，note 提醒"将删除全部片段，不可恢复"。',
    '{"action":"operate","op":"createFolder","value":"常用"} —— 用户想新建一个收藏夹（"新建一个收藏夹叫 常用""建个夹叫 xx"）：value 是新夹名，不需要 ids。',
    '{"action":"operate","op":"renameFolder","value":"工作","target":"学习"} —— 用户想给收藏夹改名（"把 学习 夹改名叫 工作"）：value 是新夹名，target 是当前夹名（从「当前收藏夹」列表里选）。',
    '{"action":"operate","op":"deleteFolder","value":"学习","note":"..."} —— 用户想删除一个收藏夹（"把 学习 夹删了"）：value 是夹名，note 提醒"片段不会被删除，只是移出该夹"。',
    '{"action":"operate","op":"clearFolder","value":"学习","note":"..."} —— 用户想清空一个收藏夹（"清空 学习 夹"）：value 是夹名，note 提醒"只移出该夹，片段不会被删除"。',
    '{"action":"operate","op":"meta","ids":[1],"field":"description","value":"防抖按钮"} —— 用户想改某片段的描述或语言（"把第一个的描述改成 xx""把第一个的语言改成 python"）：ids 是目标编号（1 个），field 是 description 或 language，value 是新值。',
    '规则：',
    '- 用户的表达可以是任何描述：主题（"防抖""排序"）、属性（"代码量最少的""最近的""python 的""有注释的""我收藏的"）、主观感受（"看起来像随便写的"）、组合、追问。请基于片段内容自主判断，不要反问能自己判断的问题。',
    '- 用户明确表达了找片段的意图（哪怕只有属性条件"我收藏的""python 的"）就输出 search，只有完全无法判断要找什么时才输出 ask。',
    '- 否定/排除表达（"没有注释的""不含 axios 的""不带 CSS 的"）是明确的搜索意图，直接 search，即使可能没有匹配也返回空数组，不要用 ask 反问。',
    '- 能力边界：你可以「查找 + 分析 + 修改代码 + 提议库操作」。所有改动都只能提建议、绝不能直接执行——修改输出 modify，库操作（删除/重命名/导出/收藏/取消收藏/新建/清空/收藏夹管理/改描述改语言）输出 operate，实际写入由用户确认后由前端完成。删除、清空这类不可逆的，note 里提醒"请确认"。',
    '- 批量操作（"把这几个删了""把这 3 个收藏到 xx"）：ids 写全所有目标编号，只操作用户明确指出的那几个；没明确说批量时 ids 只给 1 个。',
    '- 新建/生成代码：用户要求新建片段或生成一段代码（"新建一个防抖的片段""写个冒泡排序"）→ 输出 operate create（前端生成代码 + 确认后存库）；若库里已有符合的，优先 search 找现有片段。',
    '- 清空：用户要求清空/删除全部 → 输出 operate clear（note 提醒"删除全部片段不可恢复"）。若"删除/新建"等词只是在描述要找的代码功能（"删除重复项的代码"），仍按 search 处理。',
    '- 用户说"总结/讲解/解释/对比/分析/讲讲"某个或某几个片段（"总结一下""讲讲这两个""解释下第一个""总结两个代码"）→ 输出 summarize，直接挑片段写分析，不要用 ask 反问要总结哪个；能结合上文（如上一轮结果）就挑那些。',
    '- 组合约束：一句话里有多个筛选条件（"有注释的 python""有注释的片段里有 python 的吗""我收藏的、没注释的"）时，返回的片段必须同时满足全部条件。只满足部分条件的片段一律不返回——宁可 ids 为空数组，也不要混入部分匹配的。',
    '- 追问（如"更简单点的"）结合上文对话继续筛选：上文找过防抖，本轮就只在防抖相关里找。',
    ...(lastSearchNums.length > 0
      ? [`- 最近两轮找到的片段编号是：${lastSearchNums.join('、')}。追问（"更简单点的""有注释的呢""防抖的呢"）在这些编号里筛：想继续收窄就按上一条筛；想反过来调整（"更简单/更复杂/更好看"）可以在最近两轮的结果里回退选择。不得返回这些编号以外的片段；只有明显换话题/出现新主题词时才可找其他编号。`]
      : []),
    '- 换话题：用户说"重新找/换个话题/刚才的不算/重新搜"，或当前消息的主题与上文明显不同（上文找防抖、本轮说"渐变背景"）→ 按全新搜索处理，不要继承上文条件；"不找 X 了"＝放弃上文 X，只找新主题。',
    '- 当前消息出现新主题词时默认是新需求，直接按新主题搜索；不要把它当作对上文结果的"有没有/排除"类提问（"有没有渐变背景的"＝找渐变背景，不是"上文防抖里有没有渐变背景"）。',
    '- "不找 X 了"只表示放弃 X，不要把 X 当作本轮还要搜索的目标。',
    '- 片段编号从 1 到 ' + candidates.length + '，不要编造不存在的编号，每个编号最多出现一次。',
    '- 只返回 JSON，不要任何解释。',
    '',
    '输出 JSON：'
  ].join('\n')

  // 动作 JSON 校验：必须有合法的 action 字段，否则重试
  const isValidAction = (t: string) => {
    const obj = tryExtractJSON(t)
    return !!obj && (obj.action === 'search' || obj.action === 'ask' || obj.action === 'chat' || obj.action === 'summarize' || obj.action === 'modify' || obj.action === 'operate')
  }
  let text: string
  try {
    text = await chatRetryIfEmpty(
      [{ role: 'user', content: prompt }],
      ASSISTANT_MAX_TOKENS,
      isValidAction,
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

  const obj = tryExtractJSON(text) as { action?: string; ids?: unknown; note?: unknown; question?: string; reply?: string; text?: string; requirement?: string; op?: string; value?: string; language?: string; target?: string; field?: 'description' | 'language' } | null
  const action = obj?.action === 'search' || obj?.action === 'ask' || obj?.action === 'chat' || obj?.action === 'summarize' || obj?.action === 'modify' || obj?.action === 'operate' ? obj.action : 'ask'

  if (action === 'search') {
    // 编号 → 片段：去重、越界丢弃（编号对应候选集，映射回真实 id）
    const idx = Array.isArray(obj?.ids)
      ? obj.ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= candidates.length)
      : []
    const dedup = [...new Set(idx)]
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
    const idx = Array.isArray(obj?.ids)
      ? obj.ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= candidates.length)
      : []
    const dedup = [...new Set(idx)]
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
    const idx = Array.isArray(obj?.ids)
      ? obj.ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= candidates.length)
      : []
    const dedup = [...new Set(idx)]
    if (dedup.length === 0) {
      return done('ask', { action: 'ask', text: '你想修改哪个片段？告诉我是第几个，比如「把第一个改成 xx」。', ids: [], note: '' })
    }
    const requirement = typeof obj?.requirement === 'string' && obj.requirement.trim() ? obj.requirement.trim() : ''
    if (!requirement) {
      return done('ask', { action: 'ask', text: '你想怎么改这个片段？说下具体需求，比如「改成支持 options 参数」。', ids: [], note: '' })
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
      const idx = Array.isArray(obj?.ids) ? obj.ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= candidates.length) : []
      const dedup = [...new Set(idx)]
      if (dedup.length === 0) {
        return done('ask', { action: 'ask', text: '你想改哪个片段？告诉我是第几个。', ids: [], note: '' })
      }
      return done('operate', { action: 'operate', text: '', ids: dedup.slice(0, 1).map(n => candidates[n - 1].id), note, op, value, field })
    }
    const idx = Array.isArray(obj?.ids)
      ? obj.ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= candidates.length)
      : []
    const dedup = [...new Set(idx)]
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
