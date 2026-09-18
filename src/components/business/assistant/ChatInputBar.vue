<!-- ════════════════════════════════════════════════════════
     ChatInputBar —— AI 助手底部输入区：错误提示+重试、输入框+发送/停止、换话题/重新开始
     直接用 store；输入聚焦由页面经模板 ref 调 focusInput() 接管（返回/重新激活时自动聚焦）
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'

const assistantStore = useAiAssistantStore()
const input = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)

// 输入框自动增高：随内容生长，超 160px 内部滚动（多行粘贴代码不顶破底部浮层）
function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

// 只有真错误用红字；"已停止搜索""对话已达上限"是**状态**不是错误，用中性灰（tone:'info'）
const errorTone = computed(() => assistantStore.error?.tone === 'info' ? 'text-zinc-500' : 'text-red-500')

// 深度思考开关的悬浮说明：秒数取自 store 的超时常量（单一来源），不手抄
const deepThinkTip = computed(() =>
  `深度思考：生成/修改代码时先深度推理再作答，复杂需求质量更高但更慢（开启后最长约 ${assistantStore.deepThinkTimeoutSec} 秒）；关闭则用普通模式直接输出、更快`
)

// 对话轮数上限：只数 user 消息，达到后禁用输入并提示开启新对话
const reachedLimit = () => assistantStore.messages.filter(m => m.role === 'user').length >= assistantStore.MAX_TURNS

function send(text = input.value) {
  const q = text.trim()
  if (!q || assistantStore.sending || reachedLimit()) return
  assistantStore.send(q)
  input.value = ''
  nextTick(autoGrow) // 清空后回落到单行高度
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return // 中文输入法组词中的 Enter 是确认候选，不是发送
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
  // Shift+Enter 走默认换行，textarea 原生支持
}

// 页面在进入/重新激活时聚焦输入框（prepareEntry 经模板 ref 调用）
defineExpose({ focusInput: () => inputEl.value?.focus() })
</script>

<template>
  <!-- 底部输入：浮空盖在对话区上方——absolute 定位盖住滚动区底部，消息滚到下面被渐变柔和遮住。
       pointer-events-none 外套 + 居中列：右侧滚动条露在 max-w 外侧不被不透明条盖住，仍可拖动 -->
  <div class="absolute inset-x-0 bottom-0 pointer-events-none">
    <div class="flex justify-center">
      <div class="w-full max-w-[880px]">
        <!-- 渐变遮罩：消息沉入底部前柔和淡出，避免硬切 -->
        <div class="h-12" style="background: linear-gradient(to top, var(--color-zinc-50), transparent)"></div>
        <div class="bg-zinc-50 px-4 sm:px-6 py-5 pointer-events-auto">
          <div v-if="assistantStore.error" class="flex items-start justify-between gap-2 text-xs mb-2" :class="errorTone">
            <span class="min-w-0 break-words">{{ assistantStore.error.text }}</span>
            <button
              v-if="assistantStore.lastUserText && !reachedLimit()"
              class="shrink-0 px-2 py-1 text-xs text-github-blue border border-github-blue/40 rounded-md hover:bg-github-blue-light transition-colors cursor-pointer"
              @click="assistantStore.retry()"
            >重试</button>
          </div>
          <div v-else-if="reachedLimit()" class="text-xs text-zinc-500 mb-2">对话已达上限，点击「重新开始」开启新对话</div>
          <div
            class="flex items-end gap-2 bg-white border border-zinc-300 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.07)] pl-5 pr-2 py-2.5"
          >
            <textarea
              ref="inputEl"
              v-model="input"
              rows="1"
              maxlength="20000"
              :placeholder="assistantStore.messages.length > 0 ? '继续问我你存过的代码…' : '问我你存过的代码…'"
              :disabled="reachedLimit()"
              class="plain-input flex-1 min-w-0 bg-transparent text-base text-zinc-800 placeholder:text-zinc-400 outline-none resize-none overflow-y-auto leading-relaxed py-2 disabled:opacity-50"
              @keydown="onKeydown"
              @input="autoGrow"
            ></textarea>
            <button
              :disabled="(!input.trim() && !assistantStore.sending) || reachedLimit()"
              :class="assistantStore.sending ? 'bg-red-500 hover:bg-red-600' : 'bg-github-blue hover:bg-github-blue-dark'"
              class="shrink-0 px-5 h-11 text-base text-white font-medium rounded-full active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              @click="assistantStore.sending ? assistantStore.stop() : send()"
            >{{ assistantStore.sending ? '停止' : '发送' }}</button>
          </div>
          <div class="flex items-center justify-center gap-2 mt-2.5">
            <button
              class="px-2 py-1 text-sm rounded-md cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              :class="assistantStore.deepThink
                ? 'bg-github-blue-light text-github-blue'
                : 'text-zinc-500 hover:text-zinc-700'"
              :title="deepThinkTip"
              :disabled="assistantStore.sending"
              @click="assistantStore.deepThink = !assistantStore.deepThink"
            >深度思考</button>
            <span class="text-xs text-zinc-400 select-none">仅代码生成/修改</span>
            <span class="text-zinc-300 select-none">·</span>
            <button
              class="px-2 py-1 text-sm text-zinc-500 hover:text-zinc-700 rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="换话题：下一条消息不带上文，但保留对话记录"
              :disabled="assistantStore.sending || assistantStore.messages.length === 0"
              @click="assistantStore.switchTopic()"
            >换话题</button>
            <span class="text-zinc-300 select-none">·</span>
            <button
              class="px-2 py-1 text-sm text-zinc-500 hover:text-zinc-700 rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="清空对话"
              :disabled="assistantStore.sending || assistantStore.messages.length === 0"
              @click="assistantStore.reset()"
            >重新开始</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
