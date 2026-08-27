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
  let cleared = false
  // 用户选「丢弃离开」才删草稿；否则刷新同标签页要保住最后一次输入
  let leavingDiscard = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // 语言不计入「未保存」判断：下拉选择是轻量调整，改了不弹确认（草稿仍会保存语言，刷新可恢复）
  // 已保存快照 = 判断「是否又改了」的基准。不用 baseline（进页面时的内容）：
  // 保存过一次后再编辑时 baseline 仍是旧值，旧逻辑会让「保存后再改」不再弹确认（bug）
  // snapshot 必须 ref：isDirty 的 computed 只追踪响应式依赖，普通对象改了不会让缓存失效（回归）
  const snapshot = ref({ title: baseline.title, code: baseline.code, description: baseline.description })

  // 有没有改动的判断（与快照比，而非与进页面时的 baseline 比）
  const isDirty = computed(() =>
    title.value !== snapshot.value.title ||
    code.value !== snapshot.value.code ||
    description.value !== snapshot.value.description
  )

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

  // 400ms 防抖：停止输入 400ms 后才写一次存储，避免每敲一个字符就写 sessionStorage
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

  const showConfirm = ref(false)
  // resolve 的句柄：用户点按钮时以 true/false 结束确认 Promise
  let confirmResolver: ((ok: boolean) => void) | null = null

  function confirmLeaveDialog(): Promise<boolean> {
    return new Promise(resolve => {
      confirmResolver = resolve
      showConfirm.value = true
    })
  }

  function handleConfirmOk() {
    showConfirm.value = false
    leavingDiscard = true
    // 可选链：确认弹窗从未弹出过时 resolver 为 null，跳过不报错
    confirmResolver?.(true)
    confirmResolver = null
  }

  function handleConfirmCancel() {
    showConfirm.value = false
    confirmResolver?.(false)
    confirmResolver = null
  }

  async function confirmLeave(): Promise<boolean> {
    // 没改过（含刚保存完，快照已更新）→ 直接放行
    if (!isDirty.value) return true
    return await confirmLeaveDialog()
  }

  watch([title, code, language, description], scheduleDraftSave)

  onMounted(() => {
    // 清理旧版本遗留在 localStorage 里的草稿，不再使用
    localStorage.removeItem(DRAFT_KEY)
    loadDraft()
  })
  
  // 离开当前页（返回按钮/路由跳转）前，有未保存内容先弹确认。
  // Promise + await 让弹窗阻塞路由跳转：用户选「留下」→ 返回 false 阻止离开
  onBeforeRouteLeave(async () => {
    if (!(await confirmLeave())) return false
    // 确认离开后才回传「未保存」（点「取消」留下时不触发）
    opts.onConfirmedLeave?.()
    sessionStorage.removeItem(DRAFT_KEY)
    return true
  })

  // 兜底：未保存内容不因组件卸载丢失；刷新同标签页尽量保住最后一次输入
  onBeforeUnmount(() => {
    if (saveTimer) clearTimeout(saveTimer)
    if (cleared) return
    if (leavingDiscard) {
      sessionStorage.removeItem(DRAFT_KEY)
      return
    }
    scheduleDraftSave()
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
