// ════════════════════════════════════════════════════════
// router/index.ts —— 路由表：5 条懒加载路由（列表 / AI 助手 / 新建 / 详情 / 编辑）
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
