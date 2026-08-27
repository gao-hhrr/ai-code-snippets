// ════════════════════════════════════════════════════════
// api/assistant.ts —— AI 助手编排主线：assistantTurn 决定"这一轮对话该干嘛"
// ════════════════════════════════════════════════════════

// ┌─ 本文件在全项目的位置 ─────────────────────────────
// store 的 send() 调用 assistantTurn() → 这里做出决策（search/summarize/operate/ask/chat）
// → 返回 AssistantReply → store 按动作分发：普通操作本地执行、create/modify 再发第二个请求
// （tasks.ts）、后台补思考总结（summarizeThinking）。本文件是"AI 对话轮次的导演"。
// └────────────────────────────────────────────────

// ┌─ 设计哲学：不猜意图，让模型读内容 ─────────────────
// 不做意图解析/属性过滤。全库片段一次进 prompt，模型自主阅读决策：输出编号、或 ask 澄清、或 chat 寒暄。
// 本地只做数据准备与结果渲染——千奇百怪的表达（"防抖""代码量最少的"）不需要枚举，模型自己读。
// └────────────────────────────────────────────────

// ┌─ 按职责拆出的兄弟模块：本文件只保留编排骨架 ──────
//   recall.ts          —— 召回与解析：recallCandidates
//   prompt.ts          —— prompt 组装：buildSystemPrompt / buildUserPrompt / buildSummaryPrompt
//   tools.ts           —— function calling 工具注册：ASSISTANT_TOOLS
//   operateMeta.ts     —— 操作分类元数据：OP_META / 推导常量 / matchOp
//   operateValidate.ts —— 操作语义校验：validateOperateStep / 分步文案 / mapValidIds
// 读法：assistantTurn 里 import 了谁，下一步就去读那个文件。
// 规模边界：候选经 recallCandidates 两级检索（第一级本地关键词召回 Top N → 第二级模型读全量候选内容）进 prompt；
// 库上量后第一级平滑升级混合检索（assistantTurn 接口不变）。
// └────────────────────────────────────────────────

import { chat } from './client'
import { AIError, isAbortError } from './client'
import type { ChatResult } from './client'
import type { AssistantTurnMessage, AssistantReply, OperateStep, ChatMessage, SearchSnippet, SearchFolder } from './types'
import { buildSystemPrompt, buildUserPrompt, buildSummaryPrompt } from './prompt'
import { matchOp } from './operateMeta'
import { validateOperateStep, mapValidIds, CREATE_COMBO_ASK } from './operateValidate'
import { recallCandidates } from './recall'
import { ASSISTANT_TOOLS } from './tools'

// ════════ 一、成本 / 质量权衡常量 ════════
// 三个都是"给多少 token / 多少候选"的预算开关——调大更准但更贵更慢，面试可讲取舍。

// 推理模型 reasoning 与 content 共用 max_tokens。D19 后主流程 content 恒为 0（completion <1300 token），
// 放开到上限 8192 成本不变（按实际输出计费），仅消除极端超长输出的截断可能（见 架构决策记录 D22）
const ASSISTANT_MAX_TOKENS = 8192
// 单条代码进 prompt 的长度上限：正常片段全量可见，超长片段截断
const SNIPPET_CODE_LIMIT = 3000
// 两级检索的候选上限：第一级本地关键词召回 Top N 进 prompt，成本/延迟解耦于库规模。
// 不因避爆而设——上下文 1M 全量实测约 1000 条才触顶；召回为省钱省延迟
const RECALL_LIMIT = 25
// 自适应代码压缩：总码量预算在候选间均分，单条下限保证每条可读
// （实测 2026-08-26：75000 预算下 N=25 时单条 3000 全量可见，深度特征（>1440 字符）搜索 0/3 → 3/3）
const TOTAL_CODE_BUDGET = 75000
const MIN_CODE_FLOOR = 800

// 模型可能输出的五种动作：本文件用它做"动作是否合法"判定（isValidResult 与 action 归一化）。
// as const 收窄成字面量类型，避免误当宽泛 string 用
const ACTIONS = ['search', 'summarize', 'operate', 'ask', 'chat'] as const

// ════════ 二、本地辅助：诊断日志 + 重试包装 ════════

// 每轮调用的本地诊断日志（localStorage 环形 100 条 + console；Node 无 localStorage 时静默跳过）
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

// 重试包装：模型输出偶发无效（无工具调用 / content 空 / JSON 截断）时重试一次——
// 污染有随机性，只给一次机会（白烧成本有上限），仍失败由上层 ask 兜底
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

// ════════ 三、辅助导出（不在主线）：思考过程二次总结 ════════

// 把自由推理的 reasoning_content 整理成固定四步文本（① 分析请求 ② 梳理依据 ③ 解读意图 ④ 构思回应），
// 结果出来后折叠「AI 思考过程」展示。增值功能：失败/超时/思考太短返回 null，上层兜底原文，绝不影响主流程
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

// ════════ 四、主流程：assistantTurn（⭐ 顺着它读零件）════════
// 一次完整决策：召回 → 组 prompt → 发请求 → 归一动作 → 五路分发。零件在兄弟模块，见文件头地图。

export async function assistantTurn(
  history: AssistantTurnMessage[],
  message: string,
  snippets: SearchSnippet[],
  folders: SearchFolder[],
  opts: { signal?: AbortSignal; onRetry?: (attempt: number) => void; onReasoning?: (delta: string) => void; onChunk?: (delta: string) => void } = {}
): Promise<AssistantReply> {
  const startedAt = Date.now()

  // ① 空库短路：没有任何片段时查找/分析都是空转，直接提示，不白跑模型
  if (snippets.length === 0) {
    logAiCall({ action: 'chat', candidates: 0, promptChars: 0, ms: Date.now() - startedAt })
    return { action: 'chat', text: '你的代码库还是空的——先在侧边栏点「新建片段」保存几段代码，我才能帮你查找和分析。', ids: [], note: '' }
  }

  // 持久 system 层（角色/规则/示例/防注入声明）：跨轮复用，见 prompt.ts buildSystemPrompt
  const system = buildSystemPrompt()

  // 每个 return 出口统一记一条诊断日志（done 收口），errCode 用于调试者定位
  const done = (action: string, reply: AssistantReply, errCode?: string, errMsg?: string) => {
    logAiCall({ action, candidates: candidates.length, promptChars: system.length + prompt.length, ms: Date.now() - startedAt, errCode, errMsg })
    return { ...reply }
  }

  // ② 第一级召回（recall.ts）：本地关键词缩小候选。编号只对应候选集，返回时映射回真实 id
  const candidates = recallCandidates(message, snippets, folders, history, RECALL_LIMIT)

  // ③ 自适应代码压缩：总码量预算在候选间均分（N≤25 单条 3000 不截断），
  //    超预算时卡 MIN_CODE_FLOOR，总码量按 下限×N 线性涨（不封顶）
  const codeLimit = Math.min(SNIPPET_CODE_LIMIT, Math.max(MIN_CODE_FLOOR, Math.floor(TOTAL_CODE_BUDGET / Math.max(candidates.length, 1))))

  // ④ 追问边界：整场会话搜索结果的候选编号并集。为什么全量不是两轮：候选集已含整场历史片段
  //    （recall histSnippets 全量收集），边界只放两轮会挡死跨轮回退（"把最开始那个防抖的改一下"）。
  //    映射只保留本轮候选里存在的编号：被 RECALL_LIMIT 截断的旧片段自动丢弃，防幻觉不破
  const lastSearches = history.filter(m => m.role === 'assistant' && m.searchIds && m.searchIds.length > 0)
  const lastSearchNums = [...new Set(
    lastSearches.flatMap(m => m.searchIds!.map(id => candidates.findIndex(c => c.id === id) + 1).filter(n => n > 0))
  )]

  // ⑤ 组 prompt（prompt.ts）：候选片段 + 历史 + 当前消息 + 边界 → 单条 user 消息
  const prompt = buildUserPrompt({ candidates, snippets, folders, history, message, codeLimit, lastSearchNums })

  // 合法响应判定：只认已识别的工具调用，未走工具一律判无效重试；不再解析 content JSON
  // （实测 22/22 轮模型稳定走工具，见 架构决策记录 D19）
  const isValidResult = (r: ChatResult) => {
    const tc = r.toolCalls?.[0]
    return !!tc && (ACTIONS as readonly string[]).includes(tc.name)
  }

  // ⑥ 发请求（client.ts 的 chat + tools.ts 的 ASSISTANT_TOOLS）：
  //    无效输出自动重试一次；失败按"用户可操作"透传（503/上下文超限给具体文案，不吞成笼统错误）
  let result: ChatResult
  try {
    result = await chatRetryIfEmpty(
      [{ role: 'system', content: system }, { role: 'user', content: prompt }],
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
      logAiCall({ action: 'error', candidates: candidates.length, promptChars: system.length + prompt.length, ms: Date.now() - startedAt, errCode: err.code, errMsg: err.message })
      throw err
    }
    logAiCall({ action: 'error', candidates: candidates.length, promptChars: system.length + prompt.length, ms: Date.now() - startedAt, errCode: 'ERR_FALLBACK', errMsg: String(err) })
    throw new AIError('AI 助手请求失败，请重试', 'ERR_FALLBACK')
  }

  // ⑦ 归一动作对象：只取工具调用（name=动作、arguments=参数）；没有工具调用时落 'ask' 兜底
  const tc = result.toolCalls?.[0]
  const obj: Record<string, unknown> = tc ? { action: tc.name, ...tc.arguments } : {}
  const action = typeof obj.action === 'string' && (ACTIONS as readonly string[]).includes(obj.action) ? obj.action : 'ask'

  // ════════ ⑧ 五路分发：把动作翻译成 AssistantReply ════════

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
    // operate 是"AI 提议、用户确认"的安全模型：这里只翻译成校验过的操作，落库等确认卡点头。
    // 复合操作逐条校验，任一步不过转 ask 分步
    const rawOps = obj?.ops
    if (Array.isArray(rawOps) && rawOps.length > 0) {
      const rawStepList = rawOps as Record<string, unknown>[]
      // 混 create 的复合操作整组转分步——避免逐条校验只卡住 create 而让收藏夹步骤先行部分执行
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
    // 单操作路径
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
    // modify：只校验目标编号 + 需求非空。空泛需求（"优化一下"没说清）交 prompt 规则压，
    // 不本地词表拦截——实测词表对模型臆测输出命中率 0（见 架构决策记录 D18）
    if (op === 'modify') {
      const dedup = mapValidIds(obj?.ids, candidates.length)
      if (dedup.length === 0) {
        return done('ask', { action: 'ask', text: '你想修改哪个片段？告诉我是第几个，比如「把第一个改成 xx」。', ids: [], note: '' })
      }
      if (!value) {
        return done('ask', { action: 'ask', text: '你想怎么改这个片段？说下具体需求，比如「改成支持 options 参数」。', ids: [], note: '' })
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
    // create：生成式操作，先校验需求文本，真正的代码生成由 store 发起第二个请求（tasks.ts）
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
    // 片段操作兜底（rename/export/favorite/unfavorite）：需要目标编号 + 部分需要新值
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
    // 意图模糊/缺参数时澄清：问清要找什么，而不是瞎猜
    const question = typeof obj?.question === 'string' && obj.question.trim() ? obj.question.trim() : '没太听懂你想找什么，能再说得具体一点吗？'
    return done('ask', { action: 'ask', text: question, ids: [], note: '' })
  }

  // chat：与找片段无关的寒暄，简短回复即可
  const reply = typeof obj?.reply === 'string' && obj.reply.trim() ? obj.reply.trim() : '我在的，跟我说说你想找什么代码片段吧。'
  return done('chat', { action: 'chat', text: reply, ids: [], note: '' })
}
