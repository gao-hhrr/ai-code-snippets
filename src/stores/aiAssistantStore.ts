// ════════════════════════════════════════════════════════
// stores/aiAssistantStore.ts —— AI 助手状态中心：对话流式累积 / 四步阶段指示 / 5 工具库操作确认与执行
// 文件按域分区（对齐 snippetStore 的 ════ 区块风格）：状态与常量 → 对话主流程 → 操作流程 → 修改流程 → 对话辅助 → 导出
// 操作执行翻译（OPERATE_EXEC 映射表）放模块级：纯逻辑不依赖闭包，新增 op 只加一条映射
// ════════════════════════════════════════════════════════
import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import { assistantTurn, modifyCode, generateCode, summarizeThinking, AIError, isAbortError, REVERSIBLE_OPS, OP_FOLDER } from '@/api/ai'
import type { AssistantTurnMessage, AssistantReply, OperateStep, OperateOp } from '@/api/ai'
import { downloadText, langToExt } from '@/services/file'
import { loadAIConversation, persistAIConversation } from '@/services/storage'
import { DRAFT_KEY } from '@/composables/useDraft'

// ════════════════════════════════════════════════════════
// 操作执行：把确认的 AI 操作消息翻译成 snippetStore 的调用
// handler 返回 false = 已设 error（找不到目标等），confirmOperate 收到 false 不标记 executed；
// snippetStore 由参数传入，模块不依赖 store 闭包，便于单测
// ════════════════════════════════════════════════════════

// OpHandler 契约：msg 携带操作数据（operateOp/searchIds/operateValue 等），store 外部传入便于单测；
// 返回 void/true = 成功，false = 已设 error
type OpHandler = (msg: AssistantTurnMessage, store: ReturnType<typeof useSnippetStore>) => boolean | void

// 操作分发表。Partial<> 让 create/modify 可缺省：create 转编辑页、modify 走 ModifyCard，不在此执行
const OPERATE_EXEC: Partial<Record<OperateOp, OpHandler>> = {
  // searchIds 可能为空；空数组 forEach 不执行，天然安全
  delete(msg, store) {
    (msg.searchIds ?? []).forEach(id => store.deleteSnippet(id))
  },

  // 重命名只取第一个片段
  rename(msg, store) {
    const id = msg.searchIds?.[0]
    if (id) store.updateSnippet(id, { title: msg.operateValue })
  },

  // 导出第一条片段为代码文件
  export(msg, store) {
    const s = msg.searchIds?.length ? store.snippets.find(x => x.id === msg.searchIds![0]) : undefined
    if (s) downloadText(s.code, s.title, langToExt(s.language))
  },

  // 找不到收藏夹 → 标记错误返回 false，confirmOperate 不置 executed
  favorite(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    (msg.searchIds ?? []).forEach(id => store.favoriteTo(id, f.id))
  },

  unfavorite(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    (msg.searchIds ?? []).forEach(id => store.unfavoriteFrom(id, f.id))
  },

  clear(_, store) {
    store.clearAll()
  },

  // addFolder 返回空 id = 重名或空名称
  createFolder(msg, store) {
    const id = store.addFolder(msg.operateValue || '')
    if (!id) {
      msg.operateState = 'error'
      msg.content = '（收藏夹重名或名称为空）'
      return false
    }
  },

  // operateTarget = 旧名，operateValue = 新名
  renameFolder(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateTarget)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateTarget}」的收藏夹）`
      return false
    }
    store.renameFolder(f.id, msg.operateValue || '')
  },

  deleteFolder(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    store.deleteFolder(f.id)
  },

  // 只清空夹内片段，夹本身保留
  clearFolder(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    store.clearFolder(f.id)
  },

  // operateField 决定改 language 还是 description
  meta(msg, store) {
    const id = msg.searchIds?.[0]
    if (!id) return
    store.updateSnippet(id, msg.operateField === 'language'
      ? { language: msg.operateValue }
      : { description: msg.operateValue })
  },
}


export const useAiAssistantStore = defineStore('aiAssistant', () => {
  const snippetStore = useSnippetStore()

  // ════════════════════════════════════════════════════════
  // 状态与常量
  // ════════════════════════════════════════════════════════
  // 对话从 sessionStorage 恢复（临时状态，关标签页即清）。
  // 恢复时把"生成中"复位成失败：刷新 = 请求已丢，保留 running 会恢复出永久转圈的卡
  const messages = ref<AssistantTurnMessage[]>(loadAIConversation().map(m => {
    if (m.modifyState === 'running') return { ...m, modifyState: 'error', content: m.content + '（修改被中断，请重新发起）' }
    if (m.operateState === 'running') return { ...m, operateState: 'error' }
    return m
  }))
  const sending = ref(false)
  // 结构化错误：人话 text 给用户看，code/status/detail 供「详情」展开与调试定位
  const error = ref<{ text: string; code?: string; status?: number; detail?: string } | null>(null)
  // 本轮等待秒数（sending 期间每秒 +1）：超过阈值页面切换"AI 思考中"阶段提示
  const elapsed = ref(0)
  // 最近一次发送的用户消息（供「重试」一键重发）
  const lastUserText = ref('')
  // 对话任何变化自动落盘（deep：backfillSummary 改 thinkingSummary 等也能存到），
  // 与 snippetStore 同一套 watch+persist 模式；滚动位置是页面视图状态，不在此持久化
  watch(messages, persistAIConversation, { deep: true })

  // 503 过载退避重试中：页面显示"服务器繁忙，自动重试中"
  const retrying = ref(false)
  // 推理模型的思考过程流（sending 期间逐段累积）：内部用于二次总结，不直接展示原文
  const reasoning = ref('')
  // 模型已开始输出最终内容（onChunk 触发）：对应阶段指示的「构思回应」
  const composing = ref(false)
  // 阶段进度状态机：驱动等待气泡的四步指示（分析请求→梳理信息→解读意图→构思回应）
  const phase = computed<'retrieve' | 'analyze' | 'compose' | null>(() => {
    if (!sending.value) return null
    if (retrying.value) return null // 重试时显示重试提示，不显示阶段
    if (composing.value) return 'compose'
    if (reasoning.value) return 'analyze'
    return 'retrieve'
  })
  // 换话题：下一次发送不带历史（模型视角全新搜索），发完自动复位
  const freshSearch = ref(false)
  // 深度思考开关：默认关（生成/修改走非推理，快而稳）；开启后走推理，复杂需求质量更高但更慢
  const deepThink = ref(false)
  // 对话上限：12 轮（user 计数），与历史窗口对齐——历史留最近 12 条（=6 轮），
  // 即「一次会话 ≈ 2 个历史窗口」；成本主体是候选片段，配合「换话题」已很充裕
  const MAX_TURNS = 12
  // 60s：推理模型对否定/排除语义可达 40-50s，30s 会误杀正常慢推理；60s 兜底网络挂起与服务端异常
  const REQUEST_TIMEOUT = 60_000
  // 修改独立超时：改代码是重任务（30-90s 常见），不与搜索共用 60s——assistantTurn 已耗时间会压缩它
  const MODIFY_TIMEOUT = 90_000
  // 新建独立超时：非深度实测极端需求 42s 内，90s 兜底；深度思考（推理）才需 180s 给极限需求收敛空间
  const CREATE_TIMEOUT = 90_000
  const DEEP_THINK_TIMEOUT = 180_000
  const controller = ref<AbortController | null>(null)
  // 修改流程的独立控制器：与搜索请求互不牵连，用户点停止时由 stop 一并中断
  let modifyController: AbortController | null = null
  // 新建流程（create 生成代码）的独立控制器：同 modify，生成是重任务，与搜索超时/中断解耦
  let createController: AbortController | null = null
  // 后台补全四步总结的控制器：主回复先显示、总结稍后到；新一轮 backfill / reset 作废上一个未完成的
  let summaryController: AbortController | null = null

  // ════════════════════════════════════════════════════════
  // 对话主流程：重置 / 停止 / 换话题 / 发送 / 重试
  // ════════════════════════════════════════════════════════
  function reset() {
    controller.value?.abort()
    modifyController?.abort()
    modifyController = null
    createController?.abort()
    createController = null
    summaryController?.abort()
    summaryController = null
    messages.value = []
    error.value = null
    // 重试目标一并清掉：新会话里不会误发旧消息
    lastUserText.value = ''
    // 清空后 watch 自动把 [] 落盘，刷新后不再出现旧对话
  }

  // 用户主动停止搜索/修改（AbortError 由 catch 分支转为提示）
  function stop() {
    controller.value?.abort()
    modifyController?.abort()
    createController?.abort()
  }

  // 换话题：插入可见分割线 + 置 freshSearch，下一条消息不带历史发送（divider 不计轮数）
  function switchTopic() {
    if (sending.value || messages.value.length === 0) return
    freshSearch.value = true
    messages.value.push({ role: 'assistant', content: '', divider: true })
  }

  // 用户发送普通提问主函数
  async function send(text: string) {
    const q = text.trim()
    if (!q || sending.value) return  // 空输入 / 请求中，防止重复提交

    // 轮数只统计用户消息，divider、assistant 回复不计入
    if (messages.value.filter(m => m.role === 'user').length >= MAX_TURNS) {
      error.value = { text: '对话已达上限，点击「重新开始」开启新对话', code: 'ERR_LIMIT' }
      return
    }

    messages.value.push({ role: 'user', content: q })
    sending.value = true
    error.value = null
    lastUserText.value = q  // 供「重试」一键重发
    elapsed.value = 0
    reasoning.value = ''
    composing.value = false

    // 每秒 elapsed+1，页面据此展示"AI 思考很久"提示；AbortController 供 stop() 中断
    const tick = setInterval(() => elapsed.value++, 1000)
    const ac = new AbortController()
    controller.value = ac

    // timedOut 区分【用户手动停止】vs【超时自动终止】；503 重试时需重新倒计时（armTimeout 再调用）
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    function armTimeout() {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        timedOut = true
        ac.abort()
      }, REQUEST_TIMEOUT)
    }
    armTimeout()

    try {
      // 换话题时历史为空（物理换题）；freshSearch 只生效一次，用完复位
      const history = freshSearch.value ? [] : messages.value.slice(0, -1)
      freshSearch.value = false

      const reply = await assistantTurn(history, q, snippetStore.snippets, snippetStore.folders, {
        signal: ac.signal,
        onRetry: () => {  // 503 过载自动重试，超时重新倒计时
          retrying.value = true
          armTimeout()
        },
        onReasoning: (delta) => { reasoning.value += delta },
        onChunk: () => { composing.value = true }  // 收到正文 → 阶段切「构思回应」
      })

      // operate：渲染确认卡片，不直接执行
      if (reply.action === 'operate') {
        await runOperate(reply)
        return
      }

      // 普通问答：组装消息入列表，后台异步补思考摘要（不阻塞主流程）
      const msg: AssistantTurnMessage = { role: 'assistant', content: reply.text, searchIds: reply.ids, note: reply.note, reasoning: reasoning.value }
      messages.value.push(msg)
      backfillSummary(msg)

    } catch (err) {
      // 中止分两类：超时 vs 用户手动停止，给不同文案
      if (isAbortError(err)) {
        error.value = timedOut
          ? { text: '搜索超时（60 秒）：AI 推理较慢或网络不稳，已自动停止，请点重试', code: 'ERR_TIMEOUT' }
          : { text: '已停止搜索', code: 'ERR_ABORTED' }
      } else if (err instanceof AIError) {
        error.value = { text: err.message, code: err.code, status: err.status, detail: err.detail }
      } else {
        error.value = { text: 'AI 助手出错了，请重试', code: 'ERR_FALLBACK' }
      }
    } finally {
      // 必清理：防内存泄漏；controller 用守卫判断，避免覆盖 reset() 的新赋值
      clearInterval(tick)
      clearTimeout(timeout)
      retrying.value = false
      composing.value = false
      elapsed.value = 0
      if (controller.value === ac) controller.value = null
      sending.value = false
    }
  }

  // 重试上一条：失败/超时后末尾仍停在 user，先移除它避免 send 重新 push 造成重复
  function retry() {
    if (sending.value || !lastUserText.value) return
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'user' && last.content === lastUserText.value) {
      messages.value.pop()
    }
    send(lastUserText.value)
  }

  // ════════════════════════════════════════════════════════
  // 操作流程：AI 提议库结构操作（删除/重命名/收藏/导出/新建/清空/收藏夹/改描述语言/修改代码）
  // ════════════════════════════════════════════════════════
  // AI 提议库结构操作：只展示确认卡绝不直接执行；create 先本地生成代码再转待确认
  async function runOperate(reply: AssistantReply) {
    // 复合操作逐条执行（每步一张结果卡）；单操作转单 step 走同一路径
    const steps: OperateStep[] = reply.ops?.length
      ? reply.ops
      : [{ op: reply.op!, ids: reply.ids, value: reply.value, target: reply.target, field: reply.field, language: reply.language }]
    for (let i = 0; i < steps.length; i++) {
      // 复合操作的思考过程只挂第一条消息，避免多张卡重复显示同一段 reasoning
      await runOperateStep(steps[i], reply.note, i === 0 ? reasoning.value : '')
    }
  }

  // 单步库操作：create 转编辑页、可逆操作直接执行、不可逆落 pending 等确认；每步一条消息
  async function runOperateStep(step: OperateStep, note: string, reasoningText: string) {
    const msg = buildOperateMsg(step, note, reasoningText)
    messages.value.push(msg)
    // 复合操作后续步骤不带思考，也就不需要后台补四步总结
    if (reasoningText) backfillSummary(msg)
    if (step.op === 'modify') return runModifyStep(step, msg)
    if (step.op === 'create') return runCreateStep(step, msg)
    // 可逆操作：消息建好后立即落库，卡片直接到结果态
    if (REVERSIBLE_OPS.includes(step.op)) confirmOperate(msg)
  }

  // 生成式分支（create/modify）必须 reactive() 包裹：生成中要改 operateState/createdCode 等字段，
  // 改原始对象不触发 deep watch 落盘 → 刷新时卡停在 running 被恢复成 error（操作卡消失）
  function buildOperateMsg(step: OperateStep, note: string, reasoningText: string) {
    const isFolderOp = OP_FOLDER.includes(step.op)
    const target = step.ids?.[0] ? snippetStore.snippets.find(s => s.id === step.ids![0]) : undefined
    return reactive<AssistantTurnMessage>({
      role: 'assistant',
      content: '',
      note,
      searchIds: step.ids,
      reasoning: reasoningText,
      operateOp: step.op,
      operateValue: step.value,
      operateTarget: step.target,
      operateField: step.field,
      // modify 不设 operateState：走 ModifyCard 渲染（modifyState 字段组），OperateCard 不会误渲染
      operateState: step.op === 'modify' ? undefined : (step.op === 'create' ? 'running' : 'pending'),
      targetTitle: isFolderOp ? (step.op === 'renameFolder' ? step.target : step.value) : (target?.title || '')
    })
  }

  // 单修改（改代码）：assistantTurn 只判定"改哪个+怎么改"（ids+value），真正改写走 modifyCode 流式
  async function runModifyStep(step: OperateStep, msg: AssistantTurnMessage) {
    const target = step.ids?.[0] ? snippetStore.snippets.find(s => s.id === step.ids![0]) : undefined
    if (!target || !step.value) {
      msg.modifyState = 'error'
      msg.content = '（找不到目标片段或需求为空，请重试）'
      return
    }
    const mc = new AbortController()
    modifyController = mc
    let timedOut = false
    // 修改同样受深度思考开关影响：非深度 90s 兜底，深度思考（推理）放宽到 180s
    const timer = setTimeout(() => {
      timedOut = true
      mc.abort()
    }, deepThink.value ? DEEP_THINK_TIMEOUT : MODIFY_TIMEOUT)
    msg.requirement = step.value
    try {
      // 流式改写：onChunk 实时累加已生成字符数（修改卡显示进度）
      const result = await modifyCode(target.code, step.value, {
        signal: mc.signal,
        thinking: deepThink.value,
        onChunk: (delta) => {
          msg.modifyProgress = (msg.modifyProgress ?? 0) + delta.length
        },
        // 深度思考失败降级：标记消息，ModifyCard 提示用户本次是普通模式结果
        onFallback: () => { msg.modifiedDegraded = true }
      })
      if (result) {
        msg.modifiedCode = result
        msg.modifyState = 'done'
      } else {
        msg.modifyState = 'error'
        msg.content = '（AI 未返回修改结果，请换种说法重试）'
      }
    } catch (err) {
      msg.modifyState = 'error'
      msg.content = timedOut
        ? '（修改超时：代码较长或 AI 推理较慢，已自动停止，请重试）'
        : isAbortError(err) ? '（修改已停止）' : '（修改失败，请重试）'
    } finally {
      clearTimeout(timer)
      if (modifyController === mc) modifyController = null
    }
  }

  // 新建（create 生成代码）：独立控制器 + 超时（对齐 modify），生成是重任务、不与搜索 60s 共用
  async function runCreateStep(step: OperateStep, msg: AssistantTurnMessage) {
    const cc = new AbortController()
    createController = cc
    let timedOut = false
    // 超时随深度思考开关走：非深度直出 90s 兜底，深度思考（推理）放宽到 180s
    const timer = setTimeout(() => {
      timedOut = true
      cc.abort()
    }, deepThink.value ? DEEP_THINK_TIMEOUT : CREATE_TIMEOUT)
    try {
      const code = await generateCode(step.value || '', step.language || 'text', {
        signal: cc.signal,
        thinking: deepThink.value,
        onChunk: (delta) => {
          msg.createdProgress = (msg.createdProgress ?? 0) + delta.length
        },
        // 深度思考失败降级：标记消息，OperateCard 提示用户本次结果是普通模式生成
        onFallback: () => { msg.createdDegraded = true }
      })
      if (code) {
        msg.createdCode = code
        msg.createdLanguage = step.language
        msg.operateState = 'pending'
      } else {
        msg.operateState = 'error'
        msg.content = '（AI 未生成代码，请换种说法重试）'
      }
    } catch (err) {
      msg.operateState = 'error'
      msg.content = timedOut
        ? '（生成超时：AI 推理较慢，已自动停止，请重试）'
        : isAbortError(err) ? '（生成已停止）' : '（生成失败，请重试）'
    } finally {
      clearTimeout(timer)
      if (createController === cc) createController = null
    }
  }

  // 确认 AI 新建：不直接入库——写草稿（id=null）跳编辑页，用户确认后保存才入库（复用 useDraft 草稿机制）
  function confirmCreateToEditor(msg: AssistantTurnMessage) {
    if (!msg.createdCode) return
    // pending = 首次进入；executed + 未保存 = 从对话卡「重新编辑」再次进入（代码仍保留在消息里）
    const canEnter = msg.operateState === 'pending' || (msg.operateState === 'executed' && msg.createSaved === false)
    if (!canEnter) return
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      id: null,
      title: msg.operateValue || '',
      code: msg.createdCode,
      language: msg.createdLanguage || 'text',
      description: ''
    }))
    msg.operateState = 'executed'
    // 重新进入：清掉上次「未保存」标记，等待本次编辑页结果回传
    msg.createSaved = undefined
  }
  // 按谓词而非引用定位在途 create：编辑页刷新后 store 重建也能对上；回传设上 createSaved 后只生效一次
  function resolveCreateFromEditor(saved: boolean, snippetId?: string) {
    const msg = messages.value.find(m => m.operateOp === 'create' && m.operateState === 'executed' && m.createSaved === undefined && !!m.createdCode)
    if (!msg) return
    msg.createSaved = saved
    if (saved && snippetId) msg.createdSnippetId = snippetId
  }

  // 用户确认后执行库结构操作（不可逆项页面另有二次确认）。
  // 执行翻译收敛在 OPERATE_EXEC，这里只做状态守卫 + 统一落状态
  function confirmOperate(msg: AssistantTurnMessage) {
    if (msg.operateState !== 'pending') return
    // create 已改由 confirmCreateToEditor 处理（转编辑页看完整代码），不再在此直接入库
    if (msg.operateOp === 'create') return
    // clear/收藏夹类操作不需要片段编号，其他操作需要（夹操作名单来自 OP_META 推导）
    if (msg.operateOp !== 'clear' && !OP_FOLDER.includes(msg.operateOp!) && !msg.searchIds?.length) return
    try {
      // handler 返回 false = 已设 error（找不到目标等），跳过 executed
      const ok = OPERATE_EXEC[msg.operateOp!]?.(msg, snippetStore) ?? true
      if (ok) msg.operateState = 'executed'
    } catch {
      msg.operateState = 'error'
    }
  }

  function cancelOperate(msg: AssistantTurnMessage) {
    if (msg.operateState !== 'pending') return
    msg.operateState = 'cancelled'
  }

  // ════════════════════════════════════════════════════════
  // 修改流程：AI 修改代码的另存 / 替换 / 撤销 / 导出 + 编辑页回传
  // ════════════════════════════════════════════════════════
  // 保存 AI 修改为新片段：写草稿跳编辑页预填（标题/语言继承原片段），保存才真正 addSnippet。
  // 与 create 共用 DRAFT_KEY 不冲突——一次只会有一个「进编辑页」的在途流程
  function saveModifyToEditor(msg: AssistantTurnMessage) {
    if (!msg.modifiedCode || !msg.searchIds?.length || msg.modifyApplied) return
    const target = snippetStore.snippets.find(s => s.id === msg.searchIds![0])
    if (!target) return
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      id: null,
      title: target.title + ' (AI 优化)',
      code: msg.modifiedCode,
      language: target.language,
      description: target.description || ''
    }))
    msg.modifySave = 'pending'
  }
  // 按谓词而非引用定位在途另存：编辑页刷新后 store 重建也能对上；回传设上 modifySave 后只生效一次
  function resolveModifyFromEditor(saved: boolean, snippetId?: string) {
    const msg = messages.value.find(m => m.modifyState === 'done' && m.modifySave === 'pending' && !!m.modifiedCode)
    if (!msg) return
    msg.modifySave = saved
    if (saved) {
      msg.modifyApplied = true
      if (snippetId) msg.modifySavedSnippetId = snippetId
    }
  }

  // 用 AI 修改替换原代码：覆盖现有内容不可逆，调用前页面须弹二次确认框；
  // 替换前把原代码暂存到 msg（随对话落盘），卡片显示「撤销替换」可一键恢复
  function replaceModify(msg: AssistantTurnMessage) {
    if (!msg.modifiedCode || !msg.searchIds?.length || msg.modifyApplied) return
    const target = snippetStore.snippets.find(s => s.id === msg.searchIds![0])
    if (!target) return
    msg.modifyBackup = target.code
    snippetStore.updateSnippet(msg.searchIds![0], { code: msg.modifiedCode })
    msg.modifyApplied = true
  }

  // 撤销替换：用替换前暂存的原代码恢复，modifyApplied 回退为未应用（按钮重新可点）
  function undoReplace(msg: AssistantTurnMessage) {
    if (!msg.modifyApplied || !msg.modifyBackup || !msg.searchIds?.length) return
    snippetStore.updateSnippet(msg.searchIds![0], { code: msg.modifyBackup })
    msg.modifyApplied = false
    msg.modifyBackup = undefined
  }

  function exportModify(msg: AssistantTurnMessage) {
    if (!msg.modifiedCode) return
    const target = snippetStore.snippets.find(s => s.id === msg.searchIds?.[0])
    downloadText(msg.modifiedCode, target?.title || 'snippet', target ? langToExt(target.language) : 'txt')
  }

  // ════════════════════════════════════════════════════════
  // 对话辅助：后台补四步总结 / 预置对话前提
  // ════════════════════════════════════════════════════════
  // 后台补四步总结：push 后立即返回，折叠面板先展示 reasoning 原文，跑完再替换。
  // 一轮一个总结，失败/太短保持原文兜底；经响应式数组取回 proxy 赋值确保触发渲染
  function backfillSummary(msg: AssistantTurnMessage) {
    const text = reasoning.value.trim()
    if (text.length < 30) return
    summaryController?.abort()
    const sc = new AbortController()
    summaryController = sc
    // 30s 兜底：后台总结挂起时不能无限占着连接
    const timer = setTimeout(() => sc.abort(), 30_000)
    summarizeThinking(text, { signal: sc.signal })
      .then(s => {
        if (!s) return
        const idx = messages.value.indexOf(msg)
        if (idx >= 0 && messages.value[idx].thinkingSummary === undefined) {
          messages.value[idx].thinkingSummary = s
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer)
        if (summaryController === sc) summaryController = null
      })
  }

  // 预置对话前提（详情页进入）：把指定片段作为"已找到"结果消息，history 里的 searchIds 召回排最前，
  // 后续提问/修改天然围绕该片段。不重置已有对话；同片段已有种子时去重，避免重复堆积
  function seedContext(ids: string[], note: string) {
    const isSeed = (m: AssistantTurnMessage) => m.role === 'assistant' && !m.content && !m.divider && !!m.searchIds?.length
    const cur = messages.value.find(isSeed)
    if (cur && cur.searchIds?.some(id => ids.includes(id))) return
    messages.value.push({ role: 'assistant', content: '', note, searchIds: ids })
  }

  // ════════════════════════════════════════════════════════
  // 导出
  // ════════════════════════════════════════════════════════
  return { messages, sending, retrying, reasoning, composing, phase, elapsed, error, lastUserText, deepThink, MAX_TURNS, reset, stop, send, retry, switchTopic, saveModifyToEditor, resolveModifyFromEditor, replaceModify, undoReplace, exportModify, seedContext, runOperate, confirmOperate, confirmCreateToEditor, resolveCreateFromEditor, cancelOperate }
})
