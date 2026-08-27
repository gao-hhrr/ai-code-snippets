// ════════════════════════════════════════════════════════
// router/index.ts —— 路由表：5 条懒加载路由（列表 / AI 助手 / 新建 / 详情 / 编辑）
// 每条路由 () => import() 懒加载：首屏只拉当前页 chunk，其余按需加载
// KeepAlive 按组件 name 匹配（App.vue include 'AiAssistantPage'），不是路由 name——
// AI 助手页组件 defineOptions({ name: 'AiAssistantPage' })，路由 name 'ai-assistant' 仅导航用
// ════════════════════════════════════════════════════════
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'snippets',
      component: () => import('@/views/snippet-list/index.vue')
    },
    {
      path: '/ai',
      name: 'ai-assistant',
      component: () => import('@/views/ai-assistant/index.vue')
    },
    {
      path: '/snippet/new',
      name: 'snippet-new',
      component: () => import('@/views/snippet-editor/index.vue')
    },
    {
      path: '/snippet/:id',
      name: 'snippet-detail',
      component: () => import('@/views/snippet-detail/index.vue')
    },
    {
      path: '/snippet/:id/edit',
      name: 'snippet-edit',
      component: () => import('@/views/snippet-editor/index.vue')
    }
  ]
})

export default router
