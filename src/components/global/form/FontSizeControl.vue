<!-- ════════════════════════════════════════════════════════
     FontSizeControl —— 代码字号调节（A−/数值/A+，14–28 钳制，详情/编辑页共用）
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
// v-model:size 双向绑定
const size = defineModel<number>('size', { default: 20 })

function change(delta: number) {
  size.value = Math.min(28, Math.max(14, size.value + delta))
}
</script>

<template>
  <div class="absolute bottom-5 right-5 z-10 flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 shadow-md">
    <button
      class="text-sm text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded hover:bg-zinc-200 transition-colors cursor-pointer"
      title="减小字号"
      @click="change(-1)"
    >A</button>
    <span class="w-8 text-center text-sm text-zinc-600 tabular-nums">{{ size }}</span>
    <button
      class="text-xl text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded hover:bg-zinc-200 transition-colors cursor-pointer"
      title="增大字号"
      @click="change(1)"
    >A</button>
  </div>
</template>
