// ════════════════════════════════════════════════════════
// api/types.ts —— AI 交互共享类型：ChatMessage / 库片段子集 / 助手消息 / 操作动作
// ════════════════════════════════════════════════════════
import type { Snippet, Folder } from '@/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 进 prompt 的库片段子集：从领域模型 Snippet 派生（少 updatedAt，其余字段一致）
export type SearchSnippet = Pick<Snippet, 'id' | 'title' | 'language' | 'code' | 'description' | 'folderIds' | 'createdAt'>

// 进 prompt 的收藏夹子集：从领域模型 Folder 派生
export type SearchFolder = Pick<Folder, 'id' | 'name'>

export interface AssistantTurnMessage {
  role: 'user' | 'assistant'
  content: string
  // assistant 消息的搜索结果（store 回填；assistantTurn 内部组装成摘要给模型看历史）
  searchIds?: string[]
  note?: string
  // 本轮 AI 思考过程（reasoning_content 流累积，UI 可折叠查看；不进 prompt）
  reasoning?: string
  // 思考过程的四步总结（模型二次整理成的文本）；缺失时 UI 兜底显示 reasoning 原文
  thinkingSummary?: string
  // 换话题分割线（仅 UI 展示，不计入对话轮数，不进 prompt）
  divider?: boolean
  // --- modify 状态（仅 UI/流程，不进 prompt）---
  requirement?: string   // 修改需求（模型提炼）
  modifyState?: 'running' | 'done' | 'error'  // 改写流程状态
  modifyProgress?: number // 流式改写中已生成的字符数（修改卡显示进度）
  modifiedCode?: string  // AI 改写的完整代码（完成时填充）
  modifyApplied?: boolean // 已保存为新/已替换原
  modifiedDegraded?: boolean // modify 深度思考失败降级为非深度生成（UI 提示用户质量非深度）
  // 另存流程（保存为新片段 → 跳编辑页草稿预填）：undefined=未发起；'pending'=在编辑页待回传；true=已保存；false=丢弃
  modifySave?: boolean | 'pending'
  modifyBackup?: string // 替换原代码前暂存的原代码，供「撤销替换」恢复
  modifySavedSnippetId?: string // 另存入库后的新片段 id（「查看」跳详情）
  // --- operate 状态（库结构操作提议：删除/重命名/收藏/导出/新建/清空，确认后才执行）---
  operateOp?: OperateOp
  operateValue?: string
  operateTarget?: string // renameFolder 旧夹名（AI 按名指代夹）
  operateField?: 'description' | 'language' // meta 的目标字段
  operateState?: 'pending' | 'running' | 'executed' | 'cancelled' | 'error'  // running = create 生成代码中
  targetTitle?: string  // 操作对象的片段标题（提议时快照，删除后仍能显示）
  createdCode?: string   // create 本地生成的新代码（生成完成后填充）
  createdLanguage?: string // create 的代码语言
  createdProgress?: number // create 流式生成中已生成的字符数（确认卡显示进度）
  createdDegraded?: boolean // create 深度思考失败降级为非深度生成（UI 提示用户质量非深度）
  // create 确认后转入编辑页，编辑页回传最终结果：saved = 是否保存入库；snippetId = 入库后的片段 id（「查看」跳详情）
  createSaved?: boolean
  createdSnippetId?: string
}

// 库结构操作类型：AI 只提议（operate 动作），用户确认后前端才执行。
// 批量：delete/favorite/unfavorite 的 ids 支持多个；create/clear/createFolder/deleteFolder/clearFolder 不需要 ids。
export type OperateOp =
  | 'delete' | 'rename' | 'export' | 'favorite' | 'unfavorite' | 'create' | 'clear'
  | 'createFolder' | 'renameFolder' | 'deleteFolder' | 'clearFolder' | 'meta'

// 库操作序列中的单个步骤：op 与单操作同义，参数见 AssistantReply 同名字段
export interface OperateStep {
  op: OperateOp
  ids?: string[]
  value?: string // rename 的新标题 / favorite、unfavorite 的收藏夹名 / 各 folder op 的夹名 / meta 的新值
  target?: string // renameFolder 的旧夹名（AI 按名指代夹）
  field?: 'description' | 'language' // meta 的目标字段
  language?: string // create 的代码语言（复合中 create 不允许，保留用于一致性）
}

export interface AssistantReply {
  action: 'search' | 'ask' | 'chat' | 'summarize' | 'modify' | 'operate'
  text: string // ask: 澄清问题；chat: 回复文本；search: 空串（结果由 ids+note 渲染）；summarize: 中文分析（可 markdown）；modify: AI 对修改的简短说明；operate: 空串（操作说明由 op/value 渲染）
  ids: string[]
  note: string
  // modify 的修改需求（模型提炼后的干净需求，前端据此调 modifyCode；不直接信任用户原文，避免杂质）
  requirement?: string
  // operate 的库结构操作：AI 只提议，用户确认后前端才执行
  op?: OperateOp
  value?: string // rename 的新标题 / favorite、unfavorite 的收藏夹名 / create 的标题或需求 / 各 folder op 的夹名 / meta 的新值
  target?: string // renameFolder 的旧夹名（AI 按名指代夹）
  field?: 'description' | 'language' // meta 的目标字段
  language?: string // create 的代码语言
  // 复合操作：一次指令要求做多件事（建夹+放入、改名+收藏、移动等）时的操作序列；
  // 仅限可逆操作，含 delete/clear/deleteFolder/clearFolder/create 时应在 assistant 转 ask 分步。
  // 与单 op 互斥：存在 ops 时忽略 op/value 等单操作字段
  ops?: OperateStep[]
}
