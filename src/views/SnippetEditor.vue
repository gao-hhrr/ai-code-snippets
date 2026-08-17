<script setup lang="ts">
import { ref, computed, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSnippetStore } from '@/stores/snippetStore'
import { useDraft } from '@/composables/useDraft'
import { useGoBack } from '@/composables/useGoBack'
import { detectLanguage } from '@/services/fileImport'
import BrandMark from '@/components/layout/BrandMark.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LanguageSelect from '@/components/ui/LanguageSelect.vue'
import MonacoLoading from '@/editor/MonacoLoading.vue'
// Monaco 体积大（~4MB），异步加载：页面骨架先渲染，编辑器就绪后插入；加载中显示占位
const MonacoEditor = defineAsyncComponent({
  loader: () => import('@/editor/MonacoEditor.vue'),
  loadingComponent: MonacoLoading,
  delay: 200
})
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import AiGeneratePanel from '@/components/snippet/AiGeneratePanel.vue'

const route = useRoute()
const router = useRouter()
const snippetStore = useSnippetStore()
const { goBack } = useGoBack()

const isEdit = computed(() => route.name === 'snippet-edit')
const existing = computed(() =>
  isEdit.value ? snippetStore.snippets.find(s => s.id === route.params.id) : null
)

const languages = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C', 'C++', 'C#', 'HTML', 'CSS', 'SQL', 'Shell', 'Go', 'Rust', 'PHP', 'Ruby', 'Swift', 'R', 'Kotlin', 'Vue', 'React', 'JSON', 'YAML', 'Markdown', 'Other']

const title = ref(existing.value?.title || '')
const code = ref(existing.value?.code || '')
const language = ref(existing.value?.language || 'JavaScript')
const description = ref(existing.value?.description || '')
const saving = ref(false)
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const showGenerate = ref(false)
const titleInputEl = ref<HTMLInputElement | null>(null)

// AI 生成结果确认：代码已流式填入编辑器，关闭面板；标题留空时引导用户命名
// （标题是搜索入口，由用户主动命名最稳，不做 AI 生成标题）
function handleAiApply() {
  showGenerate.value = false
  if (!title.value.trim()) {
    nextTick(() => titleInputEl.value?.focus())
  }
}

// AI 生成预览：生成前暂存编辑器内容（供「放弃」恢复），生成结果流式填入编辑器
const preAiCode = ref('')
function handleAiGenerating() {
  preAiCode.value = code.value
}
function handleAiStream(text: string) {
  code.value = text
}
function handleAiDiscard() {
  code.value = preAiCode.value
}

// 代码字号（每次进入默认，不持久化）
const fontSize = ref(20)

function changeFontSize(delta: number) {
  const next = Math.min(28, Math.max(14, fontSize.value + delta))
  fontSize.value = next
}

// 草稿 + 未保存离开确认的逻辑在 composables/useDraft.ts（含 sessionStorage 读写与路由拦截）
const { isDirty, showConfirm, handleConfirmOk, handleConfirmCancel, markCleared } = useDraft({
  id: existing.value?.id ?? null,
  title,
  code,
  language,
  description,
  baseline: {
    title: existing.value?.title || '',
    code: existing.value?.code || '',
    language: existing.value?.language || 'JavaScript',
    description: existing.value?.description || ''
  }
})

const codeLineCount = computed(() => (code.value.trim() ? code.value.split('\n').length : 0))

// --- 文件上传（扩展名识别逻辑在 services/fileImport.ts）---
function handleFileUpload() {
  fileInput.value?.click()
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploading.value = true
  const text = await file.text()

  title.value = file.name.replace(/\.[^.]+$/, '')
  code.value = text
  language.value = detectLanguage(file.name)

  uploading.value = false
  input.value = ''
}

function handleSave() {
  if (!title.value.trim() || !code.value.trim()) return

  saving.value = true

  const savedId = Date.now().toString()
  if (isEdit.value && existing.value) {
    snippetStore.updateSnippet(existing.value.id, {
      title: title.value,
      code: code.value,
      language: language.value,
      description: description.value
    })
  } else {
    snippetStore.addSnippet({
      id: savedId,
      title: title.value,
      code: code.value,
      language: language.value,
      description: description.value,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folderIds: []
    })
  }

  saving.value = false
  markCleared()
  // 描述留空 → 保存后 AI 异步生成（不阻塞跳转）
  if (!description.value.trim()) {
    snippetStore.ensureDescription(isEdit.value && existing.value ? existing.value.id : savedId)
  }
  router.push('/')
}
</script>

<template>
  <div class="h-full flex flex-col bg-white">
    <!-- 顶栏：与首页 Header 同款样式大小（h-14 / border-zinc-200），只有品牌 + 返回 -->
    <div class="h-14 shrink-0 flex items-center gap-3 px-4 sm:px-6 bg-white border-b border-zinc-200">
      <BrandMark />
      <button
        class="flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg px-2.5 py-1.5 -ml-1 transition-colors cursor-pointer shrink-0"
        title="返回"
        @click="goBack"
      ><AppIcon name="back" :size="15" /> 返回</button>
      <span class="ml-auto text-sm text-zinc-600">{{ isEdit ? '编辑片段' : '新建片段' }}</span>
    </div>

    <!-- 轻量元数据表单：名称+语言一行、描述一行（GitHub issue 式），不占垂直空间 -->
    <div class="shrink-0 bg-white px-4 sm:px-6 pt-4 pb-3">
      <div class="mx-auto flex max-w-7xl items-center gap-3">
        <span class="shrink-0 text-sm text-zinc-500">名称</span>
        <input
          ref="titleInputEl"
          v-model="title"
          type="text"
          placeholder="未命名片段"
          maxlength="50"
          class="plain-input flex-1 min-w-0 text-lg font-semibold text-zinc-900 bg-transparent placeholder-zinc-300"
        />
        <LanguageSelect v-model="language" :languages="languages" class="shrink-0" />
      </div>
      <div class="mx-auto mt-2 flex max-w-7xl items-center gap-3">
        <span class="shrink-0 text-sm text-zinc-500">描述</span>
        <input
          v-model="description"
          type="text"
          placeholder="留空保存后由 AI 自动生成，也可手动填写"
          maxlength="200"
          class="plain-input flex-1 min-w-0 py-1 text-sm text-zinc-700 bg-transparent placeholder-zinc-300"
        />
      </div>
    </div>

    <!-- 编辑器主区 + AI 生成抽屉：编辑器 + 抽屉整体限宽居中（宽屏左右留白，代码行不过长），面板打开时从右侧推开 -->
    <div class="relative min-h-0 flex-1 bg-zinc-100 px-4 py-3 sm:px-6 sm:py-4">
      <div class="mx-auto flex h-full max-w-7xl gap-3">
        <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl ring-1 ring-zinc-300/70 bg-white shadow-sm">
          <div class="relative min-h-0 flex-1">
            <MonacoEditor v-model="code" :language="language" :font-size="fontSize" :frame="false" :padding-top="16" height="100%" />

            <!-- 空代码占位提示 -->
            <div v-if="!code.trim()" class="pointer-events-none absolute inset-0 flex select-none items-center justify-center">
              <span class="text-base text-zinc-500">在这里输入或粘贴代码，或点底部「上传文件」</span>
            </div>

            <!-- 字号调节 -->
            <div class="absolute bottom-5 right-5 z-10 flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 shadow-md">
              <button
                class="text-sm text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded hover:bg-zinc-200 transition-colors cursor-pointer"
                title="减小字号"
                @click="changeFontSize(-1)"
              >A</button>
              <span class="w-8 text-center text-sm text-zinc-600 tabular-nums">{{ fontSize }}</span>
              <button
                class="text-xl text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded hover:bg-zinc-200 transition-colors cursor-pointer"
                title="增大字号"
                @click="changeFontSize(1)"
              >A</button>
            </div>
          </div>
        </div>

        <!-- AI 生成抽屉：与编辑器同高、可收起，真实占位不遮挡 -->
        <Transition name="fade">
          <AiGeneratePanel
            v-if="showGenerate"
            class="w-[360px] max-w-[45vw] shrink-0"
            v-model:language="language"
            @close="showGenerate = false"
            @generating="handleAiGenerating"
            @stream="handleAiStream"
            @apply="handleAiApply"
            @discard="handleAiDiscard"
          />
        </Transition>
      </div>
    </div>

    <!-- 底部操作栏：与编辑器同宽限宽居中，左侧状态信息，右侧上传 / 保存（保存为主按钮） -->
    <div class="h-12 shrink-0 flex items-center px-4 sm:px-6 bg-white border-t border-zinc-200">
      <div class="mx-auto flex w-full max-w-7xl items-center justify-between">
        <span class="flex items-center gap-3 text-sm text-zinc-600">
          <span>{{ language }}</span>
          <span class="tabular-nums">{{ codeLineCount }} 行 · {{ code.length }} 字符</span>
          <span v-if="isDirty" class="text-zinc-500">● 未保存</span>
        </span>

        <div class="flex items-center gap-2">
          <button
            class="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-800 bg-zinc-200 rounded-lg hover:bg-zinc-300 transition-colors cursor-pointer shrink-0"
            :class="showGenerate ? 'bg-zinc-300' : ''"
            title="AI 生成代码"
            @click="showGenerate = !showGenerate"
          >AI 生成</button>
          <button
            class="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-800 bg-zinc-200 rounded-lg hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
            :disabled="uploading"
            title="上传文件"
            @click="handleFileUpload"
          >{{ uploading ? '上传中...' : '上传文件' }}</button>

          <button
            class="px-5 py-1.5 text-sm bg-github-blue text-white rounded-lg font-medium hover:bg-github-blue-dark active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
            :disabled="saving || !title.trim() || !code.trim()"
            @click="handleSave"
          >{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".js,.ts,.jsx,.tsx,.vue,.css,.scss,.html,.py,.json,.sh,.md,.java,.go,.rs,.rb,.php,.yml,.yaml,.sql,.txt"
      class="hidden"
      @change="onFileSelected"
    />

    <ConfirmDialog
      :show="showConfirm"
      title="未保存的更改"
      message="有未保存的内容，确定要离开吗？离开后未保存的内容将丢失。"
      confirm-text="离开"
      cancel-text="取消"
      danger
      @confirm="handleConfirmOk"
      @cancel="handleConfirmCancel"
    />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
