// ════════════════════════════════════════════════════════
// composables/useDraft.ts —— 编辑器草稿：sessionStorage 防抖保存 + 「未保存离开」确认弹窗
// ════════════════════════════════════════════════════════
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
  let cleared = false// 是否已保存过
  let leavingDiscard = false// 用户是否选了「丢弃离开」，决定离开时草稿是保留还是删
  let saveTimer: ReturnType<typeof setTimeout> | null = null// 防抖定时器句柄

  // 语言不计入「未保存」判断：下拉选择是轻量调整，改了不弹确认（但草稿仍会保存语言，刷新可恢复）
  //有没有改动的判断
  const isDirty = computed(() =>
    title.value !== baseline.title ||
    code.value !== baseline.code ||
    description.value !== baseline.description
    
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
    confirmResolver?.(true)//  ?.是可选链，confirmResolver可能是null(从未弹窗过)。可选链保证"没弹过窗就不调用",避免报错
    confirmResolver = null
  }

  //点取消
  function handleConfirmCancel() {
    showConfirm.value = false
    confirmResolver?.(false)
    confirmResolver = null
  }

  async function confirmLeave(): Promise<boolean> {
    if (cleared) return true// 已保存过 → 直接放行
    if (!isDirty.value) return true// 没改过 → 直接放行
    return await confirmLeaveDialog()// 有改动 → 弹窗问用户
  }

  watch([title, code, language, description], scheduleDraftSave)

  onMounted(() => {
    // 清理旧版本遗留在 localStorage 里的草稿，不再使用
    localStorage.removeItem(DRAFT_KEY)
    loadDraft()
  })
  
  //守卫函数
  // 离开当前页（返回按钮/路由跳转）前，有未保存内容先弹确认
  onBeforeRouteLeave(async () => {
    if (!(await confirmLeave())) return false// 用户选「留下」→ 返回 false 阻止离开
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
    // 保存成功后调用，标记本次会话已提交，后续离开不再弹确认
    markCleared() {
      cleared = true
      sessionStorage.removeItem(DRAFT_KEY)
    }
  }
}
