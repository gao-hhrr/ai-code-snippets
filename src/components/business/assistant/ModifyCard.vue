<!-- ════════════════════════════════════════════════════════
     ModifyCard —— AI 修改卡：改写中 / 失败 / 结果 diff + 二次确认
     props: msg + originalCode（父按 searchIds 取原代码传入）；AI 只给建议，落库靠父确认
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import type { AssistantTurnMessage } from '@/api/ai'
import DiffView from '@/components/editor/DiffView.vue'

const props = defineProps<{ msg: AssistantTurnMessage; originalCode: string }>()
const emit = defineEmits<{ saveAsNew: []; replace: []; export: [] }>()
</script>

<template>
  <div
    class="rounded-xl border overflow-hidden"
    :class="props.msg.modifyState === 'done' ? 'border-github-blue/30' : 'border-zinc-200'"
  >
    <div
      class="flex items-center gap-2 px-4 py-2.5 border-b"
      :class="props.msg.modifyState === 'done' ? 'bg-github-blue-light/60 border-github-blue/20' : 'bg-zinc-50 border-zinc-200'"
    >
      <span
        class="inline-block w-2 h-2 rounded-full shrink-0"
        :class="props.msg.modifyState === 'running' ? 'bg-github-blue animate-pulse' : props.msg.modifyState === 'error' ? 'bg-red-500' : 'bg-github-blue'"
      ></span>
      <span
        class="text-sm font-medium"
        :class="props.msg.modifyState === 'done' ? 'text-github-blue-dark' : props.msg.modifyState === 'error' ? 'text-red-500' : 'text-zinc-600'"
      >
        {{ props.msg.modifyState === 'running' ? 'AI 正在改写代码' : props.msg.modifyState === 'error' ? '修改未能完成' : 'AI 建议的改动' }}
      </span>
    </div>
    <div class="p-4">
      <!-- 改写中 -->
      <div v-if="props.msg.modifyState === 'running'" class="flex items-center gap-2 text-sm text-zinc-500">
        <span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-github-blue border-t-transparent animate-spin"></span>
        正在根据需求生成修改后的代码…
      </div>
      <!-- 失败 -->
      <p v-else-if="props.msg.modifyState === 'error'" class="text-sm text-red-500">{{ props.msg.content }}</p>
      <!-- 完成：AI 提醒 + diff + 确认操作 -->
      <template v-else-if="props.msg.modifyState === 'done' && props.msg.modifiedCode">
        <p class="text-sm text-zinc-600 mb-3">{{ props.msg.note || '请确认以下改动，确认后才写入你的代码库。' }}</p>
        <DiffView :original="props.originalCode" :modified="props.msg.modifiedCode" />
        <div class="mt-3 flex flex-wrap gap-3">
          <button
            class="inline-flex items-center gap-1.5 px-4 py-2 bg-github-blue text-white rounded-lg text-sm font-medium hover:bg-github-blue-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="props.msg.modifyApplied"
            @click="emit('saveAsNew')"
          >保存为新片段</button>
          <button
            class="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-200 text-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="props.msg.modifyApplied"
            title="覆盖原代码，操作前会再次确认"
            @click="emit('replace')"
          >替换原代码</button>
          <button
            class="inline-flex items-center gap-1.5 px-4 py-2 text-github-blue bg-github-blue-light rounded-lg text-sm hover:bg-github-blue-light-hover transition-colors cursor-pointer"
            @click="emit('export')"
          >导出</button>
        </div>
        <p v-if="props.msg.modifyApplied" class="text-xs text-github-blue mt-2">已应用到代码库</p>
      </template>
    </div>
  </div>
</template>
