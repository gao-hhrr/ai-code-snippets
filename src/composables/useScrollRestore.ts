// ════════════════════════════════════════════════════════
// composables/useScrollRestore.ts —— 滚动位置保存/恢复：sessionStorage 草稿策略 + scroll 事件保存点 + rAF 节流写入 + nextTick/rAF 双重等待
// ════════════════════════════════════════════════════════
import { nextTick } from 'vue'

// 列表页与 AI 助手页共用同一套滚动恢复逻辑，收敛成一份。
// 保存点必须挂在滚动容器的 scroll 事件上，而不是在 onBeforeUnmount/onDeactivated 里读 scrollTop——
// 那两种时机节点可能已脱离文档布局（KeepAlive 失活时节点先被移进隐藏容器，onDeactivated 读 scrollTop 恒为 0），
// 会把真实位置覆盖掉；scroll 事件触发时元素仍在文档内，值可靠。
// 存 sessionStorage（与编辑器草稿同策略）：返回/刷新不丢，关标签页自动清。
export function useScrollRestore(key: string, getEl: () => HTMLElement | null | undefined) {
  // rAF 节流：scroll 事件高速滚动时一帧可能触发多次，用 rAF 合并成每帧最多写一次 sessionStorage，
  // 避免高频同步 setItem 影响滚动流畅度（写的是数字小串，合帧后开销可忽略）
  let rafId: number | null = null

  function saveScroll() {
    if (rafId !== null) return // 本帧已排过写入，后续 scroll 事件合并到同一次
    rafId = requestAnimationFrame(() => {
      rafId = null
      try {
        sessionStorage.setItem(key, String(getEl()?.scrollTop ?? 0))
      } catch { /* 忽略存储失败 */ }
    })
  }

  // 恢复只在进入页面时做；nextTick + rAF 双重等待布局稳定再定位，
  // 避免内容未渲染完导致 scrollTo 失效（Vue DOM 更新完 + 浏览器下一帧渲染完）
  function restoreScroll() {
    let top = 0
    try { top = Number(sessionStorage.getItem(key) || 0) } catch { /* 忽略 */ }
    if (top > 0) {
      nextTick(() => {
        requestAnimationFrame(() => {
          getEl()?.scrollTo({ top })
        })
      })
    }
  }

  // 进入页面：恢复位置 + 挂上保存监听（onMounted 用）。KeepAlive 缓存页在 onActivated 只调 restoreScroll——
  // 监听器已在首次 onMounted 挂过且实例未销毁，无需重复绑定
  function bindScroll() {
    restoreScroll()
    getEl()?.addEventListener('scroll', saveScroll)
  }

  function unbindScroll() {
    getEl()?.removeEventListener('scroll', saveScroll)
    // 必须取消已排队的 rAF：组件卸载后模板 ref 被清成 null，若让其执行会读到 0 把好值覆盖掉
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  return { restoreScroll, bindScroll, unbindScroll }
}
