<!-- ════════════════════════════════════════════════════════
     ListToolbar —— 列表工具栏：当前筛选标题 + 片段计数 + 排序 + 搜索
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { computed } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import SortMenu from '@/components/global/search/SortMenu.vue'
import SearchBar from '@/components/global/search/SearchBar.vue'

const snippetStore = useSnippetStore()

// 标题随当前筛选变化（收藏夹显示夹名）
const heading = computed(() => {
  switch (snippetStore.filterType) {
    case 'favorites': {
      const f = snippetStore.folders.find(x => x.id === snippetStore.filterValue)
      return f ? f.name : '收藏夹'
    }
    case 'recent': return '最近一周'
    case 'language': return snippetStore.filterValue
    default: return '所有片段'
  }
})
</script>

<template>
  <!-- 工具栏：标题 + 计数 + 排序 + 搜索 -->
  <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div class="flex items-end gap-3">
      <h2 class="text-2xl font-bold text-zinc-900 tracking-tight">{{ heading }}</h2>
      <span class="text-sm text-zinc-500 tabular-nums">{{ snippetStore.filteredSnippets.length }} 个片段</span>
    </div>
    <div class="flex items-center gap-2 w-full sm:w-[32rem]">
      <SortMenu />
      <div class="flex-1"><SearchBar /></div>
    </div>
  </div>
</template>
