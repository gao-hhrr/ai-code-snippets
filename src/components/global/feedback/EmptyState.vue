<!-- ════════════════════════════════════════════════════════
     EmptyState —— 列表空态：无片段 / 筛选无结果（含去新建引导）
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { useSnippetStore } from '@/stores/snippetStore'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/global/base/AppIcon.vue'

const snippetStore = useSnippetStore()
const router = useRouter()
</script>

<template>
  <!-- 空状态：按情况给不同的引导出口 -->
  <div v-if="snippetStore.filteredSnippets.length === 0" class="text-center py-16">
    <div
      class="mx-auto mb-4 w-14 h-14 flex items-center justify-center rounded-2xl bg-github-blue-light text-github-blue"
    >
      <AppIcon
        :name="snippetStore.searchQuery.trim() ? 'search' : (snippetStore.filterType === 'favorites' ? 'star' : 'doc')"
        :size="24"
      />
    </div>

    <!-- 搜索无结果：给清空出口 -->
    <template v-if="snippetStore.searchQuery.trim()">
      <p class="text-sm text-zinc-600 mb-4">没有找到匹配「{{ snippetStore.searchQuery }}」的片段</p>
      <button
        class="inline-flex items-center gap-1 px-4 py-2 text-sm text-zinc-800 bg-zinc-200 hover:bg-zinc-300 rounded-lg transition-colors cursor-pointer"
        @click="snippetStore.searchQuery = ''"
      ><AppIcon name="x" :size="14" /> 清空搜索</button>
    </template>

    <!-- 完全没有片段：引导新建 -->
    <template v-else-if="snippetStore.snippets.length === 0">
      <p class="text-sm text-zinc-600 mb-4">还没有任何片段，先新建一个吧</p>
      <button
        class="inline-flex items-center gap-1 px-4 py-2 text-sm text-white bg-github-blue hover:bg-github-blue-dark rounded-lg transition-colors cursor-pointer"
        @click="router.push('/snippet/new')"
      ><AppIcon name="plus" :size="14" /> 新建片段</button>
    </template>

    <!-- 收藏夹为空：去全部视图给片段加星归入本夹，而非新建（新片段不自动进夹） -->
    <template v-else-if="snippetStore.filterType === 'favorites'">
      <p class="text-sm text-zinc-600 mb-4">这个收藏夹还没有片段，去全部片段里点亮星标即可加入本夹</p>
      <button
        class="inline-flex items-center gap-1 px-4 py-2 text-sm text-white bg-github-blue hover:bg-github-blue-dark rounded-lg transition-colors cursor-pointer"
        @click="snippetStore.setFilter('all')"
      ><AppIcon name="star" :size="14" /> 添加片段</button>
    </template>

    <!-- 语言 / 最近一周无匹配 -->
    <template v-else>
      <p class="text-sm text-zinc-600 mb-4">暂无匹配的片段</p>
      <button
        class="inline-flex items-center gap-1 px-4 py-2 text-sm text-zinc-800 bg-zinc-200 hover:bg-zinc-300 rounded-lg transition-colors cursor-pointer"
        @click="snippetStore.setFilter('all')"
      ><AppIcon name="doc" :size="14" /> 查看全部片段</button>
    </template>
  </div>
</template>
