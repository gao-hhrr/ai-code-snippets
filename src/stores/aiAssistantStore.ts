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
// 操作执行：把确认的AI操作消息翻译成 snippetStore 的调用
// 每个 op 对应一个 handler；snippetStore 由参数传入，模块本身不依赖store闭包，便于单测
// 约定：成功返回 void / true；失败时：设置 msg.operateState='error' + 错误文案 return false
// confirmOperate 收到false就标记为执行失败，不会被后面统一状态赋值覆盖
// ════════════════════════════════════════════════════════

// OpHandler：操作处理器【类型契约】，规定所有操作处理函数必须遵守的格式
// msg: AI会话消息，携带操作相关全部数据(operateOp/searchIds/operateValue等)
// store: pinia片段库store实例，由外部传入，方便单元测试，不模块内直接import
// 返回值: boolean | void 
//   - void / true：代表操作成功
//   - return false：代表操作失败，外层不会标记operateState为executed
type OpHandler = (msg: AssistantTurnMessage, store: ReturnType<typeof useSnippetStore>) => boolean | void

// OPERATE_EXEC：操作分发表
// Partial<Record<OperateOp, OpHandler>> TS类型拆解：
//  1.Record<OperateOp, OpHandler>：对象key只能是OperateOp枚举值，每个value必须符合OpHandler函数契约
//  2.Partial<>：把全部key变为可选，允许部分操作(例如create)不写handler，不走此处执行，改为跳转页面
// 对象内部每一个函数，都是 OpHandler 类型的具体业务实现，TS编译时校验参数、返回值是否符合契约
const OPERATE_EXEC: Partial<Record<OperateOp, OpHandler>> = {
  // 删除片段：searchIds可能为空，空数组的forEach不会执行，安全
  delete(msg, store) {
    (msg.searchIds ?? []).forEach(id => store.deleteSnippet(id))
  },

  // 重命名片段：只取第一个片段id；operateValue是AI给出的新标题
  rename(msg, store) {
    const id = msg.searchIds?.[0]
    if (id) store.updateSnippet(id, { title: msg.operateValue })
  },

  // 导出片段：取第一条片段，调用下载工具函数导出代码文件
  export(msg, store) {
    const s = msg.searchIds?.length ? store.snippets.find(x => x.id === msg.searchIds![0]) : undefined
    if (s) downloadText(s.code, s.title, langToExt(s.language))
  },

  // 加入收藏夹：operateValue = 收藏夹名称；找不到收藏夹标记错误返回false
  favorite(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    // 把searchIds全部片段移入该收藏夹
    (msg.searchIds ?? []).forEach(id => store.favoriteTo(id, f.id))
  },

  // 移出收藏夹
  unfavorite(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    (msg.searchIds ?? []).forEach(id => store.unfavoriteFrom(id, f.id))
  },

  // 清空全部片段库
  clear(_, store) {
    store.clearAll()
  },

  // 新建收藏夹：operateValue为收藏夹名字；addFolder返回id，为空代表失败（重名/空名称）
  createFolder(msg, store) {
    const id = store.addFolder(msg.operateValue || '')
    if (!id) {
      msg.operateState = 'error'
      msg.content = '（收藏夹重名或名称为空）'
      return false
    }
  },

  // 修改收藏夹名称：operateTarget=旧名称，operateValue=新名称
  renameFolder(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateTarget)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateTarget}」的收藏夹）`
      return false
    }
    store.renameFolder(f.id, msg.operateValue || '')
  },

  // 删除收藏夹
  deleteFolder(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    store.deleteFolder(f.id)
  },

  // 清空某个收藏夹内部片段，不删除收藏夹本身
  clearFolder(msg, store) {
    const f = store.folders.find(x => x.name === msg.operateValue)
    if (!f) {
      msg.operateState = 'error'
      msg.content = `（找不到名为「${msg.operateValue}」的收藏夹）`
      return false
    }
    store.clearFolder(f.id)
  },

  // meta：修改片段元信息，language / description
  meta(msg, store) {
    const id = msg.searchIds?.[0]
    if (!id) return
    // 根据operateField判断更新哪个字段
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
    // 去除输入首尾空格
    const q = text.trim()
    // 空输入 或者 当前正在请求，直接返回，防止重复提交
    if (!q || sending.value) return

    // 对话轮数只统计用户消息，divider分割线、assistant回复不计入上限
    if (messages.value.filter(m => m.role === 'user').length >= MAX_TURNS) {
      error.value = { text: '对话已达上限，点击「重新开始」开启新对话', code: 'ERR_LIMIT' }
      return
    }

    // 把用户提问推入消息数组，UI立刻展示用户消息
    messages.value.push({ role: 'user', content: q })
    // 标记：正在发起网络请求
    sending.value = true
    // 清空之前的错误提示
    error.value = null
    // 缓存本次用户输入，给retry重试功能使用
    lastUserText.value = q
    // 重置请求耗时秒数
    elapsed.value = 0
    // 清空模型思考过程缓存
    reasoning.value = ''
    // 重置标记：模型还没输出正文
    composing.value = false

    // 计时器：每秒elapsed自增，用于页面展示"AI思考很久"提示文案
    const tick = setInterval(() => elapsed.value++, 1000)

    // 创建中断控制器，stop()按钮可以用来终止本次请求
    const ac = new AbortController()
    controller.value = ac

    // 标记：区分是【用户手动停止】还是【超时自动终止】
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    // 封装超时函数：遇到503自动重试时，需要重新倒计时，不能累计超时时间
    function armTimeout() {
      clearTimeout(timeout) // 清除旧的超时定时器
      timeout = setTimeout(() => {
        timedOut = true // 标记为超时触发
        ac.abort() // 中断网络请求
      }, REQUEST_TIMEOUT)
    }
    armTimeout() // 启动超时计时

    try {
      // freshSearch为true（换话题），则传给模型的历史为空；否则取当前用户消息之前的全部历史
      const history = freshSearch.value ? [] : messages.value.slice(0, -1)
      // freshSearch只生效一次，用完立刻复位
      freshSearch.value = false

      // 调用底层核心函数，发起SSE流式AI请求
      const reply = await assistantTurn(history, q, snippetStore.snippets, snippetStore.folders, {
        signal: ac.signal, // 传入中断信号
        onRetry: () => {
          // 503服务器过载触发自动重试
          retrying.value = true
          armTimeout() // 重试时重置超时倒计时
        },
        onReasoning: (delta) => {
          // 流式收到模型思考片段，追加保存
          reasoning.value += delta
        },
        onChunk: () => {
          // 收到模型正式回答正文，切换阶段状态为构思回应
          composing.value = true
        }
      })

      // AI返回操作指令（修改/删除/收藏片段），渲染确认卡片，不直接执行操作
      if (reply.action === 'operate') {
        await runOperate(reply)
        return
      }

      // 普通问答：组装assistant消息，存入对话列表
      const msg: AssistantTurnMessage = { role: 'assistant', content: reply.text, searchIds: reply.ids, note: reply.note, reasoning: reasoning.value }
      messages.value.push(msg)
      // 后台异步生成思考摘要，不阻塞页面主流程
      backfillSummary(msg)

    } catch (err) {
      // 请求被中止：区分是超时，还是用户手动点停止
      if (isAbortError(err)) {
        error.value = timedOut
          ? { text: '搜索超时（60 秒）：AI 推理较慢或网络不稳，已自动停止，请点重试', code: 'ERR_TIMEOUT' }
          : { text: '已停止搜索', code: 'ERR_ABORTED' }
      } else if (err instanceof AIError) {
        // 业务自定义AI错误，携带错误码、状态码、详情
        error.value = { text: err.message, code: err.code, status: err.status, detail: err.detail }
      } else {
        // 未知错误兜底提示
        error.value = { text: 'AI 助手出错了，请重试', code: 'ERR_FALLBACK' }
      }
    } finally {
      // 无论成功、失败、异常，必定执行资源清理，防止内存泄漏
      clearInterval(tick)        // 清除耗时计时器
      clearTimeout(timeout)      // 清除超时定时器
      retrying.value = false     // 关闭重试UI标记
      composing.value = false    // 关闭正文输出标记
      elapsed.value = 0          // 重置耗时
      // 防御判断：防止reset()已经修改controller.value，不要覆盖别人的赋值
      if (controller.value === ac) controller.value = null
      sending.value = false      // 请求结束，关闭loading状态
    }
  }

  // 重试上一条消息：先移除已展示的 user 消息再重发，避免重复
  function retry() {
    if (sending.value || !lastUserText.value) return
    const last = messages.value[messages.value.length - 1]
    // 判断：最后一条刚好就是上次发送的用户消息（请求失败/超时中止场景，末尾停留在user）
    // 满足条件就把这条user消息删掉，后面send会重新push这条消息，防止重复
    if (last?.role === 'user' && last.content === lastUserText.value) {
      messages.value.pop()
    }
    send(lastUserText.value)
  }

  // ════════════════════════════════════════════════════════
  // 操作流程：AI 提议库结构操作（删除/重命名/收藏/导出/新建/清空/收藏夹/改描述语言/修改代码）
  // ════════════════════════════════════════════════════════
  // AI 提议库结构操作：只展示确认卡，绝不直接执行。create 需先在本地调 generateCode 生成代码，
  // 生成完才转待确认；收藏夹类操作 ids 为空，targetTitle 取夹名
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
    const msg = buildOperateMsg(step, note, reasoningText)
    messages.value.push(msg)
    // 复合操作后续步骤不带思考，也就不需要后台补四步总结
    if (reasoningText) backfillSummary(msg)
    if (step.op === 'modify') return runModifyStep(step, msg)
    if (step.op === 'create') return runCreateStep(step, msg)
    // 可逆操作：消息建好后立即落库（confirmOperate 内 switch → executed），卡片直接落到结果态
    if (REVERSIBLE_OPS.includes(step.op)) confirmOperate(msg)
  }

  // 构造操作消息：生成式分支（create/modify）必须 reactive() 包裹。生成中 push 后还要改
  // operateState/createdCode/createdProgress/modifyState 等字段，改原始对象不会触发 deep watch 落盘
  // → 刷新时卡停在 running 被恢复成 error（操作卡消失）
  function buildOperateMsg(step: OperateStep, note: string, reasoningText: string) {
    const isFolderOp = OP_FOLDER.includes(step.op)
    const target = step.ids?.[0] ? snippetStore.snippets.find(s => s.id === step.ids![0]) : undefined
    // reactive 是 Vue3 的响应式 API，接收一个普通对象，返回该对象的响应式代理副本。
    // 只对对象、数组有效；不能处理基础类型（string/number/boolean），基础类型用 `ref`
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

  // 单修改（改代码）：生成式流程，ModifyCard 渲染。assistantTurn 只判定"改哪个+怎么改"（ids+value），
  // 真正改写走 modifyCode 流式。独立控制器 + 独立超时：改代码是重任务，不与搜索的 60s 共用
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
      // 流式改写：onChunk 实时累加已生成字符数（修改卡显示进度），服务端边生成边返回，不再干等整段响应
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

  // 新建（create 生成代码）：独立控制器 + 独立超时（对齐 modify 分支），生成是重任务
  // （推理 + 完整代码），不与搜索的 60s 共用——assistantTurn 已耗时间会压缩它；流式生成边出边报进度
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

  // 用户确认后执行库结构操作（删除/清空等不可逆项，页面确认卡另有二次确认）。
  // 批量：delete/favorite/unfavorite 遍历 searchIds；收藏夹类按夹名指代（ids 为空）。
  // create 已改由 confirmCreateToEditor 处理（转编辑页看完整代码），不再在此直接入库。
  // 执行翻译收敛在模块级 OPERATE_EXEC 映射表，这里只做状态守卫 + 统一落状态
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

  // 用户取消库结构操作
  function cancelOperate(msg: AssistantTurnMessage) {
    if (msg.operateState !== 'pending') return
    msg.operateState = 'cancelled'
  }

  // ════════════════════════════════════════════════════════
  // 修改流程：AI 修改代码的另存 / 替换 / 撤销 / 导出 + 编辑页回传
  // ════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════
  // 对话辅助：后台补四步总结 / 预置对话前提
  // ════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════
  // 导出
  // ════════════════════════════════════════════════════════
  return { messages, sending, retrying, reasoning, composing, phase, elapsed, error, lastUserText, deepThink, MAX_TURNS, reset, stop, send, retry, switchTopic, saveModifyToEditor, resolveModifyFromEditor, replaceModify, undoReplace, exportModify, seedContext, runOperate, confirmOperate, confirmCreateToEditor, resolveCreateFromEditor, cancelOperate }
})
