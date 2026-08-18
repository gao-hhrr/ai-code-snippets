// ════════════════════════════════════════════════════════
// stores/aiAssistantStore.ts —— AI 助手状态中心：对话流式累积 / 四步阶段指示 / 6 工具库操作确认与执行
// ════════════════════════════════════════════════════════
import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import { assistantTurn, modifyCode, generateCode, summarizeThinking, AIError, isAbortError, REVERSIBLE_OPS } from '@/api/ai'
import type { AssistantTurnMessage, AssistantReply, OperateOp, OperateStep } from '@/api/ai'
import { downloadText, langToExt } from '@/services/file'
import { loadAIConversation, persistAIConversation } from '@/services/storage'
import { DRAFT_KEY } from '@/composables/useDraft'

export const useAiAssistantStore = defineStore('aiAssistant', () => {
  const snippetStore = useSnippetStore()
  // 对话从 sessionStorage 恢复（初始化读，与编辑器草稿同策略；临时状态，关标签页即清）。
  // 恢复时把"生成中"状态复位成失败：刷新/重进页面 = 请求已丢，保留 running 会恢复出永久转圈的卡
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
  // 与 snippetStore 的 watch(snippets, persistSnippets) 同一套模式。
  // 滚动位置不在这持久化：那是页面视图状态，改由 AiAssistantPage 用 sessionStorage 按草稿策略保存
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
  // 对话上限：16 轮（user 计数）。成本主体是候选片段不是历史，轮数翻倍成本只增约 40%；
  // 配合「换话题」按钮（不带历史物理换题），16 轮对连续筛选已很充裕
  const MAX_TURNS = 16
  // 单次请求超时：正常一轮 6-12s，但推理模型对否定/排除语义（"没有注释的"）推理可达 1000+ token、
  // 约 40-50 秒，30s 会误杀正常慢推理（实测超时后重试也必超时）；60s 兜底网络挂起与服务端异常
  const REQUEST_TIMEOUT = 60_000
  // 修改流程独立超时：改代码是重任务（推理 + 生成完整代码，30-90s 常见），不与搜索共用 60s——
  // assistantTurn 已耗的时间会压缩它；独立计时，stop 仍可中断
  const MODIFY_TIMEOUT = 90_000
  // 新建流程独立超时（分深度/非深度）：非深度（关思考直出）实测极端需求 42s 内完成，90s 兜底留足余量；
  // 深度思考（推理模式）才需要 180s 给"挑战极限"这类需求收敛空间。之前固定 180s 让非深度模式干等三分钟
  const CREATE_TIMEOUT = 90_000
  const DEEP_THINK_TIMEOUT = 180_000
  const controller = ref<AbortController | null>(null)
  // 修改流程的独立控制器：与搜索请求互不牵连，用户点停止时由 stop 一并中断
  let modifyController: AbortController | null = null
  // 新建流程（create 生成代码）的独立控制器：同 modify，生成是重任务，与搜索超时/中断解耦
  let createController: AbortController | null = null
  // 后台补全四步总结的控制器：主回复先显示、总结稍后到；新一轮 backfill / reset 作废上一个未完成的
  let summaryController: AbortController | null = null

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

  // 后台补全四步总结：消息 push 后立即返回，折叠面板先展示 reasoning 原文，总结跑完再替换成四步。
  // 一轮一个总结（新总结会作废未完成的旧总结）；失败/思考太短保持原文兜底，绝不影响主流程。
  // 通过响应式数组取回消息的 proxy 再赋值，确保触发渲染（传入的 msg 是 push 前的原始对象）
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

  async function send(text: string) {
    const q = text.trim()
    if (!q || sending.value) return
    // 轮数按 user 消息计（divider 等非对话消息不占名额）
    if (messages.value.filter(m => m.role === 'user').length >= MAX_TURNS) {
      error.value = { text: '对话已达上限，点击「重新开始」开启新对话', code: 'ERR_LIMIT' }
      return
    }

    messages.value.push({ role: 'user', content: q })
    sending.value = true
    error.value = null
    lastUserText.value = q
    elapsed.value = 0
    reasoning.value = ''
    composing.value = false

    // 等待秒数计时：驱动面板的"正在分析 → AI 思考中"阶段提示（超 20s 切换）
    const tick = setInterval(() => elapsed.value++, 1000)

    const ac = new AbortController()
    controller.value = ac
    let timedOut = false
    // 超时计时：503 退避重试会重置——重试是可恢复的明确信号，不能被"累计超时"掐断，
    // 但每个非重试阶段（正常请求/网络挂起）仍受 30s 兜底
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
      // 换话题后不带历史（freshSearch 用一次即复位）；否则取当前消息之前的全部（assistantTurn 内部自行裁剪）
      const history = freshSearch.value ? [] : messages.value.slice(0, -1)
      freshSearch.value = false
      const reply = await assistantTurn(history, q, snippetStore.snippets, snippetStore.folders, {
        signal: ac.signal,
        onRetry: () => {
          retrying.value = true
          armTimeout()
        },
        onReasoning: (delta) => {
          reasoning.value += delta
        },
        onChunk: () => {
          composing.value = true
        }
      })
      // AI 修改：assistantTurn 只判断"改哪个、改什么"，真正的改写走 modifyCode 流式（仍在 sending 内）。
      // 先停掉搜索的 60s 计时：改代码是重任务，由 runModify 用独立更长的超时（MODIFY_TIMEOUT）接管
      if (reply.action === 'modify') {
        clearTimeout(timeout)
        await runModify(reply)
        return
      }
      // AI 提议库操作：只生成确认卡，不执行，等用户确认（confirmOperate）；create 需先生成代码
      if (reply.action === 'operate') {
        await runOperate(reply)
        return
      }
      // 思考流存进消息：结果出来后用户仍可点开查看（sending 期间面板实时滚动，结束后转为折叠详情）
      // thinkingSummary 由 backfillSummary 后台补全：先展示 reasoning 原文，总结到后替换
      const msg: AssistantTurnMessage = { role: 'assistant', content: reply.text, searchIds: reply.ids, note: reply.note, reasoning: reasoning.value }
      messages.value.push(msg)
      backfillSummary(msg)
    } catch (err) {
      if (isAbortError(err)) {
        // 用户停止 vs 超时中止：超时给明确提示，主动停止只报"已停止"
        error.value = timedOut
          ? { text: '搜索超时（60 秒）：AI 推理较慢或网络不稳，已自动停止，请点重试', code: 'ERR_TIMEOUT' }
          : { text: '已停止搜索', code: 'ERR_ABORTED' }
      } else if (err instanceof AIError) {
        error.value = { text: err.message, code: err.code, status: err.status, detail: err.detail }
      } else {
        error.value = { text: 'AI 助手出错了，请重试', code: 'ERR_FALLBACK' }
      }
    } finally {
      clearInterval(tick)
      clearTimeout(timeout)
      retrying.value = false
      composing.value = false
      elapsed.value = 0
      if (controller.value === ac) controller.value = null
      sending.value = false
    }
  }

  // 重试上一条消息：先移除已展示的 user 消息再重发，避免重复
  function retry() {
    if (sending.value || !lastUserText.value) return
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'user' && last.content === lastUserText.value) {
      messages.value.pop()
    }
    send(lastUserText.value)
  }

  // AI 修改流程：AI 只给建议（modify 动作），改写在本地执行，结果存消息供 diff + 二次确认。
  // 二次确认 = 页面展示 AI 提醒文案 + diff 卡，"替换原代码"再弹确认框才真正落库。
  // 独立 AbortController + 独立超时：不共享 send 的 ac（搜索的 60s 已停），stop() 仍能中断
  async function runModify(reply: AssistantReply) {
    // 必须 reactive() 包裹再 push：数组里存的是 proxy，push 后直接改原始对象（msg.xxx = ...）
    // 不会经过 proxy → deep watch(messages, persist) 收不到触发 → 落盘停在 running → 刷新恢复成 error
    const msg = reactive<AssistantTurnMessage>({
      role: 'assistant',
      content: reply.text,
      note: reply.note,
      searchIds: reply.ids,
      reasoning: reasoning.value,
      requirement: reply.requirement,
      modifyState: 'running'
    })
    messages.value.push(msg)
    backfillSummary(msg)

    const target = snippetStore.snippets.find(s => s.id === reply.ids[0])
    if (!target || !reply.requirement) {
      msg.modifyState = 'error'
      msg.content += '（找不到目标片段或需求为空，请重试）'
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
    try {
      // 流式改写：onChunk 实时累加已生成字符数（修改卡显示进度），服务端边生成边返回，不再干等整段响应
      const result = await modifyCode(target.code, reply.requirement, {
        signal: mc.signal,
        thinking: deepThink.value,
        onChunk: (delta) => {
          composing.value = true
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
        msg.content += '（AI 未返回修改结果，请换种说法重试）'
      }
    } catch (err) {
      msg.modifyState = 'error'
      msg.content += timedOut
        ? '（修改超时：代码较长或 AI 推理较慢，已自动停止，请重试）'
        : isAbortError(err) ? '（修改已停止）' : '（修改失败，请重试）'
    } finally {
      clearTimeout(timer)
      if (modifyController === mc) modifyController = null
    }
  }

  // AI 提议库结构操作（删除/重命名/收藏/导出/新建/清空/收藏夹管理/改描述语言）：只展示确认卡，绝不直接执行。
  // create 需先在本地调 generateCode 生成代码，生成完才转待确认；收藏夹类操作 ids 为空，targetTitle 取夹名
  async function runOperate(reply: AssistantReply) {
    // 复合操作（ops）：一次指令做多件事，逐条执行（每步一张结果卡）；单操作转成单个 step 走同一路径
    const steps: OperateStep[] = reply.ops?.length
      ? reply.ops
      : [{ op: reply.op!, ids: reply.ids, value: reply.value, target: reply.target, field: reply.field, language: reply.language }]
    for (let i = 0; i < steps.length; i++) {
      // 复合操作的思考过程只挂第一条消息，避免多张卡重复显示同一段 reasoning
      await runOperateStep(steps[i], reply.note, i === 0 ? reasoning.value : '')
    }
  }

  // 单步库操作：create 生成代码转编辑页；可逆操作直接执行；不可逆操作落 pending 等用户确认。
  // 复合操作每步一条消息，状态机与单操作完全一致
  async function runOperateStep(step: OperateStep, note: string, reasoningText: string) {
    const isFolderOp = step.op === 'createFolder' || step.op === 'renameFolder' || step.op === 'deleteFolder' || step.op === 'clearFolder'
    const target = step.ids?.[0] ? snippetStore.snippets.find(s => s.id === step.ids![0]) : undefined
    // 同 runModify：必须 reactive() 包裹。create 生成中 push 后还要改 operateState/createdCode/createdProgress 等，
    // 改原始对象不会触发 deep watch 落盘 → 刷新时 create 卡停在 running 被恢复成 error（操作卡消失）
    const msg = reactive<AssistantTurnMessage>({
      role: 'assistant',
      content: '',
      note,
      searchIds: step.ids,
      reasoning: reasoningText,
      operateOp: step.op,
      operateValue: step.value,
      operateTarget: step.target,
      operateField: step.field,
      operateState: step.op === 'create' ? 'running' : 'pending',
      targetTitle: isFolderOp ? (step.op === 'renameFolder' ? step.target : step.value) : (target?.title || '')
    })
    messages.value.push(msg)
    // 复合操作后续步骤不带思考，也就不需要后台补四步总结
    if (reasoningText) backfillSummary(msg)

    if (step.op === 'create') {
      // 独立控制器 + 独立超时（对齐 runModify）：生成代码是重任务（推理 + 完整代码），
      // 不与搜索的 60s 共用——assistantTurn 已耗时间会压缩它；流式生成边出边报进度
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
      return
    }
    // 可逆操作：消息建好后立即落库（confirmOperate 内 switch → executed），卡片直接落到结果态
    if (REVERSIBLE_OPS.includes(step.op)) {
      confirmOperate(msg)
    }
  }

  // 用户确认后执行库结构操作（删除/清空等不可逆项，页面确认卡另有二次确认）。
  // 批量：delete/favorite/unfavorite 遍历 searchIds；收藏夹类按夹名指代（ids 为空）
  // 确认 AI 新建片段：不直接入库——把生成代码写入新建草稿（id=null），跳转编辑页让用户看完整代码、可修改，
  // 点保存才真正入库。草稿机制与编辑页 useDraft 共用（loadDraft 校验 id===null 自动预填）
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
  // 待编辑页回传结果的 create 消息：按「create + executed + 未回传」定位（每次只会有一个在途）——
  // 不用对象引用而是按谓词查找，编辑页刷新后 store 重建也能对上，结果回传不丢。
  // 回传设上 createSaved 后即不再是「待回传」，两次回传（保存成功 + 离开守卫）只生效一次
  function resolveCreateFromEditor(saved: boolean, snippetId?: string) {
    const msg = messages.value.find(m => m.operateOp === 'create' && m.operateState === 'executed' && m.createSaved === undefined && !!m.createdCode)
    if (!msg) return
    msg.createSaved = saved
    if (saved && snippetId) msg.createdSnippetId = snippetId
  }

  function confirmOperate(msg: AssistantTurnMessage) {
    if (msg.operateState !== 'pending') return
    // create 已改由 confirmCreateToEditor 处理（转编辑页看完整代码），不再在此直接入库
    if (msg.operateOp === 'create') return
    const folderOps: OperateOp[] = ['createFolder', 'renameFolder', 'deleteFolder', 'clearFolder']
    // clear/收藏夹类操作不需要片段编号，其他操作需要
    if (msg.operateOp !== 'clear' && !folderOps.includes(msg.operateOp!) && !msg.searchIds?.length) return
    try {
      const ids = msg.searchIds ?? []
      switch (msg.operateOp) {
        case 'delete':
          ids.forEach(id => snippetStore.deleteSnippet(id))
          break
        case 'rename': {
          const id = ids[0]
          if (id) snippetStore.updateSnippet(id, { title: msg.operateValue })
          break
        }
        case 'export': {
          const s = ids.length ? snippetStore.snippets.find(x => x.id === ids[0]) : undefined
          if (s) downloadText(s.code, s.title, langToExt(s.language))
          break
        }
        case 'favorite': {
          const f = snippetStore.folders.find(x => x.name === msg.operateValue)
          if (!f) {
            msg.operateState = 'error'
            msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
            return
          }
          ids.forEach(id => snippetStore.favoriteTo(id, f.id))
          break
        }
        case 'unfavorite': {
          const f = snippetStore.folders.find(x => x.name === msg.operateValue)
          if (!f) {
            msg.operateState = 'error'
            msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
            return
          }
          ids.forEach(id => snippetStore.unfavoriteFrom(id, f.id))
          break
        }
        case 'clear':
          snippetStore.clearAll()
          break
        case 'createFolder': {
          const id = snippetStore.addFolder(msg.operateValue || '')
          if (!id) {
            msg.operateState = 'error'
            msg.content = '（收藏夹重名或名称为空）'
            return
          }
          break
        }
        case 'renameFolder': {
          const f = snippetStore.folders.find(x => x.name === msg.operateTarget)
          if (!f) {
            msg.operateState = 'error'
            msg.content = `（找不到名为「${msg.operateTarget}」的收藏夹）`
            return
          }
          snippetStore.renameFolder(f.id, msg.operateValue || '')
          break
        }
        case 'deleteFolder': {
          const f = snippetStore.folders.find(x => x.name === msg.operateValue)
          if (!f) {
            msg.operateState = 'error'
            msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
            return
          }
          snippetStore.deleteFolder(f.id)
          break
        }
        case 'clearFolder': {
          const f = snippetStore.folders.find(x => x.name === msg.operateValue)
          if (!f) {
            msg.operateState = 'error'
            msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
            return
          }
          snippetStore.clearFolder(f.id)
          break
        }
        case 'meta': {
          const id = ids[0]
          if (!id) return
          snippetStore.updateSnippet(id, msg.operateField === 'language' ? { language: msg.operateValue } : { description: msg.operateValue })
          break
        }
      }
      msg.operateState = 'executed'
    } catch {
      msg.operateState = 'error'
    }
  }

  // 用户取消库结构操作
  function cancelOperate(msg: AssistantTurnMessage) {
    if (msg.operateState !== 'pending') return
    msg.operateState = 'cancelled'
  }

  // 保存 AI 修改为新片段：不直接落库，写草稿跳到编辑页预填（标题/语言继承原片段），
  // 用户在编辑页可改标题/语言/微调代码，点保存才真正 addSnippet（复用 create 的草稿机制）。
  // 与 create 共用 DRAFT_KEY 不冲突：一次只会有一个「进编辑页」的在途流程
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
  // 待编辑页回传结果的 modify 另存消息：按「done + pending 在途」定位（每次只会有一个在途）。
  // 用谓词而非引用定位：编辑页刷新后 store 重建也能对上，结果回传不丢。
  // 回传设上 modifySave 后即不再是「pending」，两次回传（保存成功 + 离开守卫）只生效一次
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

  // 导出 AI 修改结果
  function exportModify(msg: AssistantTurnMessage) {
    if (!msg.modifiedCode) return
    const target = snippetStore.snippets.find(s => s.id === msg.searchIds?.[0])
    downloadText(msg.modifiedCode, target?.title || 'snippet', target ? langToExt(target.language) : 'txt')
  }

  // 预置对话前提（详情页进入）：把指定片段作为一条"已找到"的结果消息，召回机制会把
  // history 里的 searchIds 排最前，后续提问/修改天然围绕该片段。
  // 保留已有对话不重置：旧对话选中的片段（仍留在 history 的 searchIds 里，召回会带上）
  // 和本次详情页片段都能继续选中；同片段已作为种子存在时去重，避免重复进入堆积卡片
  function seedContext(ids: string[], note: string) {
    const isSeed = (m: AssistantTurnMessage) => m.role === 'assistant' && !m.content && !m.divider && !!m.searchIds?.length
    const cur = messages.value.find(isSeed)
    if (cur && cur.searchIds?.some(id => ids.includes(id))) return
    messages.value.push({ role: 'assistant', content: '', note, searchIds: ids })
  }

  return { messages, sending, retrying, reasoning, composing, phase, elapsed, error, lastUserText, deepThink, MAX_TURNS, reset, stop, send, retry, switchTopic, saveModifyToEditor, resolveModifyFromEditor, replaceModify, undoReplace, exportModify, seedContext, runOperate, confirmOperate, confirmCreateToEditor, resolveCreateFromEditor, cancelOperate }
})
