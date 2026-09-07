// ════════════════════════════════════════════════════════
// services/prefetch.ts —— 路由 chunk 预取：悬停时提前拉目标页代码，router.push 到达时
// 直接命中模块缓存即时挂载，消掉懒加载路由「点击后才开始下载」的死窗口。
// loader 全站单源（main.ts 空闲预热复用），Set 按函数身份去重，同一目标只拉一次
// ════════════════════════════════════════════════════════
const ROUTE_LOADERS = {
  detail: () => import('@/views/snippet-detail/index.vue'),
  editor: () => import('@/views/snippet-editor/index.vue'),
  assistant: () => import('@/views/ai-assistant/index.vue')
}

const started = new Set<() => Promise<unknown>>()

export function prefetchRoute(name: keyof typeof ROUTE_LOADERS) {
  const load = ROUTE_LOADERS[name]
  if (started.has(load)) return
  started.add(load)
  load().catch(() => started.delete(load)) // 失败允许下次触发重试
}

export function prefetchAllRoutes() {
  ;(Object.keys(ROUTE_LOADERS) as Array<keyof typeof ROUTE_LOADERS>).forEach(prefetchRoute)
}
