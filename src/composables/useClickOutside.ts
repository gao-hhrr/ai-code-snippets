// ════════════════════════════════════════════════════════
// composables/useClickOutside.ts —— 弹层关闭两件套：点击外部关闭 + Esc 关闭（替代各组件手写监听）
// ════════════════════════════════════════════════════════
import { onMounted, onBeforeUnmount, type Ref } from 'vue'

// 关闭弹层/浮层的两类触发：点击外部（useClickOutside）+ Esc（useEscape）。
// 替代各组件重复手写的 document 级监听，共置一文件（同一关注点）。
export interface UseClickOutsideOptions {
  // 弹层根元素 ref：点击落在其中不触发（contains 判断）
  root?: Ref<HTMLElement | undefined>
  // 或用 CSS 选择器判断外部（Teleport 到 body 的弹层拿不到父作用域 ref 时用 closest）
  selector?: string
  // 'click' | 'mousedown'：拖选文字在弹层内按下、外松开时 click 落在共同祖先上会误关，用 mousedown
  event?: 'click' | 'mousedown'
  // capture 阶段阻止事件继续传播：防止关闭瞬间这次点击穿透到下方按钮（如卡片跳转）
  stopPropagation?: boolean
  // 弹层未打开时不响应（避免常驻监听误触发）
  enabled?: () => boolean
}

export function useClickOutside(handler: () => void, opts: UseClickOutsideOptions = {}) {
  const {
    root,
    selector,
    event = 'click',
    stopPropagation = false,
    enabled = () => true
  } = opts

  const onDocEvent = (e: MouseEvent) => {
    if (!enabled()) return
    const target = e.target as HTMLElement
    if (root?.value && root.value.contains(target)) return
    if (selector && target.closest(selector)) return
    if (stopPropagation) e.stopImmediatePropagation()
    handler()
  }

  onMounted(() => document.addEventListener(event, onDocEvent, true))
  onBeforeUnmount(() => document.removeEventListener(event, onDocEvent, true))
}

// Esc 关闭弹层/取消动作；enabled 用于按状态（如弹层是否打开）决定是否响应
export function useEscape(handler: () => void, enabled: () => boolean = () => true) {
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && enabled()) handler()
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
}
