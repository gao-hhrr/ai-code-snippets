<!-- ════════════════════════════════════════════════════════
     views/ai-assistant/index.vue —— AI 助手页：对话流编排 + 结果/修改/确认卡渲染 + 用户确认落库
     职责边界：本页是「编排器」——不发请求、不存状态，只做三件事：
       ① 从 store 读 messages，按消息字段渲染成对话流（结果卡/修改卡/确认卡/思考折叠/分割线）
       ② 把用户操作转发回 store（发送、确认、取消、替换、撤销、另存、导出）
       ③ 唯一的改库落库出口：saveModifyToEditor / doReplace / doOperate 三条路径收敛于此
     与 store 的分工：请求、状态机、落库逻辑全在 aiAssistantStore；本页只触发动作并等结果回显。
     跨页契约：另存/新建都跳编辑页预填草稿，query 用 from=ai（create）/ from=ai-modify（modify），
       编辑页据此选择回传函数（见 snippet-editor/index.vue）。
     （KeepAlive 按组件名缓存，name 显式声明比依赖文件名推断可靠）
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
// 显式声明组件名：App.vue 的 KeepAlive :include 按名字匹配。用 defineOptions（Vue 3.3+ 宏，编译期擦除）
// 而非文件名推断——文件叫 index.vue，推断出来是 "Index" 匹配不上；也不为它单独开一个 <script> 块
defineOptions({ name: 'AiAssistantPage' })

import { ref, watch, computed, nextTick, onMounted, onActivated, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'
import { useSnippetStore } from '@/stores/snippetStore'
import { useGoBack } from '@/composables/useGoBack'
import { useScrollRestore } from '@/composables/useScrollRestore'
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

// 按 AI 返回顺序取片段（snippetStore.snippets 是库内顺序，不能直接用）。
// 先建 Map 索引 O(1) 取，避免每个 id 都 filter 一遍库列表；filter 用类型守卫收窄掉 undefined
function resultSnippets(all: Snippet[], ids: string[]): Snippet[] {
  // 数组map生成 [id,片段] 二维数组；new Map构建id→片段的快速索引查表
  const map = new Map(all.map(s => [s.id, s]))
  // 遍历AI的ids数组，顺序跟随ids；查找不到的id会得到undefined
  // filter剔除undefined，同时TS类型守卫收窄类型，输出纯净Snippet数组
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
// 滚动位置保存/恢复（sessionStorage 草稿策略 + scroll 事件保存点 + nextTick/rAF 双重等待）见 composables/useScrollRestore
const { bindScroll, restoreScroll, unbindScroll } = useScrollRestore('code-snippets:ai-scroll', () => listEl.value)

onMounted(() => {
  prepareEntry()
  bindScroll()
})
onActivated(() => {
  prepareEntry()
  restoreScroll()
})
onBeforeUnmount(() => {
  unbindScroll()
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

// 双重确认对话框文案按操作分支：清空片段库 / 删除收藏夹 / 删除片段。
// 用 computed的理由：
// 1.缓存，避免重复执行：模板多处读取，内部逻辑只执行一次，不会多次构造对象。
// 2.自动收集响应式依赖：confirmOpTarget、片段总数变化，自动重新计算文案。
// 用户从确认卡点确认时才 set 目标，computed 据此刻状态切换文案；空目标时兜底走"删除片段"
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

// 新消息/发送中自动滚到底部：只监听 [messages.length, sending] 二元组——新消息 push 或进入发送态触发。
// 故意不监听内容增量：SSE 流式输出时 content 持续变长，若监听它每写一个字就抢滚动，会和用户手动上翻打架。
// 必须 nextTick 后再滚：刚 push 的消息尚未进 DOM，此刻 scrollHeight 还是旧值，立即 scrollTo 会停在半截
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
     <!-- `!!` 转布尔值：有值 → `true` 弹窗显示；`null` → `false` 弹窗关闭。 -->
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
