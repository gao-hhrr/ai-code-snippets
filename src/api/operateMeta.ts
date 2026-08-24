// ════════════════════════════════════════════════════════
// api/operateMeta.ts —— 操作分类元数据：动作 × 对象矩阵，行为规则由分类推导（从 assistant.ts 拆出）
// ════════════════════════════════════════════════════════
// D17（见 架构决策记录.md）：13 种操作 = 9 个原子动作 × 3 个对象（片段/收藏夹/库）的矩阵。
// 散落的 VALID_OPS / REVERSIBLE_OPS / NON_COMPOSABLE_OPS / 校验分支 / store 的 folderOps 全由这张表推导，
// 新增操作（复制片段、导出收藏夹等）= 表里加一行，其余代码零改动。
// 消费方：tools.ts（工具 enum）、operateValidate.ts（组合/校验）、assistant.ts、store（REVERSIBLE_OPS/OP_FOLDER）。
import type { OperateOp } from './types'

interface OpMeta {
  action: 'create' | 'modify' | 'rename' | 'meta' | 'favorite' | 'unfavorite' | 'delete' | 'clear' | 'export'
  target: 'snippet' | 'folder' | 'library'
  reversible: boolean // 语义可逆（低风险、可撤销/可重做）
  generative: boolean // 生成式：需二次流式生成内容 + 审阅（modify/create），执行走专用流程，不进 ops 自动执行
}
const OP_META: Record<OperateOp, OpMeta> = {
  create:       { action: 'create',     target: 'snippet', reversible: false, generative: true },
  modify:       { action: 'modify',     target: 'snippet', reversible: true,  generative: true },
  rename:       { action: 'rename',     target: 'snippet', reversible: true,  generative: false },
  meta:         { action: 'meta',       target: 'snippet', reversible: true,  generative: false },
  favorite:     { action: 'favorite',   target: 'snippet', reversible: true,  generative: false },
  unfavorite:   { action: 'unfavorite', target: 'snippet', reversible: true,  generative: false },
  delete:       { action: 'delete',     target: 'snippet', reversible: false, generative: false },
  export:       { action: 'export',     target: 'snippet', reversible: true,  generative: false },
  createFolder: { action: 'create',     target: 'folder',  reversible: true,  generative: false },
  renameFolder: { action: 'rename',     target: 'folder',  reversible: true,  generative: false },
  deleteFolder: { action: 'delete',     target: 'folder',  reversible: false, generative: false },
  clearFolder:  { action: 'clear',      target: 'folder',  reversible: false, generative: false },
  clear:        { action: 'clear',      target: 'library', reversible: false, generative: false }
}
// 合法操作全集（含 modify）：单一事实源，不再散落字面量（tools.ts 的 enum、operateValidate 复用）
export const VALID_OPS = Object.keys(OP_META) as OperateOp[]
// 按长度倒序：长 op（unfavorite/clearFolder…）先匹配，避免 favorite 抢在 unfavorite、clear 抢在 clearFolder 前
const VALID_OPS_BY_LENGTH = [...VALID_OPS].sort((a, b) => b.length - a.length)
// 可自动执行（可逆且非生成式）：单操作 store 直接执行（不弹确认卡）；复合操作（ops）也仅限这些。
// 导出供 store 复用（单一事实源）。modify/create 因生成式（需流式生成+审阅）不在其中。
export const REVERSIBLE_OPS: OperateOp[] = VALID_OPS.filter(op => OP_META[op].reversible && !OP_META[op].generative)
// 不可进 ops 组合：不可逆需单独确认（delete/clear/deleteFolder/clearFolder）+ 生成式需审阅（modify/create）
export const NON_COMPOSABLE_OPS = new Set<OperateOp>(VALID_OPS.filter(op => !OP_META[op].reversible || OP_META[op].generative))
// 收藏夹操作（按对象推导）：store/校验判断"夹操作按夹名指代、不需要片段编号"复用
export const OP_FOLDER = VALID_OPS.filter(op => OP_META[op].target === 'folder') as OperateOp[]

// 模型偶发在 op 字段里混入 XML 工具调用残留（实测如 favorite"><parameter name="ids">[1]），
// 导致 op 校验失败、复合操作整轮掉进通用 ask。从字符串开头匹配最长的合法 op 前缀救回污染值。
export function matchOp(value: unknown): OperateOp | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  for (const op of VALID_OPS_BY_LENGTH) {
    if (v.startsWith(op)) return op
  }
  return null
}
