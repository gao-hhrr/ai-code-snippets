<!-- ════════════════════════════════════════════════════════
     SearchBar —— 搜索输入框：直接绑 store.searchQuery 实时过滤 + Esc/× 清空
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import { useEscape } from '@/composables/useClickOutside'
import AppIcon from '@/components/global/base/AppIcon.vue'

const snippetStore = useSnippetStore()

// 输入即过滤：直接绑定 store 的 searchQuery，
// 逐个输入/删除字符时列表实时更新，与 × 清空行为一致
function clearSearch() {
  snippetStore.searchQuery = ''
}

// Esc 清空搜索
useEscape(() => clearSearch())

onBeforeUnmount(() => {
  snippetStore.searchQuery = ''
})
</script>

<template>
  <div class="relative flex-1 min-w-0">
    <AppIcon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
    <input
      v-model="snippetStore.searchQuery"
      type="text"
      placeholder="搜索片段名"
      maxlength="50"
      class="w-full pl-9 pr-7 py-2 border border-zinc-300 rounded-lg text-sm bg-white shadow-sm transition-shadow"
    />
    <button
      v-if="snippetStore.searchQuery"
      class="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-500 hover:text-zinc-700 cursor-pointer"
      title="清空"
      @click="clearSearch"
    ><AppIcon name="x" :size="14" /></button>
  </div>
</template>
