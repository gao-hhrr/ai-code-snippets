<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  show: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

// Esc 关闭：对话框打开时监听 document 级 keydown（焦点可能仍停留在触发它的按钮上），
// 收起时移除监听，避免影响其他组件
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.show) emit('cancel')
}

watch(
  () => props.show,
  (open) => {
    if (open) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 backdrop-blur-sm p-4"
        @mousedown.self="emit('cancel')"
      >
        <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-zinc-900/5">
          <h3 class="text-lg font-semibold text-zinc-900">{{ title || '提示' }}</h3>
          <p v-if="message" class="mt-2 text-sm text-zinc-600 leading-relaxed">{{ message }}</p>
          <div class="mt-6 flex justify-end gap-3">
            <button
              class="px-4 py-2 text-sm text-zinc-700 bg-zinc-200 rounded-lg hover:bg-zinc-300 transition-colors cursor-pointer"
              @click="emit('cancel')"
            >{{ cancelText || '取消' }}</button>
            <button
              class="px-4 py-2 text-sm text-white rounded-lg font-medium transition-all cursor-pointer"
              :class="danger ? 'bg-red-500 hover:bg-red-600' : 'bg-github-blue hover:bg-github-blue-dark'"
              @click="emit('confirm')"
            >{{ confirmText || '确定' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
