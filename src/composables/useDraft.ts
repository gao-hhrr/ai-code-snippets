import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { Ref } from 'vue'

const DRAFT_KEY = 'code-snippets:draft'

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
}) {
  const { id, title, code, language, description, baseline } = opts
  let cleared = false
  let leavingDiscard = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // 语言不计入「未保存」判断：下拉选择是轻量调整，改了不弹确认（但草稿仍会保存语言，刷新可恢复）
  const isDirty = computed(() =>
    title.value !== baseline.title ||
    code.value !== baseline.code ||
    description.value !== baseline.description
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
    confirmResolver?.(true)
    confirmResolver = null
  }

  function handleConfirmCancel() {
    showConfirm.value = false
    confirmResolver?.(false)
    confirmResolver = null
  }

  async function confirmLeave(): Promise<boolean> {
    if (cleared) return true
    if (!isDirty.value) return true
    return await confirmLeaveDialog()
  }

  watch([title, code, language, description], scheduleDraftSave)

  onMounted(() => {
    // 清理旧版本遗留在 localStorage 里的草稿，不再使用
    localStorage.removeItem(DRAFT_KEY)
    loadDraft()
  })

  // 离开当前页（返回按钮/路由跳转）前，有未保存内容先弹确认
  onBeforeRouteLeave(async () => {
    if (!(await confirmLeave())) return false
    sessionStorage.removeItem(DRAFT_KEY)
    return true
  })

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
    // 保存成功后调用，标记本次会话已提交，后续离开不再弹确认
    markCleared() {
      cleared = true
      sessionStorage.removeItem(DRAFT_KEY)
    }
  }
}
