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
  const prompt = [
    `你是一个${language}编程助手。根据下面的需求描述，生成完整、可直接运行的代码。`,
    '要求：只返回代码本身，不要解释，不要用 markdown 代码块包裹。',
    `语言：${language}`,
    `需求：${description}`
  ].join('\n')
  const res = await chat({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4096,
    signal: opts.signal,
    onChunk: opts.onChunk
  })
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
    maxTokens: Math.max(code.length * 2, 2000),
    signal: opts.signal,
    onChunk: opts.onChunk
  })
  return res.content
}
