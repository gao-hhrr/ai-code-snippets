<!-- ════════════════════════════════════════════════════════
     SortMenu —— 排序下拉：最近更新 / 最近创建 / 首字母（写回 store.sortBy/sortDir）
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import type { SortBy, SortDir } from '@/stores/snippetStore'
import { useClickOutside, useEscape } from '@/composables/useClickOutside'

import AppIcon from '@/components/global/base/AppIcon.vue'

const snippetStore = useSnippetStore()

//选项选择
const sortOptions = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '最近创建' },
  { value: 'title', label: '首字母' }
] satisfies { value: SortBy; label: string }[]

const currentSortLabel = computed(
  () => sortOptions.find(o => o.value === snippetStore.sortBy)?.label ?? '排序'// ??空值合并运算符，前面都为空时默认兜底文字
)

// 方向用文字表达（时间「新→旧」、首字母「A→Z」），比箭头符号零歧义
const sortDirLabel = computed(() =>
  snippetStore.sortBy === 'title'
    ? snippetStore.sortDir === 'asc' ? 'A→Z' : 'Z→A'
    : snippetStore.sortDir === 'desc' ? '新→旧' : '旧→新'
)

const showSortMenu = ref(false)

// 自然方向：时间类降序（新的在前），首字母升序（A-Z）；切维度时回到自然方向
function naturalDir(by: SortBy): SortDir {
  return by === 'title' ? 'asc' : 'desc'
}

// 点按钮主体直接翻转升/降序，不用开菜单
function toggleDir() {
  snippetStore.sortDir = snippetStore.sortDir === 'asc' ? 'desc' : 'asc'
}

function setSort(value: SortBy) {
  snippetStore.sortBy = value
  snippetStore.sortDir = naturalDir(value)
  showSortMenu.value = false
}

// 点击菜单外关闭（不拦截点击本身，只是收起菜单；排序菜单不涉及"防穿透"需求）
useClickOutside(() => { showSortMenu.value = false }, { selector: '.sort-menu', enabled: () => showSortMenu.value })
useEscape(() => { showSortMenu.value = false }, () => showSortMenu.value)
</script>

<template>
  <div class="relative shrink-0 sort-menu">
    <!-- 主体：当前排序维度 + 方向文字，点击直接翻转；右侧下拉箭头才选维度 -->
    <div class="flex items-stretch bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
      <button
        class="flex items-center gap-1.5 pl-3 pr-2 py-2 text-sm text-zinc-700 hover:bg-zinc-200 transition-colors cursor-pointer"
        title="点击切换排序方向"
        @click="toggleDir"
      >
        <span>{{ currentSortLabel }}</span>
        <span class="text-xs text-zinc-500 tabular-nums">{{ sortDirLabel }}</span>
      </button>
      <button
        class="px-1.5 text-zinc-500 hover:bg-zinc-200 transition-colors cursor-pointer border-l border-zinc-200"
        title="选择排序方式"
        @click="showSortMenu = !showSortMenu"
      >
        <AppIcon
          name="chevron"
          :size="14"
          class="transition-transform duration-200"
          :class="showSortMenu ? 'rotate-180' : ''"
        />
      </button>
    </div>
    <!-- 加动画用的过渡组件 -->
    <Transition name="pop">
      <div
        v-if="showSortMenu"
        class="absolute right-0 top-full mt-1 z-50 w-28 bg-white border border-zinc-200 rounded-lg shadow-lg p-1"
      >
        <button
          v-for="opt in sortOptions"
          :key="opt.value"
          class="w-full px-2 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
          :class="snippetStore.sortBy === opt.value
            ? 'text-github-blue-dark font-medium bg-github-blue-light'
            : 'text-zinc-700 hover:bg-zinc-200'"
          @click="setSort(opt.value)"
        >{{ opt.label }}</button>
      </div>
    </Transition>
  </div>
</template>
