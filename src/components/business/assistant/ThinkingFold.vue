<!-- ════════════════════════════════════════════════════════
     ThinkingFold —— 思考过程折叠面板：结果出来后默认收起
     有四步总结显示总结，缺失则兜底展示 reasoning 原文；展开状态卡片自管
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref } from 'vue'
import type { AssistantTurnMessage } from '@/api/ai'

// 思考总结展示规整：模型偶发省略换行/漏编号，把 ①②③④ 标记统一独立成行，避免多步挤在一行
function fmtSummary(text: string): string {
  return text.replace(/(?<!\n)(?=[①②③④])/g, '\n').replace(/^\n/, '').trim()
}

const props = defineProps<{ msg: AssistantTurnMessage }>()
const open = ref(false)
function toggle() {
  open.value = !open.value
}
</script>

<template>
  <div>
    <button
      class="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer"
      @click="toggle"
    >AI 思考过程总结{{ open ? '（收起）' : '' }}</button>
    <div v-if="open" class="mt-1.5 p-2.5 rounded-md bg-zinc-50 space-y-2">
      <template v-if="props.msg.thinkingSummary">
        <div class="text-sm text-zinc-500 whitespace-pre-wrap break-words leading-relaxed">{{ fmtSummary(props.msg.thinkingSummary) }}</div>
      </template>
      <div v-else class="text-sm text-zinc-400 whitespace-pre-wrap break-words leading-relaxed max-h-56 overflow-y-auto">{{ props.msg.reasoning }}</div>
    </div>
  </div>
</template>
