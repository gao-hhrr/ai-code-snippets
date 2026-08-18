<!-- ════════════════════════════════════════════════════════
     OperateCard —— AI 库操作确认卡：AI 提议删除/重命名/收藏/导出等，用户确认后才执行
     props: msg + snippets（批量操作目标清单）+ totalCount（清空文案用）；危险操作由父再做双重确认
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import type { AssistantTurnMessage } from '@/api/ai'
import type { Snippet } from '@/types'

// --- 12 种操作文案 + 危险判定（本卡片自包含）---
const OP_LABEL: Record<string, string> = {
  delete: 'AI 提议删除片段',
  rename: 'AI 提议重命名片段',
  export: 'AI 提议导出片段',
  favorite: 'AI 提议收藏片段',
  unfavorite: 'AI 提议取消收藏',
  create: 'AI 提议新建片段',
  clear: 'AI 提议清空片段库',
  createFolder: 'AI 提议新建收藏夹',
  renameFolder: 'AI 提议重命名收藏夹',
  deleteFolder: 'AI 提议删除收藏夹',
  clearFolder: 'AI 提议清空收藏夹',
  meta: 'AI 提议修改片段'
}

function operateTitle(msg: AssistantTurnMessage): string {
  if (msg.operateState === 'running') return 'AI 正在生成代码'
  if (msg.operateState === 'executed') return '操作已完成'
  if (msg.operateState === 'cancelled') return '操作已取消'
  if (msg.operateState === 'error') return '操作失败'
  return OP_LABEL[msg.operateOp ?? ''] ?? 'AI 提议操作'
}

// 描述文案依赖库内数据：片段清单（批量操作列出目标）与片段总数（清空文案），由页面计算好传入
function operateDesc(msg: AssistantTurnMessage, snippets: Snippet[], totalCount: number): string {
  const title = msg.targetTitle || '该片段'
  const listLines = snippets.length > 1 ? '\n· ' + snippets.map(s => s.title).join('\n· ') : ''
  switch (msg.operateOp) {
    case 'delete':
      return snippets.length > 1
        ? `将删除以下 ${snippets.length} 个片段，删除后不可恢复：${listLines}`
        : `将删除片段「${title}」，删除后不可恢复。`
    case 'rename': return `将把片段「${title}」重命名为「${msg.operateValue}」。`
    case 'export': return `将导出片段「${title}」。`
    case 'favorite':
      return snippets.length > 1
        ? `将把以下 ${snippets.length} 个片段收藏到「${msg.operateValue}」：${listLines}`
        : `将把片段「${title}」收藏到「${msg.operateValue}」。`
    case 'unfavorite':
      return snippets.length > 1
        ? `将把以下 ${snippets.length} 个片段移出「${msg.operateValue}」：${listLines}`
        : `将把片段「${title}」移出「${msg.operateValue}」。`
    case 'create': return `将新建片段「${msg.operateValue || '未命名'}」（${msg.createdLanguage || 'text'}），确认后存入代码库。`
    case 'clear': return `将删除全部 ${totalCount} 个片段，不可恢复。`
    case 'createFolder': return `将新建收藏夹「${msg.operateValue}」。`
    case 'renameFolder': return `将把收藏夹「${msg.operateTarget}」改名为「${msg.operateValue}」。`
    case 'deleteFolder': return `将删除收藏夹「${msg.operateValue}」，片段不会被删除，只是移出该夹。`
    case 'clearFolder': return `将清空收藏夹「${msg.operateValue}」，只移出该夹，片段不会被删除。`
    case 'meta': return `将把片段「${title}」的${msg.operateField === 'language' ? '语言' : '描述'}改为「${msg.operateValue}」。`
    default: return ''
  }
}

// 代码预览：最多 4 行 / 160 字符（与 SnippetResultCard 各持一份，6 行重复好过为单函数建模块）
function previewLines(code: string): string {
  const t = code.split('\n').slice(0, 4).join('\n').trimEnd()
  return t.length > 160 ? t.slice(0, 160) + '…' : (t || '—')
}

// danger：危险/不可逆操作的配色开关（名单由页面单源判定后传入，本卡片只负责渲染）
const props = defineProps<{ msg: AssistantTurnMessage; snippets: Snippet[]; totalCount: number; danger: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div
    class="rounded-xl border overflow-hidden"
    :class="props.msg.operateState === 'pending' ? (props.danger ? 'border-red-200' : 'border-github-blue/30') : 'border-zinc-200'"
  >
    <div
      class="flex items-center gap-2 px-4 py-2.5 border-b"
      :class="props.msg.operateState === 'pending'
        ? (props.danger ? 'bg-red-50 border-red-100' : 'bg-github-blue-light/60 border-github-blue/20')
        : 'bg-zinc-50 border-zinc-200'"
    >
      <span
        class="inline-block w-2 h-2 rounded-full shrink-0"
        :class="props.msg.operateState === 'pending'
          ? (props.danger ? 'bg-red-500 animate-pulse' : 'bg-github-blue animate-pulse')
          : props.msg.operateState === 'running' ? 'bg-github-blue animate-pulse' : props.msg.operateState === 'error' ? 'bg-red-500' : 'bg-zinc-400'"
      ></span>
      <span
        class="text-sm font-medium"
        :class="props.msg.operateState === 'pending'
          ? (props.danger ? 'text-red-600' : 'text-github-blue-dark')
          : props.msg.operateState === 'error' ? 'text-red-500' : 'text-zinc-600'"
      >{{ operateTitle(props.msg) }}</span>
    </div>
    <div class="p-4">
      <!-- create 生成代码中：流式进度实时显示，代码较长/推理较慢时最长约 90 秒 -->
      <div v-if="props.msg.operateState === 'running'" class="flex flex-col gap-1.5 text-sm text-zinc-500">
        <div class="flex items-center gap-2">
          <span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-github-blue border-t-transparent animate-spin"></span>
          <span>正在根据需求生成代码…</span>
          <span v-if="props.msg.createdProgress" class="text-zinc-400">（已生成 {{ props.msg.createdProgress }} 字）</span>
        </div>
        <p class="text-xs text-zinc-400">代码较长或 AI 推理较慢时最长约 90 秒，请稍候</p>
      </div>
      <template v-else-if="props.msg.operateState === 'pending'">
        <p class="text-sm text-zinc-600 mb-3">{{ props.msg.note || '以下操作将改动你的代码库，请确认后再执行。' }}</p>
        <p class="text-sm text-zinc-800 bg-zinc-50 rounded-lg px-3 py-2 mb-3 whitespace-pre-wrap break-words">{{ operateDesc(props.msg, props.snippets, props.totalCount) }}</p>
        <!-- create：生成代码预览，让用户确认内容 -->
        <pre
          v-if="props.msg.operateOp === 'create' && props.msg.createdCode"
          class="mb-3 rounded-md bg-zinc-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-600 overflow-hidden whitespace-pre font-mono"
        >{{ previewLines(props.msg.createdCode) }}</pre>
        <div class="flex flex-wrap gap-3">
          <button
            class="inline-flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
            :class="props.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-github-blue hover:bg-github-blue-dark'"
            @click="emit('confirm')"
          >确认执行</button>
          <button
            class="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-200 text-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors cursor-pointer"
            @click="emit('cancel')"
          >取消</button>
        </div>
      </template>
      <p v-else-if="props.msg.operateState === 'executed'" class="text-sm text-github-blue">已执行</p>
      <p v-else-if="props.msg.operateState === 'cancelled'" class="text-sm text-zinc-400">已取消</p>
      <p v-else-if="props.msg.operateState === 'error'" class="text-sm text-red-500">{{ props.msg.content }}</p>
    </div>
  </div>
</template>
