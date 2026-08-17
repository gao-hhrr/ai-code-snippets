<script lang="ts">
// 显式声明组件名：App.vue 的 KeepAlive :include 按名字匹配，显式声明比依赖文件名推断更可靠
export default { name: 'AiAssistantPage' }
</script>

<script setup lang="ts">
import { ref, watch, computed, nextTick, reactive, onMounted, onActivated, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'
import { useSnippetStore } from '@/stores/snippetStore'
import { useGoBack } from '@/composables/useGoBack'
import type { Snippet } from '@/types'
import type { AssistantTurnMessage } from '@/api/ai'
import MarkdownText from '@/components/common/MarkdownText.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BrandMark from '@/components/layout/BrandMark.vue'
import DiffView from '@/editor/DiffView.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

const assistantStore = useAiAssistantStore()
const snippetStore = useSnippetStore()
const router = useRouter()
const route = useRoute()
const { goBack } = useGoBack()
const input = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const showDetail = ref(false)

// 等待期四步阶段指示（分析请求→梳理信息→解读意图→构思回应），由 store 的 phase 状态机驱动。
// 完成=蓝勾 / 进行中=蓝点 / 未到=灰；纯前端流程状态，不依赖模型输出
const PHASES = ['分析请求', '梳理信息', '解读意图', '构思回应']
function phaseState(i: number): 'done' | 'active' | 'todo' {
  const p = assistantStore.phase
  if (p === 'retrieve') return i === 0 ? 'done' : i === 1 ? 'active' : 'todo'
  if (p === 'analyze') return i < 2 ? 'done' : i === 2 ? 'active' : 'todo'
  if (p === 'compose') return i < 3 ? 'done' : 'active'
  return 'todo'
}

// 进入页面聚焦输入框 + 处理 ?snippet 预置。在 onMounted 与 onActivated 都调用：
// KeepAlive 缓存时每次重新进入走 onActivated；未缓存重挂载时走 onMounted（重复执行无害，seedContext 幂等）
function prepareEntry() {
  inputEl.value?.focus()
  // 从详情页进入：把该片段预置为对话前提（结果消息），召回机制天然继承，可直接说"改成 xx"。
  // 不去判 messages 是否为空：即使已有旧对话，也从新片段详情页进来 = 切换上下文（seedContext 内部替换旧种子）
  const preId = typeof route.query.snippet === 'string' ? route.query.snippet : undefined
  if (preId) {
    const s = snippetStore.snippets.find(x => x.id === preId)
    if (s) {
      assistantStore.seedContext([preId], '已在详情页定位到该片段，可以围绕它提问、修改，或继续查找。')
    }
  }
}
// 滚动位置存 sessionStorage（与编辑器草稿同策略）：返回/刷新不丢，关标签页自动清。
// 保存点必须挂在 listEl 的 scroll 事件上：KeepAlive 失活时节点已先被移进隐藏容器，
// onDeactivated 里读 scrollTop 恒为 0，会把真实值覆盖掉（此前刷新能用是 beforeunload 时机 DOM 还在）。
// scroll 事件触发时元素仍在文档内，值可靠；恢复只在进入页面时做
const SCROLL_KEY = 'code-snippets:ai-scroll'
function saveScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(listEl.value?.scrollTop ?? 0))
  } catch { /* 忽略存储失败 */ }
}
function restoreScroll() {
  let top = 0
  try { top = Number(sessionStorage.getItem(SCROLL_KEY) || 0) } catch { /* 忽略 */ }
  if (top > 0) {
    // nextTick + rAF 等布局稳定后再定位，避免内容未渲染完导致 scrollTo 失效
    nextTick(() => {
      requestAnimationFrame(() => {
        listEl.value?.scrollTo({ top })
      })
    })
  }
}
onMounted(() => {
  prepareEntry()
  restoreScroll()
  listEl.value?.addEventListener('scroll', saveScroll)
})
onActivated(() => {
  prepareEntry()
  restoreScroll()
})
onBeforeUnmount(() => {
  listEl.value?.removeEventListener('scroll', saveScroll)
})

// AI 修改的"替换原代码"二次确认（覆盖现有内容不可逆，弹框确认后才落库）
const replaceTarget = ref<AssistantTurnMessage | null>(null)
function confirmReplace(msg: AssistantTurnMessage) {
  replaceTarget.value = msg
}
function doReplace() {
  if (replaceTarget.value) assistantStore.replaceModify(replaceTarget.value)
  replaceTarget.value = null
}

// AI 库结构操作的确认卡：确认执行 / 取消；删除不可逆，再弹一道 ConfirmDialog 双重确认
const OP_LABEL: Record<string, string> = {
  delete: 'AI 提议删除片段',
  rename: 'AI 提议重命名片段',
  export: 'AI 提议导出片段',
  favorite: 'AI 提议收藏片段',
  unfavorite: 'AI 提议取消收藏',
  create: 'AI 提议新建片段',
  clear: 'AI 提议清空片段库',
  createFolder: 'AI 提议新建收藏夹',
  renameFolder: 'AI 提议重命名收藏夹',
  deleteFolder: 'AI 提议删除收藏夹',
  clearFolder: 'AI 提议清空收藏夹',
  meta: 'AI 提议修改片段'
}
function operateTitle(msg: AssistantTurnMessage) {
  if (msg.operateState === 'running') return 'AI 正在生成代码'
  if (msg.operateState === 'executed') return '操作已完成'
  if (msg.operateState === 'cancelled') return '操作已取消'
  if (msg.operateState === 'error') return '操作失败'
  return OP_LABEL[msg.operateOp ?? ''] ?? 'AI 提议操作'
}
function operateDesc(msg: AssistantTurnMessage) {
  const title = msg.targetTitle || '该片段'
  // 批量操作（delete/favorite/unfavorite）列出目标片段清单，让用户确认对象
  const list = resultSnippets(msg.searchIds ?? [])
  const listLines = list.length > 1 ? '\n· ' + list.map(s => s.title).join('\n· ') : ''
  switch (msg.operateOp) {
    case 'delete':
      return list.length > 1
        ? `将删除以下 ${list.length} 个片段，删除后不可恢复：${listLines}`
        : `将删除片段「${title}」，删除后不可恢复。`
    case 'rename': return `将把片段「${title}」重命名为「${msg.operateValue}」。`
    case 'export': return `将导出片段「${title}」。`
    case 'favorite':
      return list.length > 1
        ? `将把以下 ${list.length} 个片段收藏到「${msg.operateValue}」：${listLines}`
        : `将把片段「${title}」收藏到「${msg.operateValue}」。`
    case 'unfavorite':
      return list.length > 1
        ? `将把以下 ${list.length} 个片段移出「${msg.operateValue}」：${listLines}`
        : `将把片段「${title}」移出「${msg.operateValue}」。`
    case 'create': return `将新建片段「${msg.operateValue || '未命名'}」（${msg.createdLanguage || 'text'}），确认后存入代码库。`
    case 'clear': return `将删除全部 ${snippetStore.snippets.length} 个片段，不可恢复。`
    case 'createFolder': return `将新建收藏夹「${msg.operateValue}」。`
    case 'renameFolder': return `将把收藏夹「${msg.operateTarget}」改名为「${msg.operateValue}」。`
    case 'deleteFolder': return `将删除收藏夹「${msg.operateValue}」，片段不会被删除，只是移出该夹。`
    case 'clearFolder': return `将清空收藏夹「${msg.operateValue}」，只移出该夹，片段不会被删除。`
    case 'meta': return `将把片段「${title}」的${msg.operateField === 'language' ? '语言' : '描述'}改为「${msg.operateValue}」。`
    default: return ''
  }
}
// 危险/不可逆操作：确认卡用红色警示，其余普通操作走中性蓝
const DANGER_OPS = ['delete', 'clear', 'deleteFolder']
function isDangerOperate(op?: string): boolean {
  return !!op && DANGER_OPS.includes(op)
}
const confirmOpTarget = ref<AssistantTurnMessage | null>(null)
function confirmOperateAction(msg: AssistantTurnMessage) {
  // 删除 / 清空 / 删除收藏夹不可逆，确认卡后再弹一道确认框双重确认
  if (msg.operateOp === 'delete' || msg.operateOp === 'clear' || msg.operateOp === 'deleteFolder') {
    confirmOpTarget.value = msg
  } else {
    assistantStore.confirmOperate(msg)
  }
}
function doOperate() {
  if (confirmOpTarget.value) assistantStore.confirmOperate(confirmOpTarget.value)
  confirmOpTarget.value = null
}
// 双重确认对话框文案按操作分支：清空片段库 / 删除收藏夹 / 删除片段
const confirmOpDialog = computed(() => {
  const op = confirmOpTarget.value?.operateOp
  if (op === 'clear') {
    return { title: '清空片段库', message: `将删除全部 ${snippetStore.snippets.length} 个片段，此操作不可恢复。确认清空吗？`, confirmText: '清空' }
  }
  if (op === 'deleteFolder') {
    return { title: '删除收藏夹', message: `将删除收藏夹「${confirmOpTarget.value?.operateValue}」，片段不会被删除，只是移出该夹。确认删除吗？`, confirmText: '删除' }
  }
  const n = confirmOpTarget.value?.searchIds?.length || 0
  return {
    title: '删除片段',
    message: n > 1 ? `AI 将删除选中的 ${n} 个片段，删除后不可恢复。确认删除吗？` : 'AI 将删除该片段，删除后不可恢复。确认删除吗？',
    confirmText: '删除'
  }
})
// 结果消息的思考过程展开状态（按消息索引，默认收起）
const expandedReasoning = reactive(new Set<number>())
function toggleReasoning(i: number) {
  if (expandedReasoning.has(i)) expandedReasoning.delete(i)
  else expandedReasoning.add(i)
}

const reachedLimit = () => assistantStore.messages.filter(m => m.role === 'user').length >= 16

const errorDetail = computed(() => {
  const e = assistantStore.error
  if (!e) return ''
  const parts = [e.code || '未知错误']
  if (e.status) parts.push(`HTTP ${e.status}`)
  if (e.detail) parts.push(e.detail)
  return parts.join('\n')
})

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

function openSnippet(id: string) {
  router.push(`/snippet/${id}`)
}

// 语言色点：GitHub 语言色（未收录的落灰 #8b949e）
const LANG_COLORS: Record<string, string> = {
  javascript: '#f1e05a', typescript: '#3178c6', python: '#3572A5', css: '#563d7c',
  html: '#e34c26', vue: '#41b883', json: '#8e8e8e', java: '#b07219', go: '#00ADD8',
  rust: '#dea584', c: '#555555', cpp: '#f34b7d', csharp: '#178600', sql: '#e38c00',
  shell: '#89e051', bash: '#89e051', markdown: '#083fa1', yaml: '#cb171e'
}
function langColor(language: string): string {
  return LANG_COLORS[language.toLowerCase()] || '#8b949e'
}

// 结果卡代码预览：最多 4 行 / 160 字符，超长加省略号——让"代码可见"而不是只给标题
function previewLines(code: string): string {
  const t = code.split('\n').slice(0, 4).join('\n').trimEnd()
  return t.length > 160 ? t.slice(0, 160) + '…' : (t || '—')
}

// 思考总结展示规整：模型偶发省略换行/漏编号，把 ①②③④ 标记统一独立成行，避免多步挤在一行
function fmtSummary(text: string): string {
  return text.replace(/(?<!\n)(?=[①②③④])/g, '\n').replace(/^\n/, '').trim()
}

// 按 AI 返回顺序取片段（snippetStore.snippets 是库内顺序，不能直接用）
function resultSnippets(ids: string[]): Snippet[] {
  const map = new Map(snippetStore.snippets.map(s => [s.id, s]))
  return ids.map(id => map.get(id)).filter((s): s is Snippet => !!s)
}

// 新消息/发送中自动滚到底部
watch(
  () => [assistantStore.messages.length, assistantStore.sending] as const,
  async () => {
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
  }
)

</script>

<template>
  <div class="relative h-screen flex flex-col bg-zinc-50">
    <!-- 顶栏：返回 + 标题 + 对话操作 -->
    <header class="h-14 shrink-0 bg-white border-b border-zinc-200 flex items-center gap-3 px-4 sm:px-6">
      <BrandMark />
      <button
        class="flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg px-2.5 py-1.5 -ml-1 transition-colors cursor-pointer shrink-0"
        title="返回"
        @click="goBack"
      ><AppIcon name="back" :size="15" /> 返回</button>
      <span class="ml-auto text-sm text-zinc-600 hidden lg:block">对话式管理你的代码片段库</span>
    </header>

    <!-- 内容区：flex-1 占满到底，底部留白让最后一条消息能滚到浮空输入框上方 -->
    <div ref="listEl" class="relative flex-1 overflow-y-auto">
      <div class="mx-auto max-w-[880px] px-4 sm:px-6 pt-6 sm:pt-8 pb-52 min-h-full">
        <!-- 空态：absolute inset-0 铺满滚动区再居中（min-h-full 百分比在 flex+overflow 下失效，
             欢迎语会停顶部；inset-0 以 padding box 为基准，可靠）；发送后切换为对话流 -->
        <div v-if="assistantStore.messages.length === 0" class="absolute inset-0 flex flex-col items-center justify-center text-center space-y-2 select-none">
          <p class="text-2xl font-semibold text-zinc-800">你好，我是你的代码助手</p>
          <p class="text-base text-zinc-400">查找、总结、修改代码，还能帮你整理代码库</p>
        </div>

        <!-- 对话流 -->
        <template v-else>
          <div class="space-y-5">
            <template v-for="(msg, i) in assistantStore.messages" :key="i">
              <!-- 换话题分割线（不计入轮数，不进 prompt） -->
              <div v-if="msg.divider" class="flex items-center gap-2 text-sm text-zinc-400 my-1 select-none">
                <span class="flex-1 border-t border-zinc-200"></span>
                <span>新话题</span>
                <span class="flex-1 border-t border-zinc-200"></span>
              </div>
              <!-- 用户消息：右侧蓝色气泡（豆包式） -->
              <div v-else-if="msg.role === 'user'" class="flex justify-end">
                <div class="max-w-[85%] px-5 py-3 rounded-2xl rounded-br-md bg-github-blue text-white text-base whitespace-pre-wrap break-words">{{ msg.content }}</div>
              </div>
              <!-- 助手消息：左侧浅灰气泡（豆包式）；结果卡在气泡外整宽，代码卡不挤 -->
              <div v-else class="space-y-2.5">
                <div
                  v-if="msg.note || msg.content"
                  class="max-w-[85%] px-5 py-3 rounded-2xl rounded-bl-md bg-zinc-100 text-base text-zinc-800 leading-relaxed space-y-1"
                >
                  <div v-if="msg.note" class="text-[15px] text-zinc-500">{{ msg.note }}</div>
                  <div v-if="msg.content"><MarkdownText :text="msg.content" size="text-base" /></div>
                </div>
                <!-- 片段大卡：语言色点 + 标题 + AI 描述 + 代码预览，让代码可见 -->
                <div v-if="msg.searchIds && msg.searchIds.length > 0" class="space-y-2.5">
                  <div
                    v-for="s in resultSnippets(msg.searchIds)"
                    :key="s.id"
                    class="group bg-white border border-zinc-200 rounded-xl px-5 py-4 cursor-pointer hover:border-github-blue/60 hover:shadow-sm transition-all"
                    @click="openSnippet(s.id)"
                  >
                    <div class="flex items-center gap-2.5">
                      <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: langColor(s.language) }" />
                      <span class="text-sm font-medium text-zinc-500 shrink-0">{{ s.language }}</span>
                      <span class="text-[17px] font-semibold text-zinc-900 truncate flex-1">{{ s.title }}</span>
                      <span class="text-sm text-github-blue shrink-0 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">打开 →</span>
                    </div>
                    <p v-if="s.description" class="text-[15px] text-zinc-500 mt-1.5 line-clamp-2">{{ s.description }}</p>
                    <pre v-if="s.code" class="mt-2.5 rounded-md bg-zinc-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-600 overflow-hidden whitespace-pre font-mono">{{ previewLines(s.code) }}</pre>
                  </div>
                </div>
                <!-- AI 修改卡：改写中 / 失败 / 结果 diff + 二次确认。AI 只给建议，落库需用户确认 -->
                <div
                  v-if="msg.modifyState"
                  class="rounded-xl border overflow-hidden"
                  :class="msg.modifyState === 'done' ? 'border-github-blue/30' : 'border-zinc-200'"
                >
                  <div
                    class="flex items-center gap-2 px-4 py-2.5 border-b"
                    :class="msg.modifyState === 'done' ? 'bg-github-blue-light/60 border-github-blue/20' : 'bg-zinc-50 border-zinc-200'"
                  >
                    <span
                      class="inline-block w-2 h-2 rounded-full shrink-0"
                      :class="msg.modifyState === 'running' ? 'bg-github-blue animate-pulse' : msg.modifyState === 'error' ? 'bg-red-500' : 'bg-github-blue'"
                    ></span>
                    <span
                      class="text-sm font-medium"
                      :class="msg.modifyState === 'done' ? 'text-github-blue-dark' : msg.modifyState === 'error' ? 'text-red-500' : 'text-zinc-600'"
                    >
                      {{ msg.modifyState === 'running' ? 'AI 正在改写代码' : msg.modifyState === 'error' ? '修改未能完成' : 'AI 建议的改动' }}
                    </span>
                  </div>
                  <div class="p-4">
                    <!-- 改写中 -->
                    <div v-if="msg.modifyState === 'running'" class="flex items-center gap-2 text-sm text-zinc-500">
                      <span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-github-blue border-t-transparent animate-spin"></span>
                      正在根据需求生成修改后的代码…
                    </div>
                    <!-- 失败 -->
                    <p v-else-if="msg.modifyState === 'error'" class="text-sm text-red-500">{{ msg.content }}</p>
                    <!-- 完成：AI 提醒 + diff + 确认操作 -->
                    <template v-else-if="msg.modifyState === 'done' && msg.modifiedCode">
                      <p class="text-sm text-zinc-600 mb-3">{{ msg.note || '请确认以下改动，确认后才写入你的代码库。' }}</p>
                      <DiffView :original="resultSnippets(msg.searchIds ?? [])[0]?.code ?? ''" :modified="msg.modifiedCode" />
                      <div class="mt-3 flex flex-wrap gap-3">
                        <button
                          class="inline-flex items-center gap-1.5 px-4 py-2 bg-github-blue text-white rounded-lg text-sm font-medium hover:bg-github-blue-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          :disabled="msg.modifyApplied"
                          @click="assistantStore.saveModifyAsNew(msg)"
                        >保存为新片段</button>
                        <button
                          class="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-200 text-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          :disabled="msg.modifyApplied"
                          title="覆盖原代码，操作前会再次确认"
                          @click="confirmReplace(msg)"
                        >替换原代码</button>
                        <button
                          class="inline-flex items-center gap-1.5 px-4 py-2 text-github-blue bg-github-blue-light rounded-lg text-sm hover:bg-github-blue-light-hover transition-colors cursor-pointer"
                          @click="assistantStore.exportModify(msg)"
                        >导出</button>
                      </div>
                      <p v-if="msg.modifyApplied" class="text-xs text-github-blue mt-2">已应用到代码库</p>
                    </template>
                  </div>
                </div>
                <!-- AI 库操作确认卡：AI 提议删除/重命名/收藏/导出，用户确认后才执行 -->
                <div
                  v-if="msg.operateState"
                  class="rounded-xl border overflow-hidden"
                  :class="msg.operateState === 'pending' ? (isDangerOperate(msg.operateOp) ? 'border-red-200' : 'border-github-blue/30') : 'border-zinc-200'"
                >
                  <div
                    class="flex items-center gap-2 px-4 py-2.5 border-b"
                    :class="msg.operateState === 'pending'
                      ? (isDangerOperate(msg.operateOp) ? 'bg-red-50 border-red-100' : 'bg-github-blue-light/60 border-github-blue/20')
                      : 'bg-zinc-50 border-zinc-200'"
                  >
                    <span
                      class="inline-block w-2 h-2 rounded-full shrink-0"
                      :class="msg.operateState === 'pending'
                        ? (isDangerOperate(msg.operateOp) ? 'bg-red-500 animate-pulse' : 'bg-github-blue animate-pulse')
                        : msg.operateState === 'running' ? 'bg-github-blue animate-pulse' : msg.operateState === 'error' ? 'bg-red-500' : 'bg-zinc-400'"
                    ></span>
                    <span
                      class="text-sm font-medium"
                      :class="msg.operateState === 'pending'
                        ? (isDangerOperate(msg.operateOp) ? 'text-red-600' : 'text-github-blue-dark')
                        : msg.operateState === 'error' ? 'text-red-500' : 'text-zinc-600'"
                    >{{ operateTitle(msg) }}</span>
                  </div>
                  <div class="p-4">
                    <!-- create 生成代码中 -->
                    <div v-if="msg.operateState === 'running'" class="flex items-center gap-2 text-sm text-zinc-500">
                      <span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-github-blue border-t-transparent animate-spin"></span>
                      正在根据需求生成代码…
                    </div>
                    <template v-else-if="msg.operateState === 'pending'">
                      <p class="text-sm text-zinc-600 mb-3">{{ msg.note || '以下操作将改动你的代码库，请确认后再执行。' }}</p>
                      <p class="text-sm text-zinc-800 bg-zinc-50 rounded-lg px-3 py-2 mb-3 whitespace-pre-wrap break-words">{{ operateDesc(msg) }}</p>
                      <!-- create：生成代码预览，让用户确认内容 -->
                      <pre
                        v-if="msg.operateOp === 'create' && msg.createdCode"
                        class="mb-3 rounded-md bg-zinc-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-600 overflow-hidden whitespace-pre font-mono"
                      >{{ previewLines(msg.createdCode) }}</pre>
                      <div class="flex flex-wrap gap-3">
                        <button
                          class="inline-flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                          :class="isDangerOperate(msg.operateOp) ? 'bg-red-500 hover:bg-red-600' : 'bg-github-blue hover:bg-github-blue-dark'"
                          @click="confirmOperateAction(msg)"
                        >确认执行</button>
                        <button
                          class="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-200 text-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors cursor-pointer"
                          @click="assistantStore.cancelOperate(msg)"
                        >取消</button>
                      </div>
                    </template>
                    <p v-else-if="msg.operateState === 'executed'" class="text-sm text-github-blue">已执行</p>
                    <p v-else-if="msg.operateState === 'cancelled'" class="text-sm text-zinc-400">已取消</p>
                    <p v-else-if="msg.operateState === 'error'" class="text-sm text-red-500">{{ msg.content }}</p>
                  </div>
                </div>
                <!-- 思考过程：折叠面板，结果出来后默认收起；有四步总结显示总结，缺失则兜底展示原文 -->
                <div v-if="msg.thinkingSummary || msg.reasoning">
                  <button
                    class="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer"
                    @click="toggleReasoning(i)"
                  >AI 思考过程总结{{ expandedReasoning.has(i) ? '（收起）' : '' }}</button>
                  <div v-if="expandedReasoning.has(i)" class="mt-1.5 p-2.5 rounded-md bg-zinc-50 space-y-2">
                    <template v-if="msg.thinkingSummary">
                      <div class="text-sm text-zinc-500 whitespace-pre-wrap break-words leading-relaxed">{{ fmtSummary(msg.thinkingSummary) }}</div>
                    </template>
                    <div v-else class="text-sm text-zinc-400 whitespace-pre-wrap break-words leading-relaxed max-h-56 overflow-y-auto">{{ msg.reasoning }}</div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 等待回复：四步阶段指示（分析请求→梳理信息→解读意图→构思回应）+ 流式思考尾部窗口；503 退避单独提示 -->
            <div v-if="assistantStore.sending" class="flex justify-start">
              <div class="max-w-[85%] px-5 py-3 rounded-2xl rounded-bl-md bg-zinc-100 text-base text-zinc-500 space-y-2.5">
                <div v-if="assistantStore.retrying">服务器繁忙，自动重试中…</div>
                <template v-else>
                  <!-- 阶段进度：完成=蓝勾，进行中=蓝点脉冲，未到=灰 -->
                  <div class="flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      v-for="(label, i) in PHASES"
                      :key="label"
                      class="flex items-center gap-1 px-2 py-1 rounded-full transition-colors"
                      :class="phaseState(i) === 'todo' ? 'text-zinc-400' : 'text-github-blue'"
                    >
                      <span
                        class="flex items-center justify-center w-4 h-4 rounded-full shrink-0"
                        :class="phaseState(i) === 'done'
                          ? 'bg-github-blue border border-github-blue'
                          : phaseState(i) === 'active'
                            ? 'border border-github-blue'
                            : 'border border-zinc-300'"
                      >
                        <AppIcon v-if="phaseState(i) === 'done'" name="check" :size="10" class="text-white" />
                        <span v-else-if="phaseState(i) === 'active'" class="w-1.5 h-1.5 rounded-full bg-github-blue animate-pulse"></span>
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
          </div>
        </template>
      </div>
    </div>

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
    <!-- AI 修改的"替换原代码"二次确认：覆盖原代码不可逆，确认后才落库 -->
    <ConfirmDialog
      :show="!!replaceTarget"
      title="替换原代码"
      message="AI 将覆盖该片段的原代码，替换后原代码不可恢复。确认替换吗？"
      confirm-text="替换"
      danger
      @cancel="replaceTarget = null"
      @confirm="doReplace"
    />
    <!-- AI 提议删除/清空/删除收藏夹的双重确认：不可逆操作，确认卡上再弹一道 -->
    <ConfirmDialog
      :show="!!confirmOpTarget"
      :title="confirmOpDialog.title"
      :message="confirmOpDialog.message"
      :confirm-text="confirmOpDialog.confirmText"
      danger
      @cancel="confirmOpTarget = null"
      @confirm="doOperate"
    />
  </div>
</template>
