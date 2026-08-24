// ════════════════════════════════════════════════════════
// api/types.ts —— AI 交互共享类型。三类数据，三种"视角"：
//   1. ChatMessage —— 发给 LLM 的原始消息（client.ts 直接放 fetch body）
//   2. SearchSnippet / SearchFolder —— 塞进 prompt 的"库子集"（从领域模型裁剪出模型需要的字段）
//   3. AssistantTurnMessage / AssistantReply / OperateOp / OperateStep —— 会话消息与操作契约（store 流转、驱动 UI）
// 核心心法：一条 AssistantTurnMessage 同时装三类东西——对话内容（进 prompt）、
// AI 思考与展示（仅 UI）、modify/operate 流程状态（仅流程）——分清谁进 prompt、谁不进，是读懂的钥匙。
// ════════════════════════════════════════════════════════
import type { Snippet, Folder } from '@/types'

// 发给 LLM 的原始消息：直接对应 Chat Completions API 的 messages 数组（client.ts 的 fetch body）
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 进 prompt 的库片段子集（"给模型看的片段"）：从领域模型 Snippet 用ts内置工具类型 Pick 裁剪出模型做语义判断需要的字段。
// id 用来回填真实片段，其余是内容与元信息；updatedAt 对"这段代码是干嘛的"判断无用，所以不带。
// 本地召回（assistant.ts recallCandidates）与 prompt 组装（prompt.ts）都用这个形状。
export type SearchSnippet = Pick<Snippet, 'id' | 'title' | 'language' | 'code' | 'description' | 'folderIds' | 'createdAt'>

// 进 prompt 的收藏夹子集：模型只按夹名指代收藏夹（"我收藏的""放进 常用 夹"），id 用于映射回真实夹
export type SearchFolder = Pick<Folder, 'id' | 'name'>

// 一条助手会话消息（store 里的对话记录，可持久化到 sessionStorage）。三类字段按注释分组：
//   ① 对话本身（进 prompt）—— role / content / searchIds，prompt.ts 会再压成摘要给模型
//   ② 展示用（仅 UI，不进 prompt）—— note / reasoning / thinkingSummary / divider
//   ③ modify / operate 流程状态（仅流程驱动卡片，不进 prompt）—— 下方两个 `--- 块` 的字段
export interface AssistantTurnMessage {
  role: 'user' | 'assistant'
  content: string
  // ① assistant 消息命中的片段 id（store 回填）。三处作用：结果卡按它渲染片段；
  //    召回时历史里的 searchIds 排最前（追问=在上一轮结果里继续筛）；prompt 里压成"找到 N 条：标题"摘要。
  searchIds?: string[]
  // ② assistant 消息的备注：搜索的筛选依据 / 修改与库操作的提醒文案，仅展示在气泡顶部，不进 prompt
  note?: string
  // ② 本轮 AI 思考过程：reasoning_content 流式累积的原文，可折叠展示；不进 prompt
  reasoning?: string
  // ② 思考过程的四步总结（summarizeThinking 后台二次整理）；缺失时 UI 兜底展示 reasoning 原文
  thinkingSummary?: string
  // ② 换话题分割线：仅 UI 展示分隔线，不计入对话轮数，也不进 prompt（发下一条时历史被清空）
  divider?: boolean
  // --- ③ modify 流程（AI 修改代码）：assistantTurn 只判定"改哪个+怎么改"（operate op:'modify'），
  //     真正改写由 runOperateStep 的 modify 分支 → modifyCode 流式完成，状态机 running → done / error ---
  requirement?: string   // 修改需求（模型从用户原话提炼的干净需求，前端据此调 modifyCode，不信任原文避免杂质）
  modifyState?: 'running' | 'done' | 'error'  // 改写流程状态
  modifyProgress?: number // 流式改写中已生成的字符数（修改卡显示进度）
  modifiedCode?: string  // AI 改写的完整代码（done 时填充，供 diff 卡展示）
  modifyApplied?: boolean // 是否已落地：另存为 / 替换原代码 二选一，用于禁用重复操作
  modifiedDegraded?: boolean // 深度思考失败降级为非深度生成（UI 提示用户"质量非深度"）
  // 另存为新片段流程（写草稿跳编辑页预填，保存才入库）：undefined=未发起；'pending'=在编辑页待回传；
  // true=已保存；false=丢弃。回传按谓词定位（见 resolveModifyFromEditor，编辑页刷新后也能对上）
  modifySave?: boolean | 'pending'
  modifyBackup?: string // 替换原代码前暂存的原代码，供「撤销替换」一键恢复
  modifySavedSnippetId?: string // 另存入库后的新片段 id（「查看」跳详情）
  // --- ③ operate 流程（AI 提议库结构操作，用户确认才执行）---
  operateOp?: OperateOp
  operateValue?: string  // rename 的新标题 / favorite、unfavorite 的夹名 / create 的标题或需求 / 各 folder op 的夹名 / meta 的新值
  operateTarget?: string // renameFolder 旧夹名（AI 按名指代夹）
  operateField?: 'description' | 'language' // meta 的目标字段
  // 状态机：pending(待确认) → executed/cancelled/error；create 先 running(生成代码) 再 pending(待进编辑页)
  operateState?: 'pending' | 'running' | 'executed' | 'cancelled' | 'error'
  targetTitle?: string  // 操作对象的片段标题（提议时快照，删除后仍能显示）
  createdCode?: string   // create 本地生成的新代码（生成完成后填充）
  createdLanguage?: string // create 的代码语言
  createdProgress?: number // create 流式生成中已生成的字符数（确认卡显示进度）
  createdDegraded?: boolean // create 深度思考失败降级为非深度生成（UI 提示用户质量非深度）
  // create 确认后转编辑页，编辑页回传最终结果：createSaved = 是否保存入库（undefined=未回传）；
  // createdSnippetId = 入库后的新片段 id（「查看」跳详情）
  createSaved?: boolean
  createdSnippetId?: string
}

// 操作类型（13 种）：AI 只提议（operate 动作），用户确认后前端才执行。分类模型见 assistant.ts 的 OP_META——
// 「动作 × 对象」矩阵，可逆性/组合限制/参数形状由分类推导，加操作只动 OP_META 一行，不散落改多处。
// modify（改代码）语义归位为操作之一（动作 modify × 片段），与 rename/meta/renameFolder 同类都是"修改"，
// 此前独立成 action 只因其执行是生成式（流式生成+diff 审阅，走生成式流程）；进 ops 会被校验拒绝（见 NON_COMPOSABLE_OPS）。
// 可逆性分级（安全模型核心）：OP_META 里 reversible && !generative 的项单操作直接执行不弹确认卡；
// 不可逆项（delete/clear/deleteFolder/clearFolder）确认卡 + 双重确认；create 转编辑页人审。
export type OperateOp =
  | 'modify' | 'delete' | 'rename' | 'export' | 'favorite' | 'unfavorite' | 'create' | 'clear'
  | 'createFolder' | 'renameFolder' | 'deleteFolder' | 'clearFolder' | 'meta'

// 复合操作（ops 数组）中的单个步骤：字段与单操作同义，参数见 AssistantReply 同名字段。
// 复合仅限可逆操作（assistant.ts 的 NON_COMPOSABLE_OPS 会在含不可逆项时整组转 ask 分步）
export interface OperateStep {
  op: OperateOp
  ids?: string[]
  value?: string // rename 的新标题 / favorite、unfavorite 的收藏夹名 / 各 folder op 的夹名 / meta 的新值 / modify 的修改需求
  target?: string // renameFolder 的旧夹名（AI 按名指代夹）
  field?: 'description' | 'language' // meta 的目标字段
  language?: string // create 的代码语言（复合中 create 不允许，保留用于一致性）
}

// assistantTurn 的返回契约（"解析 + 本地校验后的动作"）：store 据此分发。
// action 五选一；各动作的载荷：search/summarize 带 ids；operate 带 op（含 op:'modify'，其修改需求放 value）
export interface AssistantReply {
  action: 'search' | 'ask' | 'chat' | 'summarize' | 'operate'
  text: string // ask: 澄清问题；chat: 回复文本；search: 空串（结果由 ids+note 渲染）；summarize: 中文分析（可 markdown）；operate: 空串（操作说明由 op/value 渲染，modify 的 AI 提醒放 note）
  ids: string[]
  note: string
  // operate 的库结构操作：AI 只提议，用户确认后前端才执行
  op?: OperateOp
  value?: string // rename 的新标题 / favorite、unfavorite 的收藏夹名 / create 的标题或需求 / 各 folder op 的夹名 / meta 的新值 / modify 的修改需求
  target?: string // renameFolder 的旧夹名（AI 按名指代夹）
  field?: 'description' | 'language' // meta 的目标字段
  language?: string // create 的代码语言
  // 复合操作：一次指令要求做多件事（建夹+放入、改名+收藏、移动等）时的操作序列；
  // 仅限可逆操作，含 delete/clear/deleteFolder/clearFolder/create 时应在 assistant 转 ask 分步。
  // 与单 op 互斥：存在 ops 时忽略 op/value 等单操作字段
  ops?: OperateStep[]
}
