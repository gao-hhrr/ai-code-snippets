// 底层请求客户端：API 配置 + 流式读取 + 503 退避重试
import { AIError, isAbortError, describeAIError } from './errors'
import type { ChatMessage } from './types'

const AI_API_URL = 'https://api.deepseek.com/chat/completions'
const AI_API_KEY = import.meta.env.VITE_AI_API_KEY || ''
const AI_MODEL = import.meta.env.VITE_AI_MODEL || 'deepseek-v4-flash'

export interface ChatOptions {
  messages: ChatMessage[]
  maxTokens?: number
  signal?: AbortSignal
  onChunk?: (delta: string) => void
  // 推理模型的思考过程流（reasoning_content）：逐段回调，UI 展示"AI 正在思考…"实时滚动
  onReasoning?: (delta: string) => void
  // 503 过载开始退避重试时回调（attempt：即将进行的第几次尝试，1 起）
  onRetry?: (attempt: number) => void
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

export async function chat(options: ChatOptions): Promise<string> {
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
          messages: options.messages
        })
      })
    } catch (err) {
      if (isAbortError(err)) throw err
      throw new AIError('网络请求失败，请检查网络后重试', 'ERR_NETWORK')
    }

    if (res.ok) {
      if (options.onChunk || options.onReasoning) return readStream(res, options.onChunk, options.onReasoning)
      // 200 但响应不是合法 JSON：瞬态错误（网关页面/传输截断），重试一次，仍失败则带响应开头诊断
      let raw = ''
      try {
        raw = await res.text()
        const data = JSON.parse(raw)
        return data.choices?.[0]?.message?.content ?? ''
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

async function readStream(
  res: Response,
  onChunk?: (delta: string) => void,
  onReasoning?: (delta: string) => void
): Promise<string> {
  if (!res.body) throw new AIError('当前环境不支持流式输出', 'ERR_STREAM')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''

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
        } catch { /* 忽略不完整分片 */ }
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new AIError('流式输出中断，请重试', 'ERR_STREAM')
  }

  return full
}
