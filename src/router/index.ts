import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'snippets',
      component: () => import('@/views/SnippetList.vue')
    },
    {
      path: '/ai',
      name: 'ai-assistant',
      component: () => import('@/views/AiAssistantPage.vue'),
      meta: { hideSidebar: true, hideHeader: true }
    },
    {
      path: '/snippet/new',
      name: 'snippet-new',
      component: () => import('@/views/SnippetEditor.vue'),
      meta: { hideSidebar: true, hideHeader: true }
    },
    {
      path: '/snippet/:id',
      name: 'snippet-detail',
      component: () => import('@/views/SnippetDetail.vue'),
      meta: { hideSidebar: true, hideHeader: true }
    },
    {
      path: '/snippet/:id/edit',
      name: 'snippet-edit',
      component: () => import('@/views/SnippetEditor.vue'),
      meta: { hideSidebar: true, hideHeader: true }
    }
  ]
})

export default router
