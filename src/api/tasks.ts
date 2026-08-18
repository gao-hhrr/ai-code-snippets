// ════════════════════════════════════════════════════════
// api/tasks.ts —— 单项 AI 任务：generateDescription / generateCode / modifyCode
// ════════════════════════════════════════════════════════
import { chat } from './client'

// 为片段生成一句"人话"描述：代码表达不了的用途/背景，AI 助手理解片段的元信息。
// 保存后异步调用（不阻塞跳转），失败保持空串，由 UI 提供重试
export async function generateDescription(
  title: string,
  code: string,
  language: string,
  opts: { signal?: AbortSignal } = {}
): Promise<string> {
  const prompt = [
    '你是「代码片段库」的整理助手。请阅读下面这段代码，用一句中文（不超过 40 字）概括它的用途和特点。',
    '要求：',
    '- 只返回描述本身，不要引号、不要解释、不要 markdown。',
    '- 写成给同事介绍的人话：包含用途，必要时提注意点。',
    '- 示例：「按钮防抖，连续点击只触发最后一次，用于搜索联想」',
    `标题：${title}`,
    `语言：${language}`,
    '代码：',
    '```',
    code.slice(0, 8000),
    '```'
  ].join('\n')
  const res = await chat({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 300,
    signal: opts.signal
  })
  return res.content
}

// 按描述生成一段新代码（传入 onChunk 即流式）
export async function generateCode(
  description: string,
  language: string,
  opts: { signal?: AbortSignal; onChunk?: (delta: string) => void; thinking?: boolean; onFallback?: () => void } = {}
): Promise<string> {
  const deepThink = opts.thinking === true

  // 深度思考版 prompt：不强压推理，让模型充分分析再写（慢但复杂需求质量更高）；
  // 强调"只返回代码"仍是必要的——推理过程走 reasoning_content 独立流，不混进 content
  const deepPrompt = [
    `你是一个${language}编程助手。请仔细分析下面这个需求，必要时可以深入思考，然后写出完整的最终实现。`,
    '要求：',
    '- 只返回代码本身，不要输出思考过程，不要用 markdown 代码块包裹。',
    '- 代码要完整、可运行，不要省略、不要用「……」或占位注释代替实际实现。',
    `语言：${language}`,
    `需求：${description}`
  ].join('\n')

  // hint 用于"直接输出"的强调：推理模型 reasoning 与 content 共享 max_tokens，
  // 冗长思考会吃光预算导致 content 为空（"AI 未生成代码"），prompt 尽力压住思考
  const buildPrompt = (hint: string) => [
    `你是一个${language}编程助手。${hint}下面这段代码的难度很低，不需要深入分析，直接写出最终实现即可。`,
    '要求：',
    '- 只返回代码本身，不要任何思考、分析、解释，不要用 markdown 代码块包裹。',
    '- 代码要完整、可运行，不要省略、不要用「……」或占位注释代替实际实现。',
    `语言：${language}`,
    `需求：${description}`
  ].join('\n')

  const call = async (content: string, extra: { thinking?: boolean; reasoningEffort?: 'low' | 'medium' | 'high' } = {}) => {
    // 累积本次调用的思考字符数：content 为空时用它区分「思考吃光预算」vs「模型空输出」两类降级原因
    let reasoningChars = 0
    const started = Date.now()
    const result = await chat({
      messages: [{ role: 'user', content }],
      // 推理模型的 reasoning 与 content 共享 max_tokens：推理过长会吃光预算导致 content 为空。
      // 顶格 8192（DeepSeek 上限），给 reasoning + 代码留最大空间
      maxTokens: 8192,
      signal: opts.signal,
      onChunk: opts.onChunk,
      onReasoning: (delta) => { reasoningChars += delta.length },
      // thinking 透传：false 时 client 关思考（直出），true/缺省时走推理默认
      thinking: extra.thinking ?? opts.thinking,
      // 深度思考开启时默认钳制思考到 low：v4-flash 默认/medium/high 都会思考到吃光预算导致 content 空
      reasoningEffort: extra.reasoningEffort ?? (opts.thinking === true ? 'low' : undefined)
    })
    return { result, reasoningChars, ms: Date.now() - started }
  }

  // 深度思考：用户显式开启，用鼓励分析的 prompt；钳制思考保证 content 有预算。
  // 兜底：思考仍吃光预算导致 content 空时，降级非深度直出重试一次，保证能拿到结果
  if (deepThink) {
    const { result: res, reasoningChars, ms } = await call(deepPrompt)
    if (!res.content) {
      // 控制台定位：content 空 = 触发降级；思考字符数大 → 思考吃光预算，小/零 → 模型空输出
      const cause = reasoningChars > 2000 ? '思考吃光预算' : '模型空输出'
      console.warn(`[ai-generate] 深度思考返回空(思考${reasoningChars}字/${ms}ms) → ${cause}，降级非深度直出重试`)
      // 通知调用方本次是降级结果（UI 据此提示用户"深度思考未生效，生成的是普通模式结果"）
      opts.onFallback?.()
      const retry = await call(buildPrompt('直接给出完整代码，不要思考过程，不要分析，立即输出。'), { thinking: false, reasoningEffort: undefined })
      if (!retry.result.content) console.warn(`[ai-generate] 降级重试仍返回空(思考${retry.reasoningChars}字/${retry.ms}ms)`)
      return retry.result.content
    }
    return res.content
  }

  // 默认（未开启深度思考）：首次就用"直接输出、不要思考"的强调 prompt，收敛推理吃预算的卡顿
  const { result: res } = await call(buildPrompt('直接给出完整代码，不要思考过程，不要分析，立即输出。'))
  // 兜底：首次仍空（极端需求）时换回基础措辞再试一次，两次措辞不同避免重复失败
  if (!res.content) {
    const retry = await call(buildPrompt(''))
    return retry.result.content
  }
  return res.content
}

// 按需求修改既有代码（传入 onChunk 即流式）。与 generateCode 同一套深度思考保护：
// prompt 二分 + reasoning_effort 钳制 + 空结果降级非深度直出，保证深度思考开启时也能拿到结果
export async function modifyCode(
  code: string,
  requirement: string,
  opts: { signal?: AbortSignal; onChunk?: (delta: string) => void; thinking?: boolean; onFallback?: () => void } = {}
): Promise<string> {
  const deepThink = opts.thinking === true

  // 深度思考版 prompt：不强压推理，让模型先分析代码与需求再修改（慢但复杂需求质量更高）；
  // 推理过程走 reasoning_content 独立流，不混进 content
  const deepPrompt = [
    '你是一个代码优化助手。请仔细分析下面这段代码和用户需求，必要时可以深入思考，然后输出修改后的完整代码。',
    '要求：',
    '- 只返回修改后的完整代码，不要输出思考过程，不要用 markdown 代码块包裹。',
    '- 代码要完整、可运行，不要省略、不要用「……」或占位注释代替实际实现。',
    '```',
    code.slice(0, 20000),
    '```',
    `用户需求：${requirement}`
  ].join('\n')

  // hint 用于"直接输出"的强调：推理模型 reasoning 与 content 共享 max_tokens，
  // 冗长思考会吃光预算导致 content 为空，prompt 尽力压住思考
  const buildPrompt = (hint: string) => [
    `你是一个代码优化助手。${hint}这段代码的修改很简单，不需要深入分析，直接输出修改后的完整代码。`,
    '要求：',
    '- 只返回修改后的完整代码，不要任何思考、分析、解释，不要用 markdown 代码块包裹。',
    '- 代码要完整、可运行，不要省略、不要用「……」或占位注释代替实际实现。',
    '```',
    code.slice(0, 20000),
    '```',
    `用户需求：${requirement}`
  ].join('\n')

  const call = async (content: string, extra: { thinking?: boolean; reasoningEffort?: 'low' | 'medium' | 'high' } = {}) => {
    // 累积本次调用的思考字符数：content 为空时用它区分「思考吃光预算」vs「模型空输出」两类降级原因
    let reasoningChars = 0
    const started = Date.now()
    const result = await chat({
      messages: [{ role: 'user', content }],
      // 修改要输出完整代码，预算按代码长度给足；深度思考时 reasoning 与 content 共享预算，顶格 8000
      // （DeepSeek max_tokens 上限 8192）给思考 + 完整代码最大空间，非深度按代码长度即可
      maxTokens: deepThink ? 8000 : Math.min(Math.max(code.length * 2, 2000), 8000),
      signal: opts.signal,
      onChunk: opts.onChunk,
      onReasoning: (delta) => { reasoningChars += delta.length },
      // thinking 透传：false 时 client 关思考（直出），true/缺省时走推理默认
      thinking: extra.thinking ?? opts.thinking,
      // 深度思考开启时默认钳制思考到 low：v4-flash 默认/medium/high 都会思考到吃光预算导致 content 空
      reasoningEffort: extra.reasoningEffort ?? (opts.thinking === true ? 'low' : undefined)
    })
    return { result, reasoningChars, ms: Date.now() - started }
  }

  // 深度思考：用户显式开启，用鼓励分析的 prompt；钳制思考保证 content 有预算。
  // 兜底：思考仍吃光预算导致 content 空时，降级非深度直出重试一次，保证能拿到结果
  if (deepThink) {
    const { result: res, reasoningChars, ms } = await call(deepPrompt)
    if (!res.content) {
      // 控制台定位：content 空 = 触发降级；思考字符数大 → 思考吃光预算，小/零 → 模型空输出
      const cause = reasoningChars > 2000 ? '思考吃光预算' : '模型空输出'
      console.warn(`[ai-modify] 深度思考返回空(思考${reasoningChars}字/${ms}ms) → ${cause}，降级非深度直出重试`)
      // 通知调用方本次是降级结果（UI 据此提示用户"深度思考未生效，生成的是普通模式结果"）
      opts.onFallback?.()
      const retry = await call(buildPrompt('直接输出修改后的完整代码，不要思考过程，不要分析，立即输出。'), { thinking: false, reasoningEffort: undefined })
      if (!retry.result.content) console.warn(`[ai-modify] 降级重试仍返回空(思考${retry.reasoningChars}字/${retry.ms}ms)`)
      return retry.result.content
    }
    return res.content
  }

  // 默认（未开启深度思考）：首次就用"直接输出、不要思考"的强调 prompt，收敛推理吃预算的卡顿
  const { result: res } = await call(buildPrompt('直接输出修改后的完整代码，不要思考过程，不要分析，立即输出。'))
  // 兜底：首次仍空（极端需求）时换回基础措辞再试一次，两次措辞不同避免重复失败
  if (!res.content) {
    const retry = await call(buildPrompt(''))
    return retry.result.content
  }
  return res.content
}
