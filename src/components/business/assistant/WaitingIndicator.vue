<!-- ════════════════════════════════════════════════════════
     WaitingIndicator —— 等待回复四步阶段指示（分析请求→梳理信息→解读意图→构思回应）
     读 store 的 sending/retrying/reasoning/elapsed/phase；503 退避单独提示
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { computed } from 'vue'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'
import AppIcon from '@/components/global/base/AppIcon.vue'

const assistantStore = useAiAssistantStore()

// 等待期四步阶段指示（分析请求→梳理信息→解读意图→构思回应），由 store 的 phase 状态机驱动。
// 完成=蓝勾 / 进行中=蓝点 / 未到=灰；纯前端流程状态，不依赖模型输出
const PHASES = ['分析请求', '梳理信息', '解读意图', '构思回应']

// 识别已走完、正在第二次调用生成代码（AI 修改 / 新建）：此时 phase 仍停在 compose（composing 为 true），
// 四步会一直闪烁「④ 构思回应」误导用户以为卡在识别；改显「正在生成代码」，并报已等待秒数
const generating = computed(() => {
  const m = assistantStore.messages[assistantStore.messages.length - 1]
  return m?.modifyState === 'running' || m?.operateState === 'running'
})
function phaseState(p: 'retrieve' | 'analyze' | 'compose' | null, i: number): 'done' | 'active' | 'todo' {
  if (p === 'retrieve') return i === 0 ? 'done' : i === 1 ? 'active' : 'todo'
  if (p === 'analyze') return i < 2 ? 'done' : i === 2 ? 'active' : 'todo'
  if (p === 'compose') return i < 3 ? 'done' : 'active'
  return 'todo'
}
</script>

<template>
  <div class="flex justify-start">
    <div class="max-w-[85%] px-5 py-3 rounded-2xl rounded-bl-md bg-zinc-100 text-base text-zinc-500 space-y-2.5">
      <div v-if="assistantStore.retrying">服务器繁忙，自动重试中…</div>
      <!-- 识别已完成、正在第二次调用生成代码：四步已走完，改显"正在生成"，避免误以为卡在识别 -->
      <div v-else-if="generating" class="flex items-center gap-2 text-sm text-zinc-500">
        <span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-github-blue border-t-transparent animate-spin"></span>
        <span>识别已完成，正在生成代码…（已等 {{ assistantStore.elapsed }} 秒）</span>
      </div>
      <template v-else>
        <!-- 阶段进度：完成=蓝勾，进行中=蓝点脉冲，未到=灰 -->
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            v-for="(label, i) in PHASES"
            :key="label"
            class="flex items-center gap-1 px-2 py-1 rounded-full transition-colors"
            :class="phaseState(assistantStore.phase, i) === 'todo' ? 'text-zinc-400' : 'text-github-blue'"
          >
            <span
              class="flex items-center justify-center w-4 h-4 rounded-full shrink-0"
              :class="phaseState(assistantStore.phase, i) === 'done'
                ? 'bg-github-blue border border-github-blue'
                : phaseState(assistantStore.phase, i) === 'active'
                  ? 'border border-github-blue'
                  : 'border border-zinc-300'"
            >
              <AppIcon v-if="phaseState(assistantStore.phase, i) === 'done'" name="check" :size="10" class="text-white" />
              <span v-else-if="phaseState(assistantStore.phase, i) === 'active'" class="w-1.5 h-1.5 rounded-full bg-github-blue animate-pulse"></span>
            </span>
            <span>{{ label }}</span>
          </span>
        </div>
        <!-- 思考中：只显示阶段进度 + 时长，不展示思考原文（原文等结束后二次总结成四步，展开折叠面板查看） -->
        <div v-if="assistantStore.reasoning" class="text-sm text-zinc-400">正在思考…（已等 {{ assistantStore.elapsed }} 秒{{ assistantStore.elapsed > 20 ? '，AI 推理较慢，最长约 60 秒' : '' }}）</div>
        <div v-else class="text-sm text-zinc-400">正在梳理信息…（已等待 {{ assistantStore.elapsed }} 秒）</div>
      </template>
    </div>
  </div>
</template>
