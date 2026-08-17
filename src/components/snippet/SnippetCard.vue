<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Snippet } from '@/types'
import { useSnippetStore } from '@/stores/snippetStore'
import { useRouter } from 'vue-router'
import FolderPicker from '@/components/snippet/FolderPicker.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ snippet: Snippet }>()
const snippetStore = useSnippetStore()
const router = useRouter()

const isSelected = computed(() => snippetStore.selectedIds.includes(props.snippet.id))
const isFavorited = computed(() => props.snippet.folderIds.length > 0)
const showPicker = ref(false)

// 拖选/复制代码时松开鼠标也会触发 click → 有非折叠选区就忽略这次点击，
// 否则在卡片上拖选复制一次就误跳详情（或批量模式下误勾选）
function onCardClick() {
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) return
  // 批量模式下点击卡片 = 切换选中，不跳详情
  if (snippetStore.batchMode) {
    snippetStore.toggleSelect(props.snippet.id)
    return
  }
  goDetail()
}

function goDetail() {
  router.push(`/snippet/${props.snippet.id}`)
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayMs = 86400000
  if (d >= startOfToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (d >= new Date(startOfToday.getTime() - dayMs)) return '昨天'
  // 跨年（非今年）的日期带上年份，避免"5/12"分不清是哪年
  if (d.getFullYear() !== now.getFullYear()) {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
</script>

<template>
  <div
    class="flex flex-col bg-white rounded-xl p-5 shadow ring-1 ring-zinc-300/70 hover:shadow-lg hover:ring-github-blue/40 transition-all cursor-pointer"
    :class="[
      // 弹层打开时去掉位移/缩放：它们是卡片自身 transform，会带着弹层一起动，
      // 光标在弹层边缘时形成 hover 循环导致抖动（抽搐）
      showPicker ? '' : 'hover:-translate-y-1 active:scale-[0.99]',
      isSelected ? 'ring-2 ring-github-blue bg-github-blue-light/60 shadow-md' : ''
    ]"
    @click="onCardClick"
  >
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2 shrink-0">
        <!-- label 扩大点击热区（-m-1.5 p-2 ≈ 32px，与收藏星一致），hover 显示浅墨圆底 -->
        <label
          class="-m-1.5 p-2 rounded-lg hover:bg-github-blue-light transition-colors cursor-pointer shrink-0"
          title="选择"
          @click.stop
        >
          <input
            type="checkbox"
            :checked="isSelected"
            class="w-4 h-4 accent-github-blue cursor-pointer shrink-0"
            @change="snippetStore.toggleSelect(snippet.id)"
          />
        </label>
        <span class="text-xs px-2 py-0.5 bg-github-blue-light text-github-blue-dark rounded font-medium">{{ snippet.language }}</span>
      </div>
      <div v-if="!snippetStore.batchMode" class="relative shrink-0 ml-2 flex items-center">
        <button
          class="-m-1.5 p-2 rounded-full text-zinc-500 hover:text-github-blue hover:bg-github-blue-light transition-colors cursor-pointer"
          title="收藏"
          @click.stop="showPicker = !showPicker"
        >
          <AppIcon name="star" :size="18" :filled="isFavorited" :class="isFavorited ? 'text-github-blue/70' : ''" />
        </button>
        <Transition name="pop">
          <FolderPicker
            v-if="showPicker"
            :snippet-id="snippet.id"
            @close="showPicker = false"
          />
        </Transition>
      </div>
    </div>

    <h3 class="text-base font-semibold text-zinc-900 truncate mb-2">{{ snippet.title }}</h3>

    <pre class="flex-1 text-xs text-zinc-600 bg-zinc-100 ring-1 ring-zinc-200 rounded-lg p-3 font-mono leading-relaxed overflow-hidden whitespace-pre-wrap break-words line-clamp-4 min-h-[76px]">{{ snippet.code.slice(0, 300) }}</pre>

    <div class="mt-2.5 text-xs text-zinc-600 tabular-nums">{{ formatTime(snippet.updatedAt) }}</div>
  </div>
</template>

<style scoped>
.pop-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  transform-origin: top right;
}
.pop-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
  transform-origin: top right;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}
</style>
