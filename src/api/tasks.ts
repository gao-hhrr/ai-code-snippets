// ════════════════════════════════════════════════════════
// api/tasks.ts —— 单项 AI 任务：chatAboutCode / generateDescription / generateCode / modifyCode
// ════════════════════════════════════════════════════════
import { chat } from './client'
import type { ChatMessage, CodeContext } from './types'

// 组装"带代码上下文的系统提示"：告知模型当前片段内容，要求简洁中文回答
function buildCodeSystemPrompt(context: CodeContext): string {
  return [
    '你是一个代码助手。用户保存了下面这段代码片段，后续对话都围绕它进行：',
    '```' + (context.language || 'text'),
    context.code.slice(0, 12000),
    '```',
    '要求：用简洁的中文回答；给代码示例时只给必要的片段，不要整段重复上面的代码。'
  ].join('\n')
}

// 围绕一段代码的多轮对话（history 不含 system，调用方只维护 user/assistant）
export async function chatAboutCode(
  history: ChatMessage[],
  context: CodeContext,
  opts: { signal?: AbortSignal; onChunk?: (delta: string) => void } = {}
): Promise<string> {
  const res = await chat({
    messages: [{ role: 'system', content: buildCodeSystemPrompt(context) }, ...history],
    maxTokens: 2000,
    signal: opts.signal,
    onChunk: opts.onChunk
  })
  return res.content
}

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
  opts: { signal?: AbortSignal; onChunk?: (delta: string) => void } = {}
): Promise<string> {
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

  const call = (content: string) => chat({
    messages: [{ role: 'user', content }],
    // 推理模型的 reasoning 与 content 共享 max_tokens：推理过长会吃光预算导致 content 为空。
    // 顶格 8192（DeepSeek 上限），给 reasoning + 代码留最大空间
    maxTokens: 8192,
    signal: opts.signal,
    onChunk: opts.onChunk
  })

  // 首次就用"直接输出、不要思考"的强调 prompt：推理模型面对"极限"需求会过度思考吃光预算导致
  // content 为空，一开始就收敛思考，省掉"先空后重试"的往返（实测正常需求不降质、极端需求不再卡）
  const res = await call(buildPrompt('直接给出完整代码，不要思考过程，不要分析，立即输出。'))
  // 兜底：首次仍空（极端需求）时换回基础措辞再试一次，两次措辞不同避免重复失败
  if (!res.content) {
    const retry = await call(buildPrompt(''))
    return retry.content
  }
  return res.content
}

// 按需求修改既有代码（传入 onChunk 即流式）
export async function modifyCode(
  code: string,
  requirement: string,
  opts: { signal?: AbortSignal; onChunk?: (delta: string) => void } = {}
): Promise<string> {
  const prompt = [
    '你是一个代码优化助手。请根据用户的要求修改代码，只返回修改后的完整代码，不要解释，不要用 markdown 包裹。',
    '```',
    code.slice(0, 20000),
    '```',
    `用户需求：${requirement}`
  ].join('\n')
  const res = await chat({
    messages: [{ role: 'user', content: prompt }],
    // 修改要输出完整代码，预算按代码长度给足；但 DeepSeek max_tokens 上限 8192，超出会直接 400 报错
    maxTokens: Math.min(Math.max(code.length * 2, 2000), 8000),
    signal: opts.signal,
    onChunk: opts.onChunk
  })
  return res.content
}
