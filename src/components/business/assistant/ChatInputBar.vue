<!-- ════════════════════════════════════════════════════════
     ChatInputBar —— AI 助手底部输入区：错误提示+重试+详情展开、输入框+发送/停止、换话题/重新开始
     直接用 store；输入聚焦由页面经模板 ref 调 focusInput() 接管（返回/重新激活时自动聚焦）
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'

const assistantStore = useAiAssistantStore()
const input = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const showDetail = ref(false)

// 错误详情拼接：错误码 / HTTP 状态 / 响应片段，供「详情」展开调试定位
function formatErrorDetail(e: { code?: string; status?: number; detail?: string } | null): string {
  if (!e) return ''
  const parts = [e.code || '未知错误']
  if (e.status) parts.push(`HTTP ${e.status}`)
  if (e.detail) parts.push(e.detail)
  return parts.join('\n')
}
const errorDetail = computed(() => formatErrorDetail(assistantStore.error))

// 对话轮数上限：只数 user 消息，达到后禁用输入并提示开启新对话
const reachedLimit = () => assistantStore.messages.filter(m => m.role === 'user').length >= assistantStore.MAX_TURNS

function send(text = input.value) {
  const q = text.trim()
  if (!q || assistantStore.sending || reachedLimit()) return
  assistantStore.send(q)
  input.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
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
          <div v-if="assistantStore.error" class="text-xs text-red-500 mb-2 space-y-1">
            <div class="flex items-start justify-between gap-2">
              <span class="min-w-0 break-words">{{ assistantStore.error.text }}</span>
              <button
                v-if="assistantStore.lastUserText && !reachedLimit()"
                class="shrink-0 px-2 py-1 text-xs text-github-blue border border-github-blue/40 rounded-md hover:bg-github-blue-light transition-colors cursor-pointer"
                @click="assistantStore.retry()"
              >重试</button>
            </div>
            <!-- 技术详情：错误码/HTTP 状态/响应片段，默认收起，调试时展开定位 -->
            <div v-if="assistantStore.error.code || assistantStore.error.detail" class="flex flex-col gap-1">
              <button class="self-start text-zinc-400 hover:text-zinc-600 cursor-pointer" @click="showDetail = !showDetail">
                {{ showDetail ? '收起详情' : '详情' }}
              </button>
              <pre v-if="showDetail" class="whitespace-pre-wrap break-all text-zinc-400 leading-relaxed">{{ errorDetail }}</pre>
            </div>
          </div>
          <div v-else-if="reachedLimit()" class="text-xs text-zinc-500 mb-2">对话已达上限，点击「重新开始」开启新对话</div>
          <div
            class="flex items-center gap-2 bg-white border border-zinc-300 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.07)] pl-5 pr-2 py-2.5"
          >
            <input
              ref="inputEl"
              v-model="input"
              type="text"
              maxlength="100"
              :placeholder="assistantStore.messages.length > 0 ? '继续问我你存过的代码…' : '问我你存过的代码…'"
              :disabled="reachedLimit()"
              class="plain-input flex-1 min-w-0 bg-transparent text-base text-zinc-800 placeholder:text-zinc-400 outline-none disabled:opacity-50"
              @keydown="onKeydown"
            />
            <button
              :disabled="(!input.trim() && !assistantStore.sending) || reachedLimit()"
              :class="assistantStore.sending ? 'bg-red-500 hover:bg-red-600' : 'bg-github-blue hover:bg-github-blue-dark'"
              class="shrink-0 px-5 h-11 text-base text-white font-medium rounded-full active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              @click="assistantStore.sending ? assistantStore.stop() : send()"
            >{{ assistantStore.sending ? '停止' : '发送' }}</button>
          </div>
          <div class="flex items-center justify-center gap-2 mt-2.5">
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
