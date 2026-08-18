<!-- ════════════════════════════════════════════════════════
     SnippetResultCard —— 搜索结果片段大卡：语言色点 + 标题 + AI 描述 + 代码预览
     props: snippet；点击抛 open（父跳转详情）
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import type { Snippet } from '@/types'

// 语言色点：GitHub 语言色（未收录的落灰 #8b949e）
const LANG_COLORS: Record<string, string> = {
  javascript: '#f1e05a', typescript: '#3178c6', python: '#3572A5', css: '#563d7c',
  html: '#e34c26', vue: '#41b883', json: '#8e8e8e', java: '#b07219', go: '#00ADD8',
  rust: '#dea584', c: '#555555', cpp: '#f34b7d', csharp: '#178600', sql: '#e38c00',
  shell: '#89e051', bash: '#89e051', markdown: '#083fa1', yaml: '#cb171e'
}

function langColor(language: string): string {
  return LANG_COLORS[language.toLowerCase()] || '#8b949e'
}

// 代码预览：最多 4 行 / 160 字符（与 OperateCard 各持一份，6 行重复好过为单函数建模块）
function previewLines(code: string): string {
  const t = code.split('\n').slice(0, 4).join('\n').trimEnd()
  return t.length > 160 ? t.slice(0, 160) + '…' : (t || '—')
}

const props = defineProps<{ snippet: Snippet }>()
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <div
    class="group bg-white border border-zinc-200 rounded-xl px-5 py-4 cursor-pointer hover:border-github-blue/60 hover:shadow-sm transition-all"
    @click="emit('open')"
  >
    <div class="flex items-center gap-2.5">
      <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: langColor(props.snippet.language) }" />
      <span class="text-sm font-medium text-zinc-500 shrink-0">{{ props.snippet.language }}</span>
      <span class="text-[17px] font-semibold text-zinc-900 truncate flex-1">{{ props.snippet.title }}</span>
      <span class="text-sm text-github-blue shrink-0 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">打开 →</span>
    </div>
    <p v-if="props.snippet.description" class="text-[15px] text-zinc-500 mt-1.5 line-clamp-2">{{ props.snippet.description }}</p>
    <pre v-if="props.snippet.code" class="mt-2.5 rounded-md bg-zinc-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-600 overflow-hidden whitespace-pre font-mono">{{ previewLines(props.snippet.code) }}</pre>
  </div>
</template>
