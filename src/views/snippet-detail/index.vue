<!-- ════════════════════════════════════════════════════════
     views/snippet-detail/index.vue —— 详情页：阅读 + 复制/导出 + 字号调节 + 收藏 + AI 生成描述
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSnippetStore } from '@/stores/snippetStore'
import { downloadText, langToExt } from '@/services/file'
// Monaco 体积大（~4MB），异步加载：页面骨架先渲染，编辑器就绪后插入；加载中显示占位
import { useMonacoAsync } from '@/composables/useMonacoAsync'
import PageHeader from '@/components/global/layout/PageHeader.vue'
import FolderPicker from '@/components/business/folder/FolderPicker.vue'
import ConfirmDialog from '@/components/global/feedback/ConfirmDialog.vue'
import FontSizeControl from '@/components/global/form/FontSizeControl.vue'
import AppIcon from '@/components/global/base/AppIcon.vue'
import { formatFullTime } from '@/services/date'

const { MonacoEditor } = useMonacoAsync()

const route = useRoute()
const router = useRouter()
const snippetStore = useSnippetStore()

const snippet = computed(() =>
  snippetStore.snippets.find(s => s.id === route.params.id)
)

if (!snippet.value) {
  router.push('/')
}

// --- 收藏星（与列表卡片行为一致：点星弹 FolderPicker 勾选/取消所属夹）---
const isFavorited = computed(() => (snippet.value?.folderIds.length ?? 0) > 0)
const showPicker = ref(false)

// 创建/更新时间：未编辑过（两者相同）只显示创建，避免"创建于 X · 更新于 X"冗余
const timeMeta = computed(() => {
  if (!snippet.value) return ''
  const c = formatFullTime(snippet.value.createdAt)
  const u = formatFullTime(snippet.value.updatedAt)
  return c === u ? `创建于 ${c}` : `创建于 ${c} · 更新于 ${u}`
})

// --- 代码卡片高度随行数自适应：Monaco 行高 ≈ 字号 × 1.375，上下 padding 共 32px ---
const fontSize = ref(20)
const codeLines = computed(() => snippet.value?.code.split('\n').length ?? 1)
const editorHeight = computed(() => `${Math.max(codeLines.value * Math.round(fontSize.value * 1.375) + 32, 300)}px`)

// --- 所属收藏夹：详情页回显，点击跳转列表页按该夹筛选 ---
const snippetFolders = computed(() =>
  snippetStore.folders.filter(f => snippet.value?.folderIds.includes(f.id))
)
function goFolder(id: string) {
  snippetStore.setFilter('favorites', id)
  router.push('/')
}

// --- 复制代码：就地反馈，按钮短暂变"已复制" ---
// clipboard API 只在安全上下文（HTTPS/localhost）可用，非 HTTPS 环境降级 execCommand，保证任何环境都能复制
const copied = ref(false)

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
  return ok
}

async function copyCode() {
  if (!snippet.value) return
  let ok = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(snippet.value.code)
      ok = true
    }
  } catch {
    ok = false
  }
  if (!ok) ok = legacyCopy(snippet.value.code)
  if (ok) {
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  }
}

// --- 编辑 / 导出 / 删除（底部细操作栏）---
function exportCode() {
  if (!snippet.value) return
  downloadText(snippet.value.code, snippet.value.title, langToExt(snippet.value.language))
}

function goEdit() {
  if (!snippet.value) return
  router.push(`/snippet/${snippet.value.id}/edit`)
}

// 进入 AI 助手并以当前片段作为对话前提（?snippet=id，助手页预置结果消息）
function goAssistant() {
  if (!snippet.value) return
  router.push({ path: '/ai', query: { snippet: snippet.value.id } })
}

const showDeleteConfirm = ref(false)

function confirmDelete() {
  if (!snippet.value) return
  snippetStore.deleteSnippet(snippet.value.id)
  router.push('/')
}
</script>

<template>
  <div v-if="snippet" class="h-full flex flex-col bg-white">
    <!-- 顶栏：与首页 Header 同款样式大小（h-14 / border-zinc-200），只有品牌 + 返回 -->
    <PageHeader title="片段详情" />

    <!-- 内容流：整页滚动，代码卡片多高页面多高 -->
    <div class="flex-1 overflow-y-auto bg-zinc-100">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 py-6 pb-14">
        <!-- 标题行：标题 + 收藏星（语言/收藏夹/时间下沉到元信息行） -->
        <div class="flex items-center gap-3 mb-2">
          <h1 class="flex-1 min-w-0 text-2xl font-bold text-zinc-900 tracking-tight truncate">{{ snippet.title }}</h1>

          <div class="relative shrink-0 flex items-center">
            <button
              class="-m-1.5 p-2 rounded-full text-zinc-500 hover:text-github-blue hover:bg-github-blue-light transition-colors cursor-pointer"
              title="收藏"
              @click="showPicker = !showPicker"
            >
              <AppIcon name="star" :size="18" :filled="isFavorited" :class="isFavorited ? 'text-github-blue/70' : ''" />
            </button>
            <Transition name="pop">
              <FolderPicker
                v-if="showPicker"
                :snippet-id="snippet.id"
                @close="showPicker = false"
              />
            </Transition>
          </div>
        </div>

        <!-- 元信息行：语言标签 + 所属收藏夹（可点跳转筛选）+ 更新时间 -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-4">
          <span class="text-xs px-2 py-0.5 bg-github-blue-light text-github-blue-dark rounded font-medium">{{ snippet.language }}</span>
          <button
            v-for="f in snippetFolders"
            :key="f.id"
            class="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-zinc-200 text-zinc-700 hover:bg-zinc-300 rounded-full transition-colors cursor-pointer"
            title="查看该收藏夹中的片段"
            @click="goFolder(f.id)"
          >
            <AppIcon name="star" :size="10" :filled="true" class="text-github-blue/70" />
            {{ f.name }}
          </button>
          <span class="text-xs text-zinc-600 tabular-nums">{{ timeMeta }}</span>
        </div>

        <!-- 描述：人话背景（代码表达不了的用途/注意事项），为空时由 AI 生成/提供重试 -->
        <p v-if="snippet.description" class="mb-4 text-base text-zinc-600 leading-relaxed">{{ snippet.description }}</p>
        <div v-else-if="snippetStore.isGeneratingDescription(snippet.id)" class="mb-4 flex items-center gap-2 text-sm text-zinc-500">
          <span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-github-blue"></span>
          AI 正在生成描述…
        </div>
        <button
          v-else
          class="mb-4 text-xs text-zinc-500 hover:text-github-blue transition-colors cursor-pointer"
          title="让 AI 阅读代码并生成一句用途描述"
          @click="snippetStore.ensureDescription(snippet.id)"
        >AI 生成描述</button>

        <!-- 代码卡片（高度随代码行数自适应，无需内部滚动）；头栏 = 文件名 + 统计 + 复制/导出，右下角字号调节 -->
        <div class="relative bg-white ring-1 ring-zinc-300/70 rounded-xl shadow-sm overflow-hidden">
          <div class="flex items-center gap-3 border-b border-zinc-200 px-4 py-2">
            <span class="min-w-0 truncate font-mono text-sm text-zinc-700">{{ snippet.title }}</span>
            <span class="ml-auto shrink-0 text-xs text-zinc-500 tabular-nums">{{ codeLines }} 行 · {{ snippet.code.length }} 字符</span>
            <button
              class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
              title="复制代码"
              @click="copyCode"
            >
              <AppIcon v-if="copied" name="check" :size="13" class="text-github-blue" />
              {{ copied ? '已复制' : '复制' }}
            </button>
            <button
              class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors cursor-pointer"
              title="导出为文件"
              @click="exportCode"
            >导出</button>
          </div>
          <MonacoEditor :model-value="snippet.code" :language="snippet.language" readonly :font-size="fontSize" :frame="false" :padding-top="16" :height="editorHeight" />

          <!-- 字号调节（与编辑页同款交互，浮在编辑器右下角） -->
          <FontSizeControl v-model:size="fontSize" />
        </div>

      </div>
    </div>

    <!-- 底部操作栏：AI 助手（主·蓝实心）/ 编辑（次·灰底）/ 删除（危险·红底红字，与主页多选栏同款）三连 pill -->
    <div class="h-12 shrink-0 flex items-center justify-center gap-3 bg-white border-t border-zinc-200">
      <button
        class="inline-flex items-center px-4 py-1.5 text-sm bg-github-blue text-white rounded-lg font-medium hover:bg-github-blue-dark active:scale-[0.98] transition-all cursor-pointer shrink-0"
        title="进入 AI 助手，以当前片段为对话前提"
        @click="goAssistant"
      >AI 助手</button>
      <button
        class="inline-flex items-center px-3 py-1.5 text-sm text-zinc-800 bg-zinc-200 rounded-lg hover:bg-zinc-300 transition-colors cursor-pointer shrink-0"
        title="编辑片段"
        @click="goEdit"
      >编辑</button>
      <button
        class="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 bg-red-100 rounded-lg hover:bg-red-200 transition-colors cursor-pointer shrink-0"
        title="删除片段"
        @click="showDeleteConfirm = true"
      >删除</button>
    </div>

    <ConfirmDialog
      :show="showDeleteConfirm"
      title="删除片段"
      message="确定删除这个片段吗？删除后不可恢复。"
      confirm-text="删除"
      danger
      @cancel="showDeleteConfirm = false"
      @confirm="confirmDelete"
    />
  </div>
</template>
