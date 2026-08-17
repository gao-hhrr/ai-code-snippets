<script setup lang="ts">
import { onMounted, onBeforeUnmount, nextTick } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useSnippetStore } from '@/stores/snippetStore'
import ListToolbar from '@/components/snippet/ListToolbar.vue'
import EmptyState from '@/components/snippet/EmptyState.vue'
import SnippetCard from '@/components/snippet/SnippetCard.vue'
import BatchActionBar from '@/components/snippet/BatchActionBar.vue'

const snippetStore = useSnippetStore()

// 列表页滚动位置存 sessionStorage（与 AI 页/编辑器草稿同策略）：点卡片进详情、返回不丢位置，关标签页自动清。
// 滚动容器是 App.vue 的 <main>（列表页不在 KeepAlive，离开即销毁，恢复只在进入时做；
// 不用 onBeforeUnmount 读 scrollTop 是它这时节点可能已脱离文档布局，值不可靠，同 AI 页 KeepAlive 的坑）
const SCROLL_KEY = 'code-snippets:list-scroll'
const scrollEl = () => document.querySelector<HTMLElement>('main')
function saveScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(scrollEl()?.scrollTop ?? 0))
  } catch { /* 忽略存储失败 */ }
}
function restoreScroll() {
  let top = 0
  try { top = Number(sessionStorage.getItem(SCROLL_KEY) || 0) } catch { /* 忽略 */ }
  if (top > 0) {
    // nextTick + rAF 等布局稳定后再定位，避免内容未渲染完导致 scrollTo 失效
    nextTick(() => {
      requestAnimationFrame(() => {
        scrollEl()?.scrollTo({ top })
      })
    })
  }
}
onMounted(() => {
  restoreScroll()
  scrollEl()?.addEventListener('scroll', saveScroll)
})
onBeforeUnmount(() => {
  scrollEl()?.removeEventListener('scroll', saveScroll)
})

// 离开列表页时清空选择，避免下次进入还停在批量状态
onBeforeRouteLeave(() => {
  snippetStore.clearSelection()
  return true
})
</script>

<template>
  <!-- 列表页骨架：各区块实现在对应组件里，想改哪块开哪个文件 -->
  <div class="max-w-7xl mx-auto">
    <ListToolbar />

    <EmptyState v-if="snippetStore.loading || snippetStore.filteredSnippets.length === 0" />

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
</template>
