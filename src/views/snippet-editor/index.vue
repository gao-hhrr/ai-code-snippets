<!-- ════════════════════════════════════════════════════════
     views/snippet-editor/index.vue —— 新建/编辑页：Monaco 编辑 + 草稿恢复
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSnippetStore } from '@/stores/snippetStore'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'
import { useDraft } from '@/composables/useDraft'
import { detectLanguage } from '@/services/file'
import { LANGUAGES } from '@/services/languages'
// Monaco 体积大（~4MB），异步加载：页面骨架先渲染，编辑器就绪后插入；加载中显示占位
import { useMonacoAsync } from '@/composables/useMonacoAsync'
import PageHeader from '@/components/global/layout/PageHeader.vue'
import LanguageSelect from '@/components/global/form/LanguageSelect.vue'
import ConfirmDialog from '@/components/global/feedback/ConfirmDialog.vue'
import FontSizeControl from '@/components/global/form/FontSizeControl.vue'

const { MonacoEditor } = useMonacoAsync()

const route = useRoute()
const router = useRouter()
const snippetStore = useSnippetStore()
const aiStore = useAiAssistantStore()

const isEdit = computed(() => route.name === 'snippet-edit')
const existing = computed(() =>
  isEdit.value ? snippetStore.snippets.find(s => s.id === route.params.id) : null
)

const languages = LANGUAGES

const title = ref(existing.value?.title || '')
const code = ref(existing.value?.code || '')
const language = ref(existing.value?.language || 'JavaScript')
const description = ref(existing.value?.description || '')
const saving = ref(false)
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)

// 代码字号（每次进入默认，不持久化）
const fontSize = ref(20)

// 草稿 + 未保存离开确认的逻辑在 composables/useDraft.ts（含 sessionStorage 读写与路由拦截）
const { isDirty, showConfirm, handleConfirmOk, handleConfirmCancel, markCleared } = useDraft({
  // 编辑页传片段 id；新增页为 null
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
  },
  // 确认离开编辑页后回传「未保存」（保存路径已回传 true，此对已保存场景是 no-op）。
  // 之前误写在 handleSave 里，只有点过保存才注册守卫 → 不保存直接离开时回传丢失，
  // AI 页卡片停在「已进入编辑页」，提示与实况不符且无入口重进。
  // from=ai（create 新建）与 from=ai-modify（modify 另存）分别回传给对应在途消息
  onConfirmedLeave: () => {
    if (route.query.from === 'ai') aiStore.resolveCreateFromEditor(false)
    else if (route.query.from === 'ai-modify') aiStore.resolveModifyFromEditor(false)
  }
})

const codeLineCount = computed(() => (code.value.trim() ? code.value.split('\n').length : 0))

// --- 文件上传（扩展名识别逻辑在 services/file.ts）---
function handleFileUpload() {
  fileInput.value?.click()
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploading.value = true
  try {
    const text = await file.text()

    // 点开头的隐藏文件（.env/.gitignore）去掉扩展名会变空串 → 兜底用原名，避免标题为空
    title.value = file.name.replace(/\.[^.]+$/, '') || file.name
    code.value = text
    language.value = detectLanguage(file.name)
  } catch {
    // 读取失败保持原内容，不覆盖已填的代码（静默处理，与 ensureDescription 一致）
  } finally {
    uploading.value = false
    input.value = ''
  }
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
  // 从 AI 助手进入：保存成功回传结果，AI 页卡片显示「已保存入库」+ 查看入口。
  // from=ai（create 新建）与 from=ai-modify（modify 另存）分别回传给对应在途消息
  if (route.query.from === 'ai') aiStore.resolveCreateFromEditor(true, savedId)
  else if (route.query.from === 'ai-modify') aiStore.resolveModifyFromEditor(true, savedId)
  // 描述留空 → 保存后 AI 异步生成（不阻塞跳转）
  if (!description.value.trim()) {
    snippetStore.ensureDescription(isEdit.value && existing.value ? existing.value.id : savedId)
  }
  // 从 AI 助手进入（?from=ai / from=ai-modify）：保存后用 back 回到栈里已有的 AI 页条目——
  // push('/ai') 会新增一条重复的 /ai，历史栈变成 [/ /ai /new /ai]，返回时在编辑页↔AI 页之间来回循环
  if (route.query.from === 'ai' || route.query.from === 'ai-modify') {
    if (window.history.state?.back) router.back()
    else router.push('/ai')
  } else {
    router.push('/')
  }
}
</script>

<template>
  <div class="h-full flex flex-col bg-white">
    <!-- 顶栏：与首页 Header 同款样式大小（h-14 / border-zinc-200），只有品牌 + 返回 -->
    <PageHeader :title="isEdit ? '编辑片段' : '新建片段'" />

    <!-- 轻量元数据表单：名称+语言一行、描述一行（GitHub issue 式），不占垂直空间 -->
    <div class="shrink-0 bg-white px-4 sm:px-6 pt-4 pb-3">
      <div class="mx-auto flex max-w-7xl items-center gap-3">
        <span class="shrink-0 text-sm text-zinc-500">名称</span>
        <input
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

    <!-- 编辑器主区：整体限宽居中（宽屏左右留白，代码行不过长） -->
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
            <FontSizeControl v-model:size="fontSize" />
          </div>
        </div>
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
      :message="route.query.from === 'ai' || route.query.from === 'ai-modify'
        ? 'AI 生成/修改的内容不会因离开而丢失——可稍后在 AI 对话卡片中重新进入编辑。确定离开吗？'
        : '有未保存的内容，确定要离开吗？离开后未保存的内容将丢失。'"
      confirm-text="离开"
      cancel-text="取消"
      danger
      @confirm="handleConfirmOk"
      @cancel="handleConfirmCancel"
    />
  </div>
</template>
