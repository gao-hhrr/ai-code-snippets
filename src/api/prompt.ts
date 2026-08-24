// ════════════════════════════════════════════════════════
// api/prompt.ts —— AI 助手 prompt 组装：候选片段 + 对话历史 + 当前消息 → 发给模型的指令文本
// ════════════════════════════════════════════════════════
// 从 assistant.ts 拆出。设计决策见 assistant.ts 头部注释：不做意图解析、全库内容直进模型、模型自主读内容决策。
import { fmtDate } from '@/services/date'
import type { SearchSnippet, SearchFolder, AssistantTurnMessage } from './types'

// 历史消息最多保留最近 12 条（6 轮对话），防止上下文无限膨胀
const ASSISTANT_HISTORY_LIMIT = 12

// 本地检测片段是否含注释（只看开头，避开字符串/正则误报）：候选列表给模型标注"含注释/无注释"，
// 模型判断"有注释的 python"这类组合约束时看标注即可，比自己读代码猜稳定得多
// （实测纯 prompt 规则压不住：模型明知要找带注释的仍混入无注释片段）。
// 行首匹配：# 只在行首是注释（Python），CSS 颜色值 #667eea 在行中不误报。
// CSS 例外：行首 # 是 ID 选择器/色值不是注释（#main { } / #667eea），CSS 只认 /* 与 <!--。
function hasComment(code: string, language: string): boolean {
  const isCss = language.toLowerCase() === 'css'
  const pattern = isCss ? /^\s*(?:\/\/|\/\*)|<!--/m : /^\s*(?:\/\/|\/\*|#)|<!--/m
  return pattern.test(code.slice(0, 500))
}

export interface BuildAssistantPromptParams {
  // 本次召回的候选（编号只对应这些候选）
  candidates: SearchSnippet[]
  // 全量片段：历史消息里的真实 id 在此找标题
  snippets: SearchSnippet[]
  folders: SearchFolder[]
  history: AssistantTurnMessage[]
  message: string
  codeLimit: number
  // 最近两轮搜索结果的候选编号并集：追问只能在这批编号里筛
  lastSearchNums: number[]
}

export function buildAssistantPrompt(p: BuildAssistantPromptParams): string {
  const folderName = (id: string) => p.folders.find(f => f.id === id)?.name || id

  const snippetLines = p.candidates
    .map((s, i) => {
      const parts = [`${i + 1}. [${s.language}] ${s.title}`]
      const commentMark = hasComment(s.code, s.language) ? '含注释' : '无注释'
      const folderMark = s.folderIds.length > 0 ? `收藏于：${s.folderIds.map(folderName).join('、')}` : '未收藏'
      const dateMark = fmtDate(s.createdAt) ? `创建于 ${fmtDate(s.createdAt)}` : ''
      parts.push(`（${[commentMark, folderMark, dateMark].filter(Boolean).join(' · ')}）`)
      if (s.description) parts.push(`（${s.description}）`)
      return `${parts.join(' ')}\n\`\`\`\n${s.code.slice(0, p.codeLimit)}\n\`\`\``
    })
    .join('\n\n')

  const historyLines = p.history
    .filter(m => !m.divider)
    .slice(-ASSISTANT_HISTORY_LIMIT)
    .map(m => {
      if (m.role === 'user') return `[用户] ${m.content}`
      // 修改已另存为新片段：历史里必须亮出新片段——否则模型第二步"把刚才修改的放进去"只能从 searchIds
      // 关联到原片段（旧代码），新片段对它不可见（实测 bug：收藏进夹的还是修改前）
      if (m.role === 'assistant' && m.modifySavedSnippetId) {
        const saved = p.snippets.find(s => s.id === m.modifySavedSnippetId)
        if (saved) return `[助手] 我已把修改保存为新片段：「${saved.title}」`
      }
      if (m.searchIds && m.searchIds.length > 0) {
        const titles = m.searchIds.map(id => p.snippets.find(s => s.id === id)?.title || id).join('、')
        return `[助手] 找到 ${m.searchIds.length} 条：${titles}`
      }
      return `[助手] ${m.content}`
    })

  const prompt = [
    '你是「代码片段库」的 AI 助手。用户保存了一些代码片段，下面列出了本次检索到的候选片段（编号只对应这些候选），请阅读后自主判断哪些符合用户想找的。',
    `本次检索到 ${p.candidates.length} 个候选片段：`,
    '',
    snippetLines,
    ...(p.folders.length > 0 ? ['', `当前收藏夹：${p.folders.map(f => f.name).join('、')}`] : []),
    '',
    '以下是本次对话：',
    ...historyLines,
    '',
    `当前用户消息：「${p.message}」`,
    '',
    '输出前请先在思维链中按四步分析（只在思维链思考，禁止在 JSON 前输出任何文字、禁止思考写进最终输出）：',
    '① 分析请求：拆解用户诉求点（组合条件如"有注释的 python"拆成"python+含注释"）；判断是找片段/总结分析/修改代码/库操作/意图模糊/闲聊',
    '② 梳理依据：候选片段（语言/标题/描述/收藏夹/日期/注释标注）、当前收藏夹列表、对话上文中与诉求相关的信息',
    '③ 解读意图：确定动作 search / summarize / operate / ask / chat 及目标——查找/总结在编号范围 1..N 内选片段；修改（operate op:"modify"）也在编号内选片段、value 写修改需求；其他库操作按夹名或编号定位',
    '④ 构思回应：查找/总结拟 ids、note、text；修改/库操作拟 op、value、target、field；编号不重复、夹名真实，完整写进最终 JSON',
    '思考尽量简洁，寒暄等简单请求一两句带过即可，不必长篇推理。',
    '',
    '请判断用户本轮想做什么，然后调用对应的工具（tools 里的 search / summarize / operate / ask / chat 之一）：',
    '把结果放进该工具的 parameters：ids 是片段编号 1..N、note 是筛选依据/操作提醒、text 是分析、op/value/target/field/language 是操作参数（op:"modify" 时 value 是修改需求）、question 是澄清提问、reply 是寒暄回复。',
    '只调用一个工具，选择规则：明确找片段 → search；总结讲解对比 → summarize；修改代码 → operate（op:"modify"，ids 是目标片段、value 是修改需求）；删除/收藏/新建/清空/收藏夹管理/改描述语言 → operate；意图模糊（"你好""随便看看"）→ ask；与找片段无关 → chat。',
    '规则：',
    '- 用户的表达可以是任何描述：主题（"防抖""排序"）、属性（"代码量最少的""最近的""python 的""有注释的""我收藏的"）、主观感受（"看起来像随便写的"）、组合、追问。请基于片段内容自主判断，不要反问能自己判断的问题。',
    '- 用户明确表达了找片段的意图（哪怕只有属性条件"我收藏的""python 的"）就输出 search，只有完全无法判断要找什么时才输出 ask。',
    '- 否定/排除表达（"没有注释的""不含 axios 的""不带 CSS 的"）是明确的搜索意图，直接 search，即使可能没有匹配也返回空数组，不要用 ask 反问。',
    '- 能力边界：你可以「查找 + 分析 + 修改代码 + 提议库操作」。所有改动都只能提建议、绝不能直接执行——统一输出 operate（改代码 op:"modify"；删除/重命名/导出/收藏/取消收藏/新建/清空/收藏夹管理/改描述改语言为其他 op），实际写入由用户确认后由前端完成。删除、清空这类不可逆的，note 里提醒"请确认"。',
    '- 修改/库操作必须先明确目标与做法：用户只说"帮我改下代码/优化一下/改好看点"这类空泛需求、没说清改成什么样（或没说改哪个片段）→ 输出 ask 追问（如"你想把哪段代码改成什么样？"），不要臆测需求直接输出 operate op:"modify"；说清了"改哪个 + 怎么改"才输出 operate op:"modify"。',
    '- 批量操作（"把这几个删了""把这 3 个收藏到 xx"）：ids 写全所有目标编号，只操作用户明确指出的那几个；没明确说批量时 ids 只给 1 个。',
    '- 复合操作：用户一次要求做多件事（"新建收藏夹并把第 1 个放进去""把第 2 个改名为 xx 并收藏到 常用""把第 3 个从 a 夹移到 b 夹"）→ 输出 operate 并填 ops 数组，按执行顺序列出每个步骤，每步参数与单操作一致。示例：新建夹并放入 → ops: [{op:"createFolder", value:"常用"}, {op:"favorite", ids:[1], value:"常用"}]。',
    '- ops 里除 create（新建代码，只允许放第一项，表示需求含新建代码）外，其余步骤只限可逆操作：收藏/取消收藏/导出/新建收藏夹/改名/移动/改描述语言。修改代码（op:"modify"）是生成式操作，不进 ops。需求含删除/清空时不要用 ops——先做可逆部分并说明，让用户单独确认不可逆部分。',
    '- 修改代码与其他库操作同时要求（"把第 1 个改成 xx，顺便放进新建的 常用 夹"）→ 输出 ask，告诉用户分两步：先单独说"把第 x 个改成 xx"完成修改（前端会走改写流程），再单独说库操作（如"新建收藏夹 xx，把刚才的放进去"）。禁止用 ops 混入修改、禁止只做其中一部分。',
    '- op、value、target、field、language 必须写纯 JSON 字符串，直接给「favorite」「常用」这样的干净值，不要写任何 XML 标签（如 <parameter name="...">）或多余符号。',
    '- 新建/生成代码：用户要求新建片段或生成一段代码（"新建一个防抖的片段""写个冒泡排序"）→ 输出 operate create（前端生成代码 + 确认后存库）；若库里已有符合的，优先 search 找现有片段。新建代码 + 收藏夹/片段操作同时要求（"新建冒泡排序片段，再新建收藏夹 常用 放进去"）→ 输出 operate 并用 ops 完整列出：第一项 create，后面跟收藏夹/放入等步骤（如 ops:[{op:"create", value:"冒泡排序", language:"javascript"}, {op:"createFolder", value:"常用"}, {op:"favorite", value:"常用"}]），系统会提示分两步完成；禁止只做其中一部分、禁止把关键步骤只写进 note。',
    '- 清空：用户要求清空/删除全部 → 输出 operate clear（note 提醒"删除全部片段不可恢复"）。若"删除/新建"等词只是在描述要找的代码功能（"删除重复项的代码"），仍按 search 处理。',
    '- 用户说"总结/讲解/解释/对比/分析/讲讲"某个或某几个片段（"总结一下""讲讲这两个""解释下第一个""总结两个代码"）→ 输出 summarize，直接挑片段写分析，不要用 ask 反问要总结哪个；能结合上文（如上一轮结果）就挑那些。',
    '- 组合约束：一句话里有多个筛选条件（"有注释的 python""有注释的片段里有 python 的吗""我收藏的、没注释的"）时，返回的片段必须同时满足全部条件。只满足部分条件的片段一律不返回——宁可 ids 为空数组，也不要混入部分匹配的。',
    '- 追问（如"更简单点的"）结合上文对话继续筛选：上文找过防抖，本轮就只在防抖相关里找。',
    ...(p.lastSearchNums.length > 0
      ? [`- 最近两轮找到的片段编号是：${p.lastSearchNums.join('、')}。追问（"更简单点的""有注释的呢""防抖的呢"）在这些编号里筛：想继续收窄就按上一条筛；想反过来调整（"更简单/更复杂/更好看"）可以在最近两轮的结果里回退选择。不得返回这些编号以外的片段；只有明显换话题/出现新主题词时才可找其他编号。`]
      : []),
    '- 换话题：用户说"重新找/换个话题/刚才的不算/重新搜"，或当前消息的主题与上文明显不同（上文找防抖、本轮说"渐变背景"）→ 按全新搜索处理，不要继承上文条件；"不找 X 了"＝放弃上文 X，只找新主题。',
    '- 当前消息出现新主题词时默认是新需求，直接按新主题搜索；不要把它当作对上文结果的"有没有/排除"类提问（"有没有渐变背景的"＝找渐变背景，不是"上文防抖里有没有渐变背景"）。',
    '- "不找 X 了"只表示放弃 X，不要把 X 当作本轮还要搜索的目标。',
    '- 片段编号从 1 到 ' + p.candidates.length + '，不要编造不存在的编号，每个编号最多出现一次。',
    '- 只调用一个工具，调用之外不要输出任何文字。',
    '',
    '现在调用工具：'
  ].join('\n')

  return prompt
}

// 思考过程二次总结的 prompt（summarizeThinking 用）：把模型自由推理整理成固定四步文本
export function buildSummaryPrompt(reasoning: string): string {
  return [
    '以下是 AI 助手在回答前的一段思考过程（模型内部推理，可能凌乱、不完整）：',
    '```',
    reasoning.slice(0, 4000),
    '```',
    '请把这整段思考忠实整理成四步总结，严格按下面格式逐条输出：',
    '每步独占一行、以 ① ② ③ ④ 开头、编号后跟冒号，四行顺序固定、禁止省略编号或冒号，不要任何多余文字、不要 markdown 代码块：',
    '① 分析请求：用户这句话的诉求（找代码 / 总结讲解 / 修改代码 / 库操作 / 澄清 / 闲聊等）',
    '② 梳理依据：从候选片段、对话上文、收藏夹里找到了什么与诉求相关的信息',
    '③ 解读意图：判断要执行的动作（search / summarize / operate / ask / chat）及依据',
    '④ 构思回应：准备如何作答或提议',
    '要求：只概括原文确实提到的内容，不要编造原文没有的分析；每步一到两句简洁中文；某步原文没有对应内容时写「（原文未涉及）」；必须完整输出四行。'
  ].join('\n')
}
