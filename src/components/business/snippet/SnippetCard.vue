<!-- ════════════════════════════════════════════════════════
     SnippetCard —— 片段卡片：点击进详情（拖选复制时忽略）/ 批量勾选 / 收藏星弹 FolderPicker
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Snippet } from '@/types'
import { useSnippetStore } from '@/stores/snippetStore'
import { useRouter } from 'vue-router'
import FolderPicker from '@/components/business/folder/FolderPicker.vue'
import AppIcon from '@/components/global/base/AppIcon.vue'
import { formatTime } from '@/services/date'

const props = defineProps<{ snippet: Snippet }>()
const snippetStore = useSnippetStore()
const router = useRouter()

const isSelected = computed(() => snippetStore.selectedIds.includes(props.snippet.id))
const isFavorited = computed(() => props.snippet.folderIds.length > 0)
const showPicker = ref(false)

// 拖选/复制代码时松开鼠标也会触发 click → 有非折叠选区就忽略这次点击，
// 否则在卡片上拖选复制一次就误跳详情（或批量模式下误勾选）
function onCardClick() {
  //获取鼠标选中的文本
  const sel = window.getSelection()
  //选区是否为空，为空直接跳出   
  // sel.isCollapsed === false：鼠标拖动框选了一段文字（复制文字场景）
  // sel.isCollapsed === true：光标只是点一下，没有拖动选中文字
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
