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
</script>

<template>
  <!-- 路由就绪前显示加载占位（与 index.html 首屏占位同款），而非一片灰，白屏期全程有反馈 -->
  <div v-if="!ready" class="app-loading">
    <span class="app-loading-spinner"></span>
    <span class="app-loading-text">加载中…</span>
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
