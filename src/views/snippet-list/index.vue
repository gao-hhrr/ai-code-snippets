<!-- ════════════════════════════════════════════════════════
     views/snippet-list/index.vue —— 片段列表页（网站主界面）：顶栏 + 站点导航 + 片段列表 + 批量操作
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useSnippetStore } from '@/stores/snippetStore'
import BrandMark from '@/components/global/layout/BrandMark.vue'
import SiteNav from '@/components/business/snippet/SiteNav.vue'
import ListToolbar from '@/components/business/snippet/ListToolbar.vue'
import EmptyState from '@/components/global/feedback/EmptyState.vue'
import SnippetCard from '@/components/business/snippet/SnippetCard.vue'
import BatchActionBar from '@/components/business/snippet/BatchActionBar.vue'
import AppIcon from '@/components/global/base/AppIcon.vue'

const snippetStore = useSnippetStore()

// 列表页滚动位置存 sessionStorage（与 AI 页/编辑器草稿同策略）：点卡片进详情、返回不丢位置，关标签页自动清。
// 滚动容器是首页自己的 <main>（首页不在 KeepAlive，离开即销毁，恢复只在进入时做；
// 不用 onBeforeUnmount 读 scrollTop 是它这时节点可能已脱离文档布局，值不可靠，同 AI 页 KeepAlive 的坑）
const SCROLL_KEY = 'code-snippets:list-scroll'
const mainRef = ref<HTMLElement>()

function saveScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(mainRef.value?.scrollTop ?? 0))
  } catch { /* 忽略存储失败 */ }
}

function restoreScroll() {
  let top = 0
  try { top = Number(sessionStorage.getItem(SCROLL_KEY) || 0) } catch { /* 忽略 */ }
  if (top > 0) {
    // nextTick + rAF 等布局稳定后再定位，避免内容未渲染完导致 scrollTo 失效
    // 双重等待：Vue DOM更新完成 + 浏览器下一帧渲染完成
    nextTick(() => {
      requestAnimationFrame(() => {
        mainRef.value?.scrollTo({ top })
      })
    })
  }
}

onMounted(() => {
  restoreScroll()
  mainRef.value?.addEventListener('scroll', saveScroll)
})
onBeforeUnmount(() => {
  mainRef.value?.removeEventListener('scroll', saveScroll)
})

// 离开列表页时清空选择，避免下次进入还停在批量状态
onBeforeRouteLeave(() => {
  snippetStore.clearSelection()
  return true
})

// 返回顶部：固定显示，点击平滑回顶
function scrollToTop() {
  const el = mainRef.value
  if (!el || el.scrollTop <= 0) return
  // 尊重系统「减少动态效果」偏好，直接跳到顶部
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = 0
    return
  }
  const target = el
  const start = target.scrollTop
  const duration = 600
  const startTime = performance.now()

  function step(now: number) {
    const progress = Math.min((now - startTime) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic：先快后慢
    target.scrollTop = start * (1 - eased)
    if (progress < 1) requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
}
</script>

<template>
  <!-- 片段列表页 = 网站主界面：顶栏 + 站点导航 + 片段列表。导航是站点级的，只是展示在这里 -->
  <div class="h-screen flex flex-col bg-zinc-100">
    <!-- 顶栏：仅此页展示，直接内联不进组件（品牌 + 标语） -->
    <header class="h-14 shrink-0 flex items-center justify-between px-4 sm:px-6 bg-white border-b border-zinc-200">
      <BrandMark />
      <span class="text-sm text-zinc-600 hidden lg:block">轻量化 AI 代码片段管理平台</span>
    </header>

    <div class="flex flex-1 overflow-hidden">
      <SiteNav />

      <main ref="mainRef" class="flex-1 bg-zinc-100 overflow-y-auto p-5">
        <!-- 列表页骨架：各区块实现在对应组件里，想改哪块开哪个文件 -->
        <div class="max-w-7xl mx-auto">
          <ListToolbar />

          <EmptyState v-if="snippetStore.filteredSnippets.length === 0" />

          <!-- 批量模式下底部留白，让最后一行卡片能滚到悬浮操作条上方 -->
          <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-4" :class="snippetStore.batchMode ? 'pb-16' : ''">
            <SnippetCard
              v-for="snippet in snippetStore.filteredSnippets"
              :key="snippet.id"
              :snippet="snippet"
            />
          </div>

          <BatchActionBar />
        </div>
      </main>
    </div>

    <Transition name="fade">
      <button
        v-if="!snippetStore.batchMode"
        class="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full bg-white ring-1 ring-zinc-200 shadow-lg flex items-center justify-center text-zinc-600 hover:text-zinc-900 hover:ring-zinc-300 transition-colors cursor-pointer"
        title="返回顶部"
        @click="scrollToTop"
      ><AppIcon name="arrow-up" :size="18" /></button>
    </Transition>
  </div>
</template>
