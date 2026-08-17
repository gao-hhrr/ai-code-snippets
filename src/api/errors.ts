// 错误体系：稳定错误码 + AIError + AbortError 判断 + 服务端错误文案映射

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
