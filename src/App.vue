<!-- ════════════════════════════════════════════════════════
     App.vue —— 应用壳：路由就绪门（避免首屏闪布局）+ KeepAlive 缓存 AI 助手页
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import router from '@/router'

// 首次导航（含异步路由组件）完成前不渲染布局，
// 避免刷新时先闪现默认布局（首页框架）再切换
const ready = ref(false)
onMounted(() => {
  router.isReady().then(() => {
    ready.value = true
  })
})

// 懒加载路由点击→chunk 到达前是"死窗口"，顶部进度条让等待可感知。
// 120ms 延迟显示：目标 chunk 已缓存时导航瞬间完成、定时器被清除，不出条不闪烁
const routeLoading = ref(false)
let showTimer: ReturnType<typeof setTimeout> | undefined
function finishRoute() {
  clearTimeout(showTimer)
  routeLoading.value = false
}
router.beforeEach(() => {
  clearTimeout(showTimer)
  showTimer = setTimeout(() => { routeLoading.value = true }, 120)
})
router.afterEach(finishRoute)
router.onError(finishRoute)
</script>

<template>
  <!-- 路由切换进度条：假进度动画（宽度缓推），导航完成时随 fade 淡出 -->
  <Transition name="fade">
    <div v-if="routeLoading" class="route-progress" aria-hidden="true"></div>
  </Transition>
  <!-- 路由就绪前渲染与 index.html 同款骨架屏（样式由 index.html 内联 <style> 提供，全文档生效），
       两段骨架无缝衔接，避免"骨架→转圈→页面"的跳变 -->
  <div v-if="!ready" class="app-skeleton" aria-hidden="true">
    <div class="sk-header">
      <div class="sk-bone" style="width: 130px; height: 20px"></div>
      <div class="sk-bone sk-tagline" style="width: 190px; height: 14px"></div>
    </div>
    <div class="sk-body">
      <aside class="sk-side">
        <div class="sk-bone" style="height: 42px"></div>
        <div class="sk-bone" style="height: 42px"></div>
        <div class="sk-bone" style="width: 65%; height: 14px; margin-top: 8px"></div>
        <div class="sk-bone" style="width: 88%; height: 14px"></div>
        <div class="sk-bone" style="width: 58%; height: 14px"></div>
        <div class="sk-bone" style="width: 76%; height: 14px"></div>
      </aside>
      <main class="sk-main">
        <div class="sk-bone" style="width: 180px; height: 28px"></div>
        <div class="sk-bone" style="width: 100%; max-width: 512px; height: 38px; margin-top: 16px"></div>
        <div class="sk-grid">
          <div class="sk-card" v-for="i in 4" :key="i">
            <div class="sk-row">
              <div class="sk-bone" style="width: 56px; height: 20px"></div>
              <div class="sk-bone" style="width: 18px; height: 18px"></div>
            </div>
            <div class="sk-bone" style="width: 60%; height: 16px"></div>
            <div class="sk-bone sk-block"></div>
          </div>
        </div>
      </main>
    </div>
  </div>
  <!-- h-screen 提供高度上下文：详情/编辑页用 h-full 自持整页高度 -->
  <div v-else class="h-screen">
    <!-- 仅缓存 AI 助手页：离开（进详情等）再回来时保留对话 DOM 与滚动位置，不重置回顶部。
         include 只圈住 AiAssistantPage，SnippetEditor 等动态路由组件不被缓存，避免复用旧实例 -->
    <router-view v-slot="{ Component }">
      <KeepAlive :include="['AiAssistantPage']">
        <component :is="Component" />
      </KeepAlive>
    </router-view>
  </div>
</template>
