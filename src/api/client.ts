// ════════════════════════════════════════════════════════
// api/client.ts —— 底层请求客户端：SSE 流式读取 + 503 退避重试 + 稳定错误码体系（AIError）
// ════════════════════════════════════════════════════════
import type { ChatMessage } from './types'

// 稳定错误码：UI 按 code 分组展示可操作建议，调试者靠 code 定位根因（不再只靠人话文案猜）
export type AIErrorCode =
  | 'ERR_KEY_MISSING'      // 未配置 API Key
  | 'ERR_UNAUTHORIZED'     // 401 Key 无效
  | 'ERR_INSUFFICIENT'     // 402/余额 余额不足或额度用尽
  | 'ERR_RATE_LIMIT'       // 429 请求过频
  | 'ERR_CONTEXT'          // 400 上下文超限
  | 'ERR_API'              // 其他非 2xx 兜底
  | 'ERR_SERVER'           // 5xx 服务器繁忙
  | 'ERR_NETWORK'          // 网络请求失败
  | 'ERR_PARSE'            // 200 但响应非合法 JSON
  | 'ERR_STREAM'           // 流式输出中断
  | 'ERR_FALLBACK'         // 上层兜底

// 调用失败统一抛 AIError（中文人话文案 + 稳定错误码 + 技术详情）；AbortError 原样上抛，由调用方判断是否静默
export class AIError extends Error {
  code: AIErrorCode
  status?: number
  detail?: string
  constructor(message: string, code: AIErrorCode, status?: number, detail?: string) {
    super(message)
    this.name = 'AIError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : (err as Error)?.name === 'AbortError'
}

// 服务端错误 → 中文人话文案 + 稳定错误码：让用户能判断是"超时/余额/token 超限"中的哪一种、该怎么处理。
// 之前直接透传英文原文（如 400 context length），用户无法区分问题类型。
export function describeAIError(status: number, detail: string): { code: AIErrorCode; message: string } {
  const d = detail.toLowerCase()
  if (status === 401) return { code: 'ERR_UNAUTHORIZED', message: 'AI API Key 无效或已过期，请检查 .env 中的 VITE_AI_API_KEY' }
  if (status === 402 || /balance|insufficient|quota|inactive/.test(d)) return { code: 'ERR_INSUFFICIENT', message: 'AI 账户余额不足或额度用尽，请到平台充值或检查用量' }
  if (status === 429) return { code: 'ERR_RATE_LIMIT', message: 'AI 请求过于频繁，请稍等片刻再试' }
  if (status === 400 && /context|length/.test(d)) return { code: 'ERR_CONTEXT', message: '请求内容过长，超出模型上下文上限：候选片段太多或对话历史太长。建议点「重新开始」缩短对话，或删除部分片段' }
  if (status >= 500) return { code: 'ERR_SERVER', message: `AI 服务器繁忙（${status}），请稍后重试` }
  return { code: 'ERR_API', message: `AI 请求失败（${status}）：${detail}` }
}

const AI_API_URL = 'https://api.deepseek.com/chat/completions'
const AI_API_KEY = import.meta.env.VITE_AI_API_KEY || ''
const AI_MODEL = import.meta.env.VITE_AI_MODEL || 'deepseek-v4-flash'

// ---------- function calling（工具调用）类型 ----------
// OpenAI 兼容的 Chat Completions `tools` 参数：声明模型可以调用的函数。
// parameters 是 JSON Schema（type/properties/required），模型按 Schema 产出参数。
export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// 解析后的工具调用：name = 动作名；arguments 由 API 协议保证是合法 JSON 对象
// （手写 JSON 解析的坑——截断/嵌套/转义——在协议层就不存在了）
export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

// chat() 的返回：content 为纯文本答案；toolCalls 为模型请求的工具调用（没有则为空数组）
export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
}

export interface ChatOptions {
  messages: ChatMessage[]
  maxTokens?: number
  signal?: AbortSignal
  onChunk?: (delta: string) => void
  // 推理模型的思考过程流（reasoning_content）：逐段回调，UI 展示"AI 正在思考…"实时滚动
  onReasoning?: (delta: string) => void
  // 503 过载开始退避重试时回调（attempt：即将进行的第几次尝试，1 起）
  onRetry?: (attempt: number) => void
  // 注册 function calling 工具：提供后模型用 tool_calls 返回结构化动作，而不是把 JSON 写进 content
  tools?: ChatTool[]
}

// 可被 signal 中断的延时：503 退避等待期间，用户停止/超时立即生效（普通 setTimeout 只能等它睡完）
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms)
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    if (signal?.aborted) {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    } else {
      signal?.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  if (!AI_API_KEY) {
    throw new AIError('未配置 AI API Key，请在项目根目录 .env 中设置 VITE_AI_API_KEY', 'ERR_KEY_MISSING')
  }

  let res: Response
  // 503 服务端过载（DeepSeek 常态）：退避重试 3 次，每次间隔递增
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(AI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_API_KEY}`
        },
        signal: options.signal,
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: options.maxTokens ?? 2000,
          // 有任一流式回调就走流式：onReasoning 需要流式才能捕获思考过程，即使调用方只要 reasoning 不要 content
          stream: !!(options.onChunk || options.onReasoning),
          messages: options.messages,
          // 注册了工具就带 tools；tool_choice:'auto' 让模型优先走结构化工具调用，
          // 不走工具时 content 直出 JSON 由调用方降级解析（DeepSeek 对 'required' 支持不如 'auto' 稳）
          ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {})
        })
      })
    } catch (err) {
      if (isAbortError(err)) throw err
      throw new AIError('网络请求失败，请检查网络后重试', 'ERR_NETWORK')
    }

    if (res.ok) {
      if (options.onChunk || options.onReasoning) return readStream(res, options.onChunk, options.onReasoning)
      // 非流式：content 与 tool_calls 二选一（注册工具时模型可能返回 tool_calls 而非 content）
      let raw = ''
      try {
        raw = await res.text()
        const data = JSON.parse(raw)
        const message = data.choices?.[0]?.message
        return { content: typeof message?.content === 'string' ? message.content : '', toolCalls: parseToolCalls(message?.tool_calls) }
      } catch {
        if (attempt < 1) {
          await sleep(1000, options.signal)
          continue
        }
        const head = raw.slice(0, 80).replace(/\s+/g, ' ').trim()
        throw new AIError(
          'AI 返回内容解析失败（响应不是有效 JSON' + (head ? `，开头为：${head}` : '，响应为空') + '），请点重试',
          'ERR_PARSE',
          200,
          raw.slice(0, 300)
        )
      }
    }

    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error?.message || ''
    } catch { /* 忽略错误详情解析失败 */ }

    if (res.status === 503 && attempt < 3) {
      options.onRetry?.(attempt + 1)
      await sleep(5000 * (attempt + 1), options.signal)
      continue
    }
    const err = describeAIError(res.status, detail)
    throw new AIError(err.message, err.code, res.status, detail)
  }
}

// 把响应里的 message.tool_calls（原始 JSON 字符串）解析成 { name, arguments } 对象。
// 流式路径在 readStream 内累积后再统一调这里；非流式路径直接调。
function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return []
  const out: ToolCall[] = []
  for (const tc of raw) {
    const name = (tc as { function?: { name?: unknown } })?.function?.name
    if (typeof name !== 'string' || !name) continue
    const argsStr = (tc as { function?: { arguments?: unknown } })?.function?.arguments
    let args: Record<string, unknown> = {}
    if (typeof argsStr === 'string' && argsStr) {
      try { args = JSON.parse(argsStr) } catch { /* 非法参数按空对象，由上层语义校验兜底 */ }
    }
    out.push({ name, arguments: args })
  }
  return out
}

async function readStream(
  res: Response,
  onChunk?: (delta: string) => void,
  onReasoning?: (delta: string) => void
): Promise<ChatResult> {
  if (!res.body) throw new AIError('当前环境不支持流式输出', 'ERR_STREAM')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  // 流式累积的 tool_calls：按 index 槽位存放，name 整段到达、arguments 分片拼接
  const streamed: Array<{ name: string; arguments: string }> = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

      for (const line of lines) {
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload)
          const delta = parsed.choices?.[0]?.delta
          // 推理模型思考过程与最终回答分两个字段流式返回：reasoning_content 在 content 之前吐完
          if (delta?.reasoning_content) onReasoning?.(delta.reasoning_content)
          if (delta?.content) {
            full += delta.content
            onChunk?.(delta.content)
          }
          // 工具调用的增量流：每个 delta.tool_calls 元素带 index；name 一般整段到达、arguments 分片拼
          if (delta?.tool_calls) {
            // 触发"开始输出"信号（调用方用它切换阶段指示；工具模式下 content 可能为空）
            onChunk?.('')
            for (const tc of delta.tool_calls as Array<{ index?: number; function?: { name?: string; arguments?: string } }>) {
              const idx = tc.index ?? 0
              streamed[idx] = streamed[idx] || { name: '', arguments: '' }
              if (tc.function?.name) streamed[idx].name += tc.function.name
              if (tc.function?.arguments) streamed[idx].arguments += tc.function.arguments
            }
          }
        } catch { /* 忽略不完整分片 */ }
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new AIError('流式输出中断，请重试', 'ERR_STREAM')
  }

  // 流结束时把累积的 arguments 字符串统一解析成对象（API 协议保证是合法 JSON）
  const toolCalls = parseToolCalls(
    streamed.filter(tc => tc.name).map(tc => ({ function: { name: tc.name, arguments: tc.arguments } }))
  )
  return { content: full, toolCalls }
}
