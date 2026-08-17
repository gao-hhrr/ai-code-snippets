// AI 能力统一出口：外部一律从 '@/api/ai' 导入，内部逻辑按职责拆分
// 模块地图：errors（错误体系）/ types（共享类型）/ client（底层请求）/ tasks（单项 AI 任务）/
//           recall（候选召回）/ assistant（AI 助手核心）
export type {
  ChatMessage,
  CodeContext,
  SearchSnippet,
  SearchFolder,
  AssistantTurnMessage,
  AssistantReply,
  OperateOp
} from './types'
export { AIError, isAbortError } from './errors'
export type { AIErrorCode } from './errors'
export { chatAboutCode, generateDescription, generateCode, modifyCode } from './tasks'
export { assistantTurn, summarizeThinking } from './assistant'
