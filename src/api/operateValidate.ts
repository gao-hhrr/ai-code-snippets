// ════════════════════════════════════════════════════════
// api/operateValidate.ts —— 操作语义校验：复合单步校验 + 混合请求词表 + 编号映射（从 assistant.ts 拆出）
// ════════════════════════════════════════════════════════
// API 协议只保证模型输出是合法 JSON，语义正确性（op 合法 / 参数齐全 / 编号不越界）靠本文件兜底：
//   任一步校验不过 → 整组转 ask 分步，避免「建夹了但片段没放进去」这类部分执行。
// 组合约束（NON_COMPOSABLE_OPS / OP_FOLDER）来自 operateMeta 分类表，不散落字面量。
import { matchOp, NON_COMPOSABLE_OPS, OP_FOLDER } from './operateMeta'
import type { OperateStep, SearchSnippet } from './types'

// 复合操作里混入新建代码时的引导文案：create 必须先进入编辑页确认保存，与收藏夹等同步操作无法一组落地。
// 模型只会把用户完整意图写进 ops，这里统一转 ask 分两步（先建代码，再建夹+放入）——
// 否则模型会随机只做其中一部分（实测：只建夹不建代码、或只建代码把收藏夹丢进 note）
export const CREATE_COMBO_ASK = '新建代码需要先进入编辑页确认保存，不能和收藏夹等操作一起做。建议分两步：先单独说「新建一个 xx 的代码」保存好，再对我说「新建收藏夹 xx，把刚才的放进去」，我一步完成。'

// 修改代码 + 库操作混合请求（"把第 1 个改成 xx，顺便放进新建的 常用 夹"）引导文案：
// 与 CREATE_COMBO_ASK 同模式——modify 是生成式操作（流式生成+diff 审阅）、库操作是声明式，两类无法一组落地。
// 双保险：模型把 modify 混进 ops → NON_COMPOSABLE_OPS 整组拒转 ask；模型只挑单 op（丢弃另一半）→ hasMixedIntent 兜底。
export const MODIFY_COMBO_ASK = '修改代码和收藏夹等库操作不能一步完成。建议分两步：先单独说「把要改的片段改成 xx」，确认保存好改动；再对我说「新建收藏夹 xx，把刚才的放进去」，我一步完成。'

// 混合请求本地兜底词表：模型已选 operate 时，检测用户原文是否同时含"改代码"与"库操作"意图，
// 命中说明另一半被静默丢弃 → 转 MODIFY_COMBO_ASK 分步。词表刻意保守，两处注意：
// ①「改名/重命名/改描述/改语言」是库操作（模型该走 operate），不能进 MODIFY_WORDS，否则"改名并收藏"这类
//   纯声明式复合会被误杀；
// ② 不用裸"修改/优化"——作名词/过去指代太常见（实测"新建收藏夹，把刚才修改的代码放进去"被误伤成混合请求），
//   只收主动改代码短语（改成/改一下/帮我改/修改成/优化一下…）。
// 宁可漏杀（漏了还有 prompt 规则 + validateOperateStep 双保险）也不误伤正常复合操作。
const MODIFY_WORDS = ['改成', '改一下', '改改', '帮我改', '给我改', '修改成', '修改一下', '帮我修改', '优化一下', '优化下', '重写', '重构', '换成', '精简', '美化']
const LIB_OP_WORDS = ['收藏', '新建', '放入', '放进', '夹', '重命名', '改名', '导出', '删除', '清空', '移动']
export function hasMixedIntent(message: string): boolean {
  return MODIFY_WORDS.some(w => message.includes(w)) && LIB_OP_WORDS.some(w => message.includes(w))
}

// 模型输出编号 → 候选下标：去重、丢弃越界/非整数（编号对应候选集，返回时映射回真实 id）。
// 各处动作（search/summarize 与 operate 各 op 的目标片段）共用同一套编号校验。
export function mapValidIds(ids: unknown, max: number): number[] {
  return [...new Set(
    Array.isArray(ids) ? ids.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 1 && n <= max) : []
  )]
}

// 复合操作单步校验：op 合法、参数齐全（片段编号/夹名/新值），且不是非可逆操作。
// 任一步不过 → 整组转 ask 分步，避免「建夹了但片段没放进去」这类部分执行。
export function validateOperateStep(
  raw: Record<string, unknown>,
  candidates: SearchSnippet[]
): { ok: true; step: OperateStep } | { ok: false; ask: string } {
  const op = matchOp(raw.op)
  if (!op) return { ok: false, ask: '我没太理解你想做什么操作，请说清楚，比如「把第一个删了」「收藏到默认收藏」。' }
  if (NON_COMPOSABLE_OPS.has(op)) {
    // create 是「转编辑页审阅保存」的异步流程，与同步可逆操作粒度不同，专门引导分两步并给出示例说法
    if (op === 'create') {
      return { ok: false, ask: CREATE_COMBO_ASK }
    }
    // modify 是生成式操作（流式生成+diff 审阅），与声明式库操作无法一组落地，引导分步
    if (op === 'modify') {
      return { ok: false, ask: MODIFY_COMBO_ASK }
    }
    return { ok: false, ask: '这个操作包含删除/清空等不可逆步骤，需要单独确认。建议先做收藏/改名等可逆部分，删除/清空单独告诉我，我会弹确认框。' }
  }
  const value = typeof raw.value === 'string' && raw.value.trim() ? raw.value.trim() : ''
  const toIds = (ids: unknown) => mapValidIds(ids, candidates.length).map(n => candidates[n - 1].id)
  if (OP_FOLDER.includes(op)) {
    if (op === 'renameFolder') {
      const target = typeof raw.target === 'string' && raw.target.trim() ? raw.target.trim() : ''
      if (!value || !target) return { ok: false, ask: '要把哪个收藏夹改叫什么名字？比如「把 学习 夹改名叫 工作」。' }
      return { ok: true, step: { op, value, target } }
    }
    if (!value) {
      const q = op === 'createFolder' ? '新夹想叫什么名字？比如「新建一个收藏夹叫 常用」。' : op === 'deleteFolder' ? '要删哪个收藏夹？告诉我夹名。' : '要清空哪个收藏夹？告诉我夹名。'
      return { ok: false, ask: q }
    }
    return { ok: true, step: { op, value } }
  }
  if (op === 'meta') {
    const field = raw.field === 'description' || raw.field === 'language' ? raw.field : null
    if (!field || !value) return { ok: false, ask: '要改哪个片段的描述或语言？说下目标和新的值。' }
    const ids = toIds(raw.ids)
    if (ids.length === 0) return { ok: false, ask: '你想改哪个片段？告诉我是第几个。' }
    return { ok: true, step: { op, ids, value, field } }
  }
  // rename / export / favorite / unfavorite：片段操作
  const ids = toIds(raw.ids)
  if (ids.length === 0) return { ok: false, ask: '你想操作哪个片段？告诉我是第几个，比如「把第一个收藏到 常用」。' }
  if ((op === 'rename' || op === 'favorite' || op === 'unfavorite') && !value) {
    const q = op === 'rename' ? '重命名成什么标题？' : op === 'favorite' ? '收藏到哪个收藏夹？' : '从哪个收藏夹移出？'
    return { ok: false, ask: q }
  }
  return { ok: true, step: { op, ids, value: value || undefined } }
}
