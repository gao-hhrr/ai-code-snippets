<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Header from '@/components/layout/Header.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSnippetStore } from '@/stores/snippetStore'
import router from '@/router'

const snippetStore = useSnippetStore()

const route = useRoute()

// 首次导航（含异步路由组件）完成前不渲染布局，
// 避免刷新时先闪现默认布局（首页框架）再切换
const ready = ref(false)
onMounted(() => {
  router.isReady().then(() => {
    ready.value = true
  })
})

// 返回顶部：固定显示，点击平滑回顶
const mainRef = ref<HTMLElement>()

function scrollToTop() {
  const el = mainRef.value
  if (!el || el.scrollTop <= 0) return
  // 尊重系统「减少动态效果」偏好，直接跳到顶部
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = 0
    return
  }
  const target = el
  const start = target.scrollTop
  const duration = 600
  const startTime = performance.now()

  function step(now: number) {
    const progress = Math.min((now - startTime) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic：先快后慢
    target.scrollTop = start * (1 - eased)
    if (progress < 1) requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
}
</script>

<template>
  <div v-if="!ready" class="h-screen bg-zinc-100"></div>
  <div v-else class="h-screen flex flex-col bg-zinc-100">
    <Header v-if="!route.meta.hideHeader" />
    <div class="flex flex-1 overflow-hidden">
      <Sidebar v-if="!route.meta.hideSidebar" />
      <main
        ref="mainRef"
        class="flex-1 bg-zinc-100"
        :class="route.meta.hideSidebar ? 'overflow-hidden' : 'overflow-y-auto p-5'"
      >
        <!-- 仅缓存 AI 助手页：离开（进详情等）再回来时保留对话 DOM 与滚动位置，不重置回顶部。
             include 只圈住 AiAssistantPage，SnippetEditor 等动态路由组件不被缓存，避免复用旧实例 -->
        <router-view v-slot="{ Component }">
          <KeepAlive :include="['AiAssistantPage']">
            <component :is="Component" />
          </KeepAlive>
        </router-view>
      </main>
    </div>

    <Transition name="fade">
      <button
        v-if="!route.meta.hideSidebar && !snippetStore.batchMode"
        class="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full bg-white ring-1 ring-zinc-200 shadow-lg flex items-center justify-center text-zinc-600 hover:text-zinc-900 hover:ring-zinc-300 transition-colors cursor-pointer"
        title="返回顶部"
        @click="scrollToTop"
      ><AppIcon name="arrow-up" :size="18" /></button>
    </Transition>

  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
