// ════════════════════════════════════════════════════════
// api/ai.ts —— AI 调用层统一出口（barrel）：外部一律从这里导入，内部按职责拆分
// ════════════════════════════════════════════════════════
// 模块地图：types（共享类型）/ client（底层请求 + 错误体系）/ tasks（单项 AI 任务）/
//           assistant（AI 助手编排：召回 + 校验/分发）/ prompt（prompt 组装）/
//           operateMeta（操作分类元数据）/ operateValidate（操作语义校验）/
//           recall（本地召回 + JSON 提取）/ tools（function calling 工具注册）
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
export { assistantTurn, summarizeThinking } from './assistant'
export { REVERSIBLE_OPS, OP_FOLDER } from './operateMeta'
