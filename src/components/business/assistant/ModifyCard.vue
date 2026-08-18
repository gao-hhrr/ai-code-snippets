<!-- ════════════════════════════════════════════════════════
     ModifyCard —— AI 修改卡：改写中 / 失败 / 结果 diff + 二次确认
     props: msg + originalCode（父按 searchIds 取原代码传入）；AI 只给建议，落库靠父确认
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { computed } from 'vue'
import type { AssistantTurnMessage } from '@/api/ai'
import DiffView from '@/components/editor/DiffView.vue'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'

const props = defineProps<{ msg: AssistantTurnMessage; originalCode: string }>()
const emit = defineEmits<{ saveAsNew: []; replace: []; export: []; undoReplace: []; view: [snippetId: string] }>()

const assistantStore = useAiAssistantStore()
// 等待提示随深度思考开关变化：开启时推理更长，超时放宽到 180s
const waitHint = computed(() => assistantStore.deepThink ? '深度思考中，复杂需求最长约 180 秒，请稍候' : '代码较长或 AI 推理较慢时最长约 90 秒，请稍候')
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
      <!-- 改写中：流式进度实时显示；代码较长/推理较慢时最长约 90 秒 -->
      <div v-if="props.msg.modifyState === 'running'" class="flex flex-col gap-1.5 text-sm text-zinc-500">
        <div class="flex items-center gap-2">
          <span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-github-blue border-t-transparent animate-spin"></span>
          <span>正在根据需求生成修改后的代码…</span>
          <span v-if="props.msg.modifyProgress" class="text-zinc-400">（已生成 {{ props.msg.modifyProgress }} 字）</span>
        </div>
        <p class="text-xs text-zinc-400">{{ waitHint }}</p>
      </div>
      <!-- 失败 -->
      <p v-else-if="props.msg.modifyState === 'error'" class="text-sm text-red-500">{{ props.msg.content }}</p>
      <!-- 完成：AI 提醒 + diff + 确认操作 -->
      <template v-else-if="props.msg.modifyState === 'done' && props.msg.modifiedCode">
        <p class="text-sm text-zinc-600 mb-3">{{ props.msg.note || '请确认以下改动，确认后才写入你的代码库。' }}</p>
        <div
          v-if="props.msg.modifiedDegraded"
          class="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 leading-relaxed"
        >⚠ 深度思考未生效，已降级为普通模式修改——本次修改未经过深度推理，复杂需求下质量可能打折。</div>
        <DiffView :original="props.originalCode" :modified="props.msg.modifiedCode" />
        <div class="mt-3 flex flex-wrap gap-3">
          <button
            class="inline-flex items-center gap-1.5 px-4 py-2 bg-github-blue text-white rounded-lg text-sm font-medium hover:bg-github-blue-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="props.msg.modifyApplied"
            title="保存前可在编辑页调整标题/语言/代码"
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
          <button
            v-if="props.msg.modifyApplied && props.msg.modifyBackup"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-red-600 bg-red-50 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors cursor-pointer"
            title="用替换前暂存的原代码恢复该片段"
            @click="emit('undoReplace')"
          >撤销替换</button>
        </div>
        <!-- 提示「保存为新片段」的真实行为（跳编辑页再确认），避免用户以为点了立即落库 -->
        <p v-if="!props.msg.modifyApplied && !props.msg.modifySave" class="text-xs text-zinc-400 mt-2">
          点「保存为新片段」会先进入编辑页，可调整标题/语言/代码后再保存。
        </p>
        <p v-if="props.msg.modifyApplied" class="flex items-center gap-1.5 text-xs text-github-blue mt-2">
          <span>{{ props.msg.modifyBackup ? '已替换原代码' : '已保存为新片段' }}</span>
          <a
            v-if="props.msg.modifySavedSnippetId"
            class="underline cursor-pointer hover:text-github-blue-dark"
            @click="emit('view', props.msg.modifySavedSnippetId as string)"
          >查看</a>
        </p>
        <p v-else-if="props.msg.modifySave === 'pending'" class="text-xs text-zinc-500 mt-2">正在编辑页确认保存…</p>
        <p v-else-if="props.msg.modifySave === false" class="text-xs text-zinc-500 mt-2">未保存——可点「保存为新片段」重新进入编辑</p>
      </template>
    </div>
  </div>
</template>
