// ════════════════════════════════════════════════════════
// composables/useGoBack.ts —— 返回按钮：优先回站内上一页（history.state.back），无站内历史则回主页
// ════════════════════════════════════════════════════════
import { useRouter } from 'vue-router'

// 返回按钮：优先返回来源页（AI 助手 → 详情 → 返回应回 AI 助手；详情 → 编辑 → 返回应回详情）。
// window.history.state.back 由 Vue Router 在站内跳转时写入：存在说明有站内上一页，router.back() 安全；
// 为空（直接打开/刷新深链，无站内历史）则兜底回主页，避免浏览器跳到站外
export function useGoBack() {
  const router = useRouter()
  function goBack() {
    if (window.history.state?.back) router.back()
    else router.push('/')
  }
  return { goBack }
}
