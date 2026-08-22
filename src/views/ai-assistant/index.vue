<!-- ════════════════════════════════════════════════════════
     views/ai-assistant/index.vue —— AI 助手页：对话式检索 + 5 工具库操作确认执行（KeepAlive 按组件名缓存）
     ════════════════════════════════════════════════════════ -->
<script lang="ts">
// 显式声明组件名：App.vue 的 KeepAlive :include 按名字匹配，显式声明比依赖文件名推断更可靠
export default { name: 'AiAssistantPage' }
</script>

<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onActivated, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'
import { useSnippetStore } from '@/stores/snippetStore'
import { useGoBack } from '@/composables/useGoBack'
import type { Snippet } from '@/types'
import type { AssistantTurnMessage } from '@/api/ai'
import MarkdownText from '@/components/global/content/MarkdownText.vue'
import AppIcon from '@/components/global/base/AppIcon.vue'
import BrandMark from '@/components/global/layout/BrandMark.vue'
import ConfirmDialog from '@/components/global/feedback/ConfirmDialog.vue'
import SnippetResultCard from '@/components/business/assistant/SnippetResultCard.vue'
import ModifyCard from '@/components/business/assistant/ModifyCard.vue'
import OperateCard from '@/components/business/assistant/OperateCard.vue'
import ThinkingFold from '@/components/business/assistant/ThinkingFold.vue'
import ChatInputBar from '@/components/business/assistant/ChatInputBar.vue'
import WaitingIndicator from '@/components/business/assistant/WaitingIndicator.vue'

const assistantStore = useAiAssistantStore()
const snippetStore = useSnippetStore()
const router = useRouter()
const route = useRoute()
const { goBack } = useGoBack()
const inputBar = ref<InstanceType<typeof ChatInputBar> | null>(null)
const listEl = ref<HTMLElement | null>(null)

// 按 AI 返回顺序取片段（snippetStore.snippets 是库内顺序，不能直接用）
function resultSnippets(all: Snippet[], ids: string[]): Snippet[] {
  const map = new Map(all.map(s => [s.id, s]))
  return ids.map(id => map.get(id)).filter((s): s is Snippet => !!s)
}

// 进入页面聚焦输入框 + 处理 ?snippet 预置。在 onMounted 与 onActivated 都调用：
// KeepAlive 缓存时每次重新进入走 onActivated；未缓存重挂载时走 onMounted
// （seedContext 保留旧对话只追加：新片段会种入，同片段重复进入由 store 内去重跳过）
function prepareEntry() {
  inputBar.value?.focusInput()
  // 从详情页进入：把该片段预置为对话前提（结果消息），召回机制天然继承，可直接说"改成 xx"。
  // seedContext 只追加不清空：已有旧对话保留，新旧片段都能选中；同片段重复进入由 store 去重
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
// "保存为新片段"不直接落库：写草稿跳编辑页预填（标题/语言继承原片段），用户改好点保存才入库。
// from=ai-modify 区分于 create 的 from=ai，编辑页据此回传给 resolveModifyFromEditor
function saveModifyToEditor(msg: AssistantTurnMessage) {
  assistantStore.saveModifyToEditor(msg)
  router.push({ path: '/snippet/new', query: { from: 'ai-modify' } })
}
// 撤销替换：用替换前暂存的原代码恢复该片段
function undoReplace(msg: AssistantTurnMessage) {
  assistantStore.undoReplace(msg)
}

// 危险/不可逆操作名单：单源定义在页面——既驱动 OperateCard 的红/蓝配色（经 :danger 传入），
// 也决定确认后是否再弹双重确认。避免页面与卡片各自维护一份名单
const DANGER_OPS = ['delete', 'clear', 'deleteFolder']
function isDangerOperate(op?: string): boolean {
  return !!op && DANGER_OPS.includes(op)
}

const confirmOpTarget = ref<AssistantTurnMessage | null>(null)
function confirmOperateAction(msg: AssistantTurnMessage) {
  // 删除 / 清空 / 删除收藏夹不可逆，确认卡后再弹一道确认框双重确认
  if (isDangerOperate(msg.operateOp)) {
    confirmOpTarget.value = msg
  } else if (msg.operateOp === 'create') {
    // 新建不直接入库：确认后转入编辑页看完整代码（草稿预填），用户改好点保存才真正入库
    assistantStore.confirmCreateToEditor(msg)
    router.push({ path: '/snippet/new', query: { from: 'ai' } })
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
function openSnippet(id: string) {
  router.push(`/snippet/${id}`)
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
                  <SnippetResultCard v-for="s in resultSnippets(snippetStore.snippets, msg.searchIds)" :key="s.id" :snippet="s" @open="openSnippet(s.id)" />
                </div>
                <!-- AI 修改卡：改写中 / 失败 / 结果 diff + 二次确认。AI 只给建议，落库需用户确认 -->
                <ModifyCard
                  v-if="msg.modifyState"
                  :msg="msg"
                  :original-code="resultSnippets(snippetStore.snippets, msg.searchIds ?? [])[0]?.code ?? ''"
                  @save-as-new="saveModifyToEditor(msg)"
                  @replace="confirmReplace(msg)"
                  @export="assistantStore.exportModify(msg)"
                  @undo-replace="undoReplace(msg)"
                  @view="openSnippet"
                />
                <!-- AI 库操作确认卡：AI 提议删除/重命名/收藏/导出，用户确认后才执行 -->
                <OperateCard
                  v-if="msg.operateState"
                  :msg="msg"
                  :snippets="resultSnippets(snippetStore.snippets, msg.searchIds ?? [])"
                  :total-count="snippetStore.snippets.length"
                  :danger="isDangerOperate(msg.operateOp)"
                  @confirm="confirmOperateAction(msg)"
                  @cancel="assistantStore.cancelOperate(msg)"
                  @view="openSnippet"
                />
                <!-- 思考过程：折叠面板，结果出来后默认收起；有四步总结显示总结，缺失则兜底展示原文 -->
                <ThinkingFold v-if="msg.thinkingSummary || msg.reasoning" :msg="msg" />
              </div>
            </template>

            <!-- 等待回复：四步阶段指示 + 流式思考尾部窗口；503 退避单独提示 -->
            <WaitingIndicator v-if="assistantStore.sending" />
          </div>
        </template>
      </div>
    </div>

    <!-- 底部输入：浮空盖在对话区上方——absolute 定位盖住滚动区底部，消息滚到下面被渐变柔和遮住。
         pointer-events-none 外套 + 居中列：右侧滚动条露在 max-w 外侧不被不透明条盖住，仍可拖动 -->
    <ChatInputBar ref="inputBar" />
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
