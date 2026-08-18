// ════════════════════════════════════════════════════════
// stores/aiAssistantStore.ts —— AI 助手状态中心：对话流式累积 / 四步阶段指示 / 6 工具库操作确认与执行
// ════════════════════════════════════════════════════════
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import { assistantTurn, modifyCode, generateCode, summarizeThinking, AIError, isAbortError } from '@/api/ai'
import type { AssistantTurnMessage, AssistantReply, OperateOp } from '@/api/ai'
import { downloadText, langToExt } from '@/services/file'
import { loadAIConversation, persistAIConversation } from '@/services/storage'

export const useAiAssistantStore = defineStore('aiAssistant', () => {
  const snippetStore = useSnippetStore()
  // 对话从 sessionStorage 恢复（初始化读，与编辑器草稿同策略；临时状态，关标签页即清）
  const messages = ref<AssistantTurnMessage[]>(loadAIConversation())
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
  // 对话上限：16 轮（user 计数）。成本主体是候选片段不是历史，轮数翻倍成本只增约 40%；
  // 配合「换话题」按钮（不带历史物理换题），16 轮对连续筛选已很充裕
  const MAX_TURNS = 16
  // 单次请求超时：正常一轮 6-12s，但推理模型对否定/排除语义（"没有注释的"）推理可达 1000+ token、
  // 约 40-50 秒，30s 会误杀正常慢推理（实测超时后重试也必超时）；60s 兜底网络挂起与服务端异常
  const REQUEST_TIMEOUT = 60_000
  const controller = ref<AbortController | null>(null)
  // 后台补全四步总结的控制器：主回复先显示、总结稍后到；新一轮 backfill / reset 作废上一个未完成的
  let summaryController: AbortController | null = null

  function reset() {
    controller.value?.abort()
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

  // 用户主动停止搜索（AbortError 由 catch 分支转为提示）
  function stop() {
    controller.value?.abort()
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
      // AI 修改：assistantTurn 只判断"改哪个、改什么"，真正的改写走 modifyCode 流式（仍在 sending 内）
      if (reply.action === 'modify') {
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
  // 二次确认 = 页面展示 AI 提醒文案 + diff 卡，"替换原代码"再弹确认框才真正落库
  async function runModify(reply: AssistantReply) {
    const msg: AssistantTurnMessage = {
      role: 'assistant',
      content: reply.text,
      note: reply.note,
      searchIds: reply.ids,
      reasoning: reasoning.value,
      requirement: reply.requirement,
      modifyState: 'running'
    }
    messages.value.push(msg)
    backfillSummary(msg)

    const target = snippetStore.snippets.find(s => s.id === reply.ids[0])
    if (!target || !reply.requirement) {
      msg.modifyState = 'error'
      msg.content += '（找不到目标片段或需求为空，请重试）'
      return
    }
    try {
      const result = await modifyCode(target.code, reply.requirement, { signal: controller.value?.signal })
      if (result) {
        msg.modifiedCode = result
        msg.modifyState = 'done'
      } else {
        msg.modifyState = 'error'
        msg.content += '（AI 未返回修改结果，请换种说法重试）'
      }
    } catch (err) {
      msg.modifyState = 'error'
      msg.content += isAbortError(err) ? '（修改已停止）' : '（修改失败，请重试）'
    }
  }

  // AI 提议库结构操作（删除/重命名/收藏/导出/新建/清空/收藏夹管理/改描述语言）：只展示确认卡，绝不直接执行。
  // create 需先在本地调 generateCode 生成代码，生成完才转待确认；收藏夹类操作 ids 为空，targetTitle 取夹名
  async function runOperate(reply: AssistantReply) {
    const isFolderOp = reply.op === 'createFolder' || reply.op === 'renameFolder' || reply.op === 'deleteFolder' || reply.op === 'clearFolder'
    const target = reply.ids[0] ? snippetStore.snippets.find(s => s.id === reply.ids[0]) : undefined
    const msg: AssistantTurnMessage = {
      role: 'assistant',
      content: reply.text,
      note: reply.note,
      searchIds: reply.ids,
      reasoning: reasoning.value,
      operateOp: reply.op,
      operateValue: reply.value,
      operateTarget: reply.target,
      operateField: reply.field,
      operateState: reply.op === 'create' ? 'running' : 'pending',
      targetTitle: isFolderOp ? (reply.op === 'renameFolder' ? reply.target : reply.value) : (target?.title || '')
    }
    messages.value.push(msg)
    backfillSummary(msg)

    if (reply.op === 'create') {
      try {
        const code = await generateCode(reply.value || '', reply.language || 'text', {
          signal: controller.value?.signal
        })
        if (code) {
          msg.createdCode = code
          msg.createdLanguage = reply.language
          msg.operateState = 'pending'
        } else {
          msg.operateState = 'error'
          msg.content = '（AI 未生成代码，请重试）'
        }
      } catch (err) {
        msg.operateState = 'error'
        msg.content = isAbortError(err) ? '（生成已停止）' : '（生成失败，请重试）'
      }
    }
  }

  // 用户确认后执行库结构操作（删除/清空等不可逆项，页面确认卡另有二次确认）。
  // 批量：delete/favorite/unfavorite 遍历 searchIds；收藏夹类按夹名指代（ids 为空）
  function confirmOperate(msg: AssistantTurnMessage) {
    if (msg.operateState !== 'pending') return
    const folderOps: OperateOp[] = ['createFolder', 'renameFolder', 'deleteFolder', 'clearFolder']
    // create/clear/收藏夹类操作不需要片段编号，其他操作需要
    if (msg.operateOp !== 'create' && msg.operateOp !== 'clear' && !folderOps.includes(msg.operateOp!) && !msg.searchIds?.length) return
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
        case 'create': {
          if (!msg.createdCode) return
          snippetStore.addSnippet({
            id: Date.now().toString(),
            title: msg.operateValue || 'AI 新建片段',
            code: msg.createdCode,
            language: msg.createdLanguage || 'text',
            description: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            folderIds: []
          })
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

  // 保存 AI 修改为新片段：新建不影响原片段，无需二次确认
  function saveModifyAsNew(msg: AssistantTurnMessage) {
    if (!msg.modifiedCode || !msg.searchIds?.length || msg.modifyApplied) return
    const target = snippetStore.snippets.find(s => s.id === msg.searchIds![0])
    if (!target) return
    snippetStore.addSnippet({
      id: Date.now().toString(),
      title: target.title + ' (AI 优化)',
      code: msg.modifiedCode,
      language: target.language,
      description: target.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folderIds: []
    })
    msg.modifyApplied = true
  }

  // 用 AI 修改替换原代码：覆盖现有内容，调用前页面须弹二次确认框
  function replaceModify(msg: AssistantTurnMessage) {
    if (!msg.modifiedCode || !msg.searchIds?.length || msg.modifyApplied) return
    snippetStore.updateSnippet(msg.searchIds![0], { code: msg.modifiedCode })
    msg.modifyApplied = true
  }

  // 导出 AI 修改结果
  function exportModify(msg: AssistantTurnMessage) {
    if (!msg.modifiedCode) return
    const target = snippetStore.snippets.find(s => s.id === msg.searchIds?.[0])
    downloadText(msg.modifiedCode, target?.title || 'snippet', target ? langToExt(target.language) : 'txt')
  }

  // 预置对话前提（详情页进入）：把指定片段作为一条"已找到"的结果消息，召回机制会把
  // history 里的 searchIds 排最前，后续提问/修改天然围绕该片段。
  // 从详情页进入 = 以该片段为唯一前提的新会话：当前上下文（空内容 assistant 结果消息）
  // 与目标片段不一致（或尚未建立）时重置整个对话再播种；同一片段重复进入保持对话不动
  function seedContext(ids: string[], note: string) {
    const isSeed = (m: AssistantTurnMessage) => m.role === 'assistant' && !m.content && !m.divider && !!m.searchIds?.length
    const cur = messages.value.find(isSeed)
    if (cur && cur.searchIds?.some(id => ids.includes(id))) return
    reset()
    messages.value.push({ role: 'assistant', content: '', note, searchIds: ids })
  }

  return { messages, sending, retrying, reasoning, composing, phase, elapsed, error, lastUserText, MAX_TURNS, reset, stop, send, retry, switchTopic, runModify, saveModifyAsNew, replaceModify, exportModify, seedContext, runOperate, confirmOperate, cancelOperate }
})
