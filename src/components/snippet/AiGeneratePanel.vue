<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { generateCode, isAbortError } from '@/api/ai'
import AppIcon from '@/components/ui/AppIcon.vue'
import LanguageSelect from '@/components/ui/LanguageSelect.vue'

const emit = defineEmits<{
  close: []
  generating: []
  stream: [text: string]
  apply: [payload: { language: string }]
  discard: []
}>()

const languages = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C', 'C++', 'C#', 'HTML', 'CSS', 'SQL', 'Shell', 'Go', 'Rust', 'PHP', 'Ruby', 'Swift', 'R', 'Kotlin', 'Vue', 'React', 'JSON', 'YAML', 'Markdown', 'Other']

const description = ref('')
// 语言与页面顶部的语言选择双向绑定（defineModel），保证生成代码填入编辑器后 Monaco 语法高亮与顶部一致
const language = defineModel<string>('language', { default: 'JavaScript' })
const generating = ref(false)
const error = ref('')
const done = ref(false)
let abortCtrl: AbortController | null = null

async function generate(isRestart = false) {
  if (!description.value.trim() || generating.value) return

  error.value = ''
  done.value = false
  if (!isRestart) emit('generating')

  const ctrl = new AbortController()
  abortCtrl = ctrl
  generating.value = true
  let text = ''

  try {
    const result = await generateCode(description.value.trim(), language.value, {
      signal: ctrl.signal,
      onChunk: (chunk) => {
        text += chunk
        emit('stream', text)
      }
    })
    if (!result && !text.trim()) {
      error.value = 'AI 没有生成内容，请调整描述后重试'
    } else if (text.trim()) {
      done.value = true
    }
  } catch (err) {
    if (!isAbortError(err)) {
      error.value = err instanceof Error ? err.message : '请求失败，请重试'
    }
  } finally {
    generating.value = false
    abortCtrl = null
  }
}

function stopGenerate() {
  abortCtrl?.abort()
}

function apply() {
  if (!done.value) return
  emit('apply', { language: language.value })
}

// 放弃生成结果：清空描述并复位面板，通知父组件恢复生成前的编辑器内容
function discard() {
  description.value = ''
  done.value = false
  emit('discard')
}

// 重新生成：基于当前描述与语言再跑一次，新结果流式覆盖编辑器。
// 不重复 emit('generating')，父组件暂存的仍是「首次生成前」的内容，放弃可回到最初
function restart() {
  generate(true)
}

onUnmounted(() => {
  abortCtrl?.abort()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden rounded-xl ring-1 ring-zinc-300/70 bg-white shadow-sm">
    <div class="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
      <h3 class="text-sm font-semibold text-zinc-800">AI 生成代码</h3>
      <button
        class="p-1.5 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 rounded transition-colors cursor-pointer"
        title="关闭"
        @click="emit('close')"
      ><AppIcon name="x" :size="16" /></button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-3">
      <div>
        <label class="block text-xs text-zinc-500 mb-1">描述需求</label>
        <textarea
          v-model="description"
          rows="4"
          placeholder="例如：写一个防抖函数，支持取消"
          class="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white resize-none disabled:opacity-60"
          :disabled="generating"
        ></textarea>
      </div>

      <div class="flex items-center gap-2">
        <label class="shrink-0 text-xs text-zinc-500">语言</label>
        <LanguageSelect v-model="language" :languages="languages" class="flex-1" :disabled="generating" />
        <span v-if="done" class="shrink-0 text-xs text-zinc-400">待确认</span>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="generating"
          class="px-4 py-2 bg-zinc-200 text-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors cursor-pointer"
          @click="stopGenerate"
        >停止</button>
        <template v-else-if="done">
          <button
            class="px-4 py-2 bg-github-blue text-white rounded-lg text-sm font-medium hover:bg-github-blue-dark active:scale-[0.98] transition-all cursor-pointer"
            @click="apply"
          >应用到编辑器</button>
          <button
            class="px-4 py-2 bg-zinc-200 text-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors cursor-pointer"
            @click="restart"
          >重新生成</button>
          <button
            class="px-4 py-2 bg-zinc-200 text-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors cursor-pointer"
            @click="discard"
          >放弃</button>
        </template>
        <button
          v-else
          class="px-4 py-2 bg-github-blue text-white rounded-lg text-sm font-medium hover:bg-github-blue-dark active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
          :disabled="!description.trim()"
          @click="generate()"
        >生成</button>
        <p v-if="error" class="text-xs text-red-500 ml-1">{{ error }}</p>
      </div>

      <!-- 状态提示：生成结果已流式进编辑器，审阅后确认/放弃 -->
      <div
        v-if="done"
        class="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 leading-relaxed"
      >代码已生成到编辑器，可审阅或修改后确认；想换语言或重试直接点「重新生成」。</div>
      <div v-else-if="generating" class="text-xs text-zinc-500">正在生成，代码将实时填入编辑器…</div>
    </div>
  </div>
</template>
