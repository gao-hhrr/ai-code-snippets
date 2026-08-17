<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import { useRouter, useRoute } from 'vue-router'
import type { FilterType } from '@/stores/snippetStore'
import SidebarFolders from '@/components/snippet/SidebarFolders.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const snippetStore = useSnippetStore()
const router = useRouter()
const route = useRoute()

// 仅在列表页时高亮筛选项
function isActive(type: string, value = '') {
  return snippetStore.filterType === type && snippetStore.filterValue === value && route.name === 'snippets'
}

// 筛选类入口：设置筛选并确保停留在列表页
function applyFilter(type: FilterType, value = '') {
  snippetStore.setFilter(type, value)
  if (route.name !== 'snippets') {
    router.push('/')
  }
}

function goNew() {
  router.push('/snippet/new')
}

// 折叠状态不持久化：每次进入默认全展开，用户本次会话内折叠即可
const showLanguages = ref(true)

// 激活联动：筛选某语言时自动展开对应组，保证高亮项可见
watch(
  () => [snippetStore.filterType, snippetStore.filterValue],
  ([type]) => {
    if (type === 'language') showLanguages.value = true
  }
)

const recentCount = computed(() => {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return snippetStore.snippets.filter(s => new Date(s.createdAt).getTime() > weekAgo).length
})
</script>

<template>
  <aside class="w-60 border-r border-zinc-200 bg-white flex flex-col shrink-0">
    <!-- 动作区：核心动作固定置顶（新建片段 + AI 助手），不随下方列表滚动 -->
    <div class="shrink-0 p-3 pb-1 space-y-2">
      <button
        class="w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg text-base font-semibold text-github-blue border border-github-blue bg-white hover:bg-github-blue-light hover:border-github-blue-dark active:scale-[0.98] transition-all cursor-pointer"
        @click="goNew"
      >
        <AppIcon name="plus" :size="18" />
        新建片段
      </button>
      <button
        class="w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg text-base font-semibold text-github-blue border border-github-blue bg-white hover:bg-github-blue-light hover:border-github-blue-dark active:scale-[0.98] transition-all cursor-pointer"
        title="AI 助手：对话查找、总结你的代码片段"
        @click="router.push('/ai')"
      >
        <AppIcon name="search" :size="18" />
        AI 助手
      </button>
    </div>

    <!-- 浏览 + 筛选：可滚动区 -->
    <nav class="flex-1 min-h-0 overflow-y-auto p-3 pt-1 space-y-3">
      <!-- 浏览区：视图入口（全部片段 / 收藏夹，收藏夹点击展开收起夹列表） -->
      <div>
        <div class="border-t border-zinc-200 mb-1"></div>
        <p class="px-3 py-1 text-xs font-medium text-zinc-600">浏览</p>
        <div class="space-y-1">
          <button
            class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            :class="isActive('all')
              ? 'text-base text-github-blue font-medium bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400'
              : 'text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300'"
            @click="applyFilter('all')"
          >
            <span class="flex items-center gap-2"><AppIcon name="doc" :size="isActive('all') ? 18 : 16" /> 全部片段</span>
            <span class="text-xs tabular-nums" :class="isActive('all') ? 'text-github-blue' : 'text-zinc-600'">{{ snippetStore.snippets.length }}</span>
          </button>
          <SidebarFolders />
        </div>
      </div>

      <!-- 筛选区：按语言（可折叠，与「收藏夹」同款列表项 + 箭头） -->
      <div>
        <div class="border-t border-zinc-200 mb-1"></div>
        <p class="px-3 py-1 text-xs font-medium text-zinc-600">筛选</p>
        <div>
          <button
            class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300 transition-colors cursor-pointer"
            @click="showLanguages = !showLanguages"
          >
            <span class="flex items-center gap-2"><AppIcon name="folder" :size="16" /> 按语言</span>
            <span class="flex items-center gap-1">
              <span class="text-xs text-zinc-600 tabular-nums">{{ snippetStore.languageStats.length }}</span>
              <AppIcon
                name="chevron"
                :size="14"
                class="text-zinc-500 transition-transform duration-200"
                :class="showLanguages ? 'rotate-180' : ''"
              />
              </span>
            </button>

          <div v-if="showLanguages" class="space-y-0.5">
            <button
              v-for="lang in snippetStore.languageStats"
              :key="lang.name"
              class="w-full flex items-center justify-between pl-8 pr-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              :class="isActive('language', lang.name)
                ? 'text-base text-github-blue font-medium bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400'
                : 'text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300'"
              @click="applyFilter('language', lang.name)"
            >
              <span>{{ lang.name }}</span>
              <span class="text-xs tabular-nums" :class="isActive('language', lang.name) ? 'text-github-blue' : 'text-zinc-600'">{{ lang.count }}</span>
            </button>

            <div v-if="snippetStore.snippets.length > 0 && snippetStore.languageStats.length === 0" class="pl-8 pr-3 py-4 text-sm text-zinc-600 text-left">
              暂无语言分类
            </div>
          </div>

          <button
            class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            :class="isActive('recent')
              ? 'text-base text-github-blue font-medium bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400'
              : 'text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300'"
            @click="applyFilter('recent')"
          >
            <span class="flex items-center gap-2"><AppIcon name="clock" :size="isActive('recent') ? 18 : 16" /> 最近一周</span>
            <span class="text-xs tabular-nums" :class="isActive('recent') ? 'text-github-blue' : 'text-zinc-600'">{{ recentCount }}</span>
          </button>
        </div>
      </div>
    </nav>
  </aside>
</template>
