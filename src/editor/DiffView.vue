<script setup lang="ts">
import { computed } from 'vue'
import { diffLines, type Change } from 'diff'

const props = defineProps<{ original: string; modified: string }>()

const changes = computed(() => {
  return diffLines(props.original, props.modified)
})

function changeClass(change: Change) {
  if (change.added) return 'bg-green-50 border-l-4 border-green-400'
  if (change.removed) return 'bg-red-100 border-l-4 border-red-400'
  return ''
}

function linePrefix(change: Change) {
  if (change.added) return '+'
  if (change.removed) return '-'
  return ' '
}
</script>

<template>
  <div class="rounded-lg overflow-hidden border border-zinc-200">
    <div class="bg-zinc-100 px-4 py-2 text-xs text-zinc-600 border-b border-zinc-200 flex items-center gap-4">
      <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-green-400 inline-block"></span> 新增</span>
      <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-red-400 inline-block"></span> 删除</span>
      <span class="text-zinc-600 ml-auto">统一 diff</span>
    </div>

    <div class="overflow-x-auto">
      <div class="font-mono text-sm leading-relaxed">
        <div
          v-for="(change, i) in changes"
          :key="i"
          :class="[changeClass(change), 'px-4 py-0.5 flex']"
        >
          <span class="select-none text-zinc-500 w-5 shrink-0">{{ linePrefix(change) }}</span>
          <pre class="m-0 whitespace-pre-wrap flex-1"><code>{{ change.value.replace(/\n$/, '') }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>
