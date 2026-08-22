// ════════════════════════════════════════════════════════
// composables/useDraft.ts —— 编辑器草稿：sessionStorage 防抖保存 + 「未保存离开」确认弹窗
// ════════════════════════════════════════════════════════
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { Ref } from 'vue'


export const DRAFT_KEY = 'code-snippets:draft'

// 草稿只进 sessionStorage：页面刷新不丢内容，标签页关闭自动清除，
// 不会长期占用本地存储，也不会把上次未保存的内容带到下次新建。
// 同时负责「未保存离开确认」：进入页面的内容基线用来判断是否有改动
export function useDraft(opts: {
  id: string | null
  title: Ref<string>
  code: Ref<string>
  language: Ref<string>
  description: Ref<string>
  baseline: { title: string; code: string; language: string; description: string }
  // 确认离开后触发（删草稿前）：编辑页借此向 AI 页回传「未保存」结果
  onConfirmedLeave?: () => void
}) {
  const { id, title, code, language, description, baseline } = opts
  let cleared = false// 是否已保存过
  let leavingDiscard = false// 用户是否选了「丢弃离开」，决定离开时草稿是保留还是删
  let saveTimer: ReturnType<typeof setTimeout> | null = null// 防抖定时器句柄

  // 语言不计入「未保存」判断：下拉选择是轻量调整，改了不弹确认（但草稿仍会保存语言，刷新可恢复）
  // 已保存快照：保存成功后记下当时的 title/code/description，作为后续「是否又改了」的基准。
  // 不能用 baseline 当基准：baseline 是进页面时的内容，保存过一次后再编辑时它仍是旧值，
  // 加上旧逻辑「cleared 直接放行」，会导致保存后再改、离开时不再弹确认（bug）
  // snapshot 必须是 ref：isDirty 的 computed 只追踪响应式依赖，若 snapshot 是普通对象，
  // markCleared 改它不会让 isDirty 缓存失效 → 仍返回旧的 true → 保存后离开照样弹「未保存」确认（回归）
  const snapshot = ref({ title: baseline.title, code: baseline.code, description: baseline.description })

  // 有没有改动的判断（与快照比，而非与进页面时的 baseline 比）
  const isDirty = computed(() =>
    title.value !== snapshot.value.title ||
    code.value !== snapshot.value.code ||
    description.value !== snapshot.value.description
  )

  //进页面恢复草稿
  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d && d.id === id) {
        title.value = d.title || ''
        code.value = d.code || ''
        language.value = d.language || 'JavaScript'
        description.value = d.description || ''
      }
    } catch {
      // 忽略损坏的草稿
    }
  }

  //400ms防抖watch 四个字段,你停手 400ms 后才写一次sessionStorage。防抖避免每敲一个字符就写一次存储
  function scheduleDraftSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          id,
          title: title.value,
          code: code.value,
          language: language.value,
          description: description.value
        }))
      } catch {
        // 忽略存储失败
      }
    }, 400)
  }

  //是否显示弹窗
  const showConfirm = ref(false)
  //存储Promise的resolve回调，初始为null
  //ts类型约束,这个函数function(ok){}接收一个布尔值参数（true/false）,执行完不返回
  //正好与function resolve(布尔值) {}对应
  let confirmResolver: ((ok: boolean) => void) | null = null

  function confirmLeaveDialog(): Promise<boolean> {
    return new Promise(resolve => {
      confirmResolver = resolve// 把 resolve 存起来，等用户点按钮
      showConfirm.value = true
    })
  }

  //点离开
  function handleConfirmOk() {
    showConfirm.value = false
    leavingDiscard = true
    confirmResolver?.(true)//  ?是可选链，confirmResolver可能是null(从未弹窗过)。可选链保证"没弹过窗就不调用",避免报错
    confirmResolver = null
  }

  //点取消
  function handleConfirmCancel() {
    showConfirm.value = false
    confirmResolver?.(false)
    confirmResolver = null
  }

  async function confirmLeave(): Promise<boolean> {
    if (!isDirty.value) return true// 没改过（含刚保存完，快照已更新）→ 直接放行
    return await confirmLeaveDialog()// 有改动 → 弹窗问用户
  }

  watch([title, code, language, description], scheduleDraftSave)

  onMounted(() => {
    // 清理旧版本遗留在 localStorage 里的草稿，不再使用
    localStorage.removeItem(DRAFT_KEY)
    loadDraft()
  })
  
  //守卫函数
  //Promise + await 的核心价值：阻塞代码执行，异步同步化
  //让 JS 引擎停在那，等着人手动交互完成再往下走，这是弹窗二次确认最经典的封装方案。
  // 离开当前页（返回按钮/路由跳转）前，有未保存内容先弹确认
  onBeforeRouteLeave(async () => {
    if (!(await confirmLeave())) return false// 用户选「留下」→ 返回 false 阻止离开
    opts.onConfirmedLeave?.()// 确认离开后才通知调用方（用户点「取消」留下时不触发）
    sessionStorage.removeItem(DRAFT_KEY)
    return true
  })

  //兜底
  onBeforeUnmount(() => {
    if (saveTimer) clearTimeout(saveTimer)
    if (cleared) return
    if (leavingDiscard) {
      sessionStorage.removeItem(DRAFT_KEY)
      return
    }
    scheduleDraftSave() // 刷新同标签页时，尽量保住最后一次输入
  })

  return {
    isDirty,
    showConfirm,
    handleConfirmOk,
    handleConfirmCancel,
    // 保存成功后调用：把已保存内容更新为「快照基准」并清草稿，
    // 之后没再改就直接放行，改了仍会正常弹确认
    markCleared() {
      snapshot.value = { title: title.value, code: code.value, description: description.value }
      cleared = true
      sessionStorage.removeItem(DRAFT_KEY)
    }
  }
}
