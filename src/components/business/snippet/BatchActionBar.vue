<!-- ════════════════════════════════════════════════════════
     BatchActionBar —— 批量操作条（选中片段时悬浮列表底部）：全选 / 批量收藏到一夹 / 批量删除
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import FolderPicker from '@/components/business/folder/FolderPicker.vue'
import ConfirmDialog from '@/components/global/feedback/ConfirmDialog.vue'
import AppIcon from '@/components/global/base/AppIcon.vue'

const snippetStore = useSnippetStore()

function toggleSelectAll() {
  const ids = snippetStore.filteredSnippets.map(s => s.id)
  const allSelected = ids.length > 0 && ids.every(id => snippetStore.selectedIds.includes(id))
  if (allSelected) {
    snippetStore.clearSelection()
  } else {
    snippetStore.selectAll(ids)
  }
}

const showBatchFolder = ref(false)

function onBatchPick(folderId: string) {
  snippetStore.batchFavoriteTo(folderId)
}

// 收藏夹视图专用：把选中片段移出当前夹
function onBatchRemove() {
  snippetStore.batchRemoveFrom(snippetStore.filterValue)
}

const showBatchDelete = ref(false)

function confirmBatchDelete() {
  snippetStore.batchDelete()
  showBatchDelete.value = false
}
</script>

<template>
  <!-- 底部悬浮操作条：勾选了片段就出现，取消全部勾选即消失；列表很长滚到下方也能操作。
       inset-x-0 mx-auto w-fit 居中（不用 translate 避免与入场动画冲突） -->
  <Transition name="bar">
    <div
      v-if="snippetStore.selectedIds.length > 0"
      class="fixed bottom-4 inset-x-0 mx-auto w-fit z-40 flex items-center gap-1.5 bg-white border border-zinc-200 rounded-xl px-3 py-2 shadow-lg"
    >
      <span class="px-2 text-sm font-medium text-zinc-700 tabular-nums">已选 {{ snippetStore.selectedIds.length }} 项</span>
      <button
        class="px-3 py-1.5 text-sm text-zinc-700 bg-zinc-200 rounded-lg hover:bg-zinc-300 transition-colors cursor-pointer"
        @click="toggleSelectAll"
      >{{ snippetStore.selectedIds.length > 0 && snippetStore.filteredSnippets.every(s => snippetStore.selectedIds.includes(s.id)) ? '取消全选' : '全选' }}</button>
      <div class="w-px h-5 bg-zinc-200 mx-1"></div>
      <div class="relative">
        <button
          class="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-github-blue bg-github-blue-light rounded-lg hover:bg-github-blue-light-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="snippetStore.selectedIds.length === 0"
          @click="showBatchFolder = !showBatchFolder"
        ><AppIcon name="star" :size="14" /> 收藏</button>
        <Transition name="pop">
          <FolderPicker
            v-if="showBatchFolder"
            mode="pick"
            placement="top"
            @close="showBatchFolder = false"
            @pick="onBatchPick"
          />
        </Transition>
      </div>
      <button
        v-if="snippetStore.filterType === 'favorites'"
        class="px-3 py-1.5 text-sm text-zinc-800 bg-zinc-200 rounded-lg hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="snippetStore.selectedIds.length === 0"
        @click="onBatchRemove"
      >移出该夹</button>
      <button
        class="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 bg-red-100 rounded-lg hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="snippetStore.selectedIds.length === 0"
        @click="showBatchDelete = true"
      >删除</button>
      <div class="w-px h-5 bg-zinc-200 mx-1"></div>
      <button
        class="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-700 bg-zinc-200 rounded-lg hover:bg-zinc-300 transition-colors cursor-pointer"
        @click="snippetStore.clearSelection()"
      ><AppIcon name="x" :size="14" /> 清空</button>
    </div>
  </Transition>

  <ConfirmDialog
    :show="showBatchDelete"
    title="删除片段"
    :message="`确定删除选中的 ${snippetStore.selectedIds.length} 个片段吗？删除后不可恢复。`"
    confirm-text="删除"
    danger
    @cancel="showBatchDelete = false"
    @confirm="confirmBatchDelete"
  />
</template>

<style scoped>
/* 此处的 pop 用 bottom-right 原点（收藏夹弹层向上弹出），与全局 pop（top-right）不同，需保留 scoped；
   bar 入场（translateY(10px)）也仅此一处使用，一并保留 */
.pop-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  transform-origin: bottom right;
}
.pop-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
  transform-origin: bottom right;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

.bar-enter-active,
.bar-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
