// ════════════════════════════════════════════════════════
// api/ai.ts —— AI 调用层统一出口（barrel）：外部一律从这里导入，内部按职责拆分
// ════════════════════════════════════════════════════════
// 模块地图：types（共享类型）/ client（底层请求 + 错误体系）/ tasks（单项 AI 任务）/
//           assistant（AI 助手核心：召回 + 校验/分发）/ assistantPrompt（prompt 组装）
export type {
  ChatMessage,
  SearchSnippet,
  SearchFolder,
  AssistantTurnMessage,
  AssistantReply,
  OperateOp,
  OperateStep
} from './types'
export { AIError, isAbortError } from './client'
export type { AIErrorCode } from './client'
export { generateDescription, generateCode, modifyCode } from './tasks'
export { assistantTurn, summarizeThinking, REVERSIBLE_OPS } from './assistant'
