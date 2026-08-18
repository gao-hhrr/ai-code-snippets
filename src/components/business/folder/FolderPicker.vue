<!-- ════════════════════════════════════════════════════════
     FolderPicker —— 收藏夹选择弹层：toggle 单个片段勾选多个夹 / pick 批量收藏到一夹
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import { useClickOutside, useEscape } from '@/composables/useClickOutside'

import AppIcon from '@/components/global/base/AppIcon.vue'

const props = withDefaults(defineProps<{
  snippetId?: string
  //toggle：单个片段可以选收藏到多个文件夹
  //pick：底部操作栏时，选中多个片段收藏到一个文件夹
  mode?: 'toggle' | 'pick'
  //弹窗弹出方向
  placement?: 'top' | 'bottom'
}>(), { mode: 'toggle', placement: 'bottom' })

const emit = defineEmits<{
  (e: 'close'): void//SnippetCard
  (e: 'pick', folderId: string): void//BatchActionBar
}>()

const snippetStore = useSnippetStore()

//从全局片段列表找到对应那条片段数据
const snippet = computed(() =>
  props.snippetId ? snippetStore.snippets.find(s => s.id === props.snippetId) : undefined
)

//判断是否已收藏
function isChecked(folderId: string) {
  return props.mode === 'toggle' && !!snippet.value?.folderIds.includes(folderId)
}

function selectFolder(folderId: string) {
  if (props.mode === 'pick') {
    emit('pick', folderId)
    emit('close')
    return
  }
  if (!props.snippetId) return
  if (snippet.value?.folderIds.includes(folderId)) {
    snippetStore.unfavoriteFrom(props.snippetId, folderId)
  } else {
    snippetStore.favoriteTo(props.snippetId, folderId)
  }
}

const creating = ref(false)
const newName = ref('')
const newInput = ref<HTMLInputElement>()

async function startCreate() {
  creating.value = true
  newName.value = ''
  await nextTick()//等待DOM完成更新
  newInput.value?.focus()
}

function cancelCreate() {
  creating.value = false
  newName.value = ''
}

function confirmCreate() {
  const name = newName.value.trim()
  if (!name) {
    creating.value = false
    return
  }
  const id = snippetStore.addFolder(name)
  if (id && props.mode === 'pick') {
    emit('pick', id)
    emit('close')
  }
  creating.value = false
}

const pickerEl = ref<HTMLElement>()

// 点击气泡外立即关闭，capture 阶段阻止事件继续传播（避免关闭瞬间这次点击穿透到下方按钮，如卡片跳转）
useClickOutside(() => emit('close'), { root: pickerEl, event: 'click', stopPropagation: true })
// Esc 关闭
useEscape(() => emit('close'))

// 打开 5 秒无操作自动收起；鼠标悬停在气泡上时暂停，移出后重新计时
let autoCloseTimer: number | undefined

function scheduleAutoClose() {
  clearTimeout(autoCloseTimer)
  // 输入型不自动收起（与侧边栏气泡一致）：新建收藏夹在打字时自动关会打断输入
  if (creating.value) return
  autoCloseTimer = window.setTimeout(() => emit('close'), 5000)
}

function pauseAutoClose() {
  clearTimeout(autoCloseTimer)
}

onMounted(scheduleAutoClose)
onBeforeUnmount(() => {
  clearTimeout(autoCloseTimer)
})
</script>

<template>
  <div
    ref="pickerEl"
      class="absolute right-0 z-50 w-56 bg-white border border-zinc-200 rounded-xl shadow-lg p-1.5"
      :class="placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'"
      @click.stop
      @mouseenter="pauseAutoClose"
      @mouseleave="scheduleAutoClose"
    >
      <p class="px-2.5 pt-1.5 pb-1 text-xs font-medium text-zinc-600">收藏到：</p>

      <div v-if="snippetStore.folders.length === 0" class="px-2.5 py-4 text-sm text-zinc-600 text-center">
        还没有收藏夹，先新建一个
      </div>

      <button
        v-for="f in snippetStore.folders"
        :key="f.id"
        class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-zinc-700 hover:bg-zinc-200 transition-colors cursor-pointer"
        @click="selectFolder(f.id)"
      >
        <span
          v-if="mode === 'toggle'"
          class="shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-sm border transition-colors"
          :class="isChecked(f.id) ? 'bg-github-blue border-github-blue' : 'border-zinc-300'"
        >
          <AppIcon v-if="isChecked(f.id)" name="check" :size="10" class="text-white" />
        </span>
        <span
          class="truncate flex-1 text-left"
          :class="mode === 'toggle' && isChecked(f.id) ? 'text-github-blue font-medium' : ''"
        >{{ f.name }}</span>
        <span class="text-xs shrink-0 tabular-nums" :class="mode === 'toggle' && isChecked(f.id) ? 'text-github-blue' : 'text-zinc-600'">{{ snippetStore.folderStats.find(x => x.id === f.id)?.count ?? 0 }}</span>
      </button>

      <div class="border-t border-zinc-200 mt-1.5 pt-1.5">
        <div v-if="creating" class="flex items-center gap-1.5 px-1 pb-1">
          <input
            ref="newInput"
            v-model="newName"
            placeholder="收藏夹名称"
            maxlength="12"
            class="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-zinc-100 rounded-md focus:outline-none focus:bg-white"
            @keydown.enter="confirmCreate"
            @keydown.esc="cancelCreate"
          />
          <button
            class="shrink-0 px-2.5 py-1.5 text-sm text-white bg-github-blue rounded-lg hover:bg-github-blue-dark transition-colors cursor-pointer disabled:opacity-50"
            :disabled="!newName.trim()"
            @click="confirmCreate"
          >创建</button>
        </div>
        <button
          v-else
          class="w-full flex items-center justify-center gap-1 px-2.5 py-2 text-sm text-zinc-800 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer"
          @click="startCreate"
        >
          <AppIcon name="plus" :size="14" />
          新建收藏夹
        </button>
      </div>
  </div>
</template>
