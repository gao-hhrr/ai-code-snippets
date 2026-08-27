import { defineAsyncComponent } from 'vue'
import MonacoLoading from '@/components/editor/MonacoLoading.vue'

// ════════════════════════════════════════════════════════
// composables/useMonacoAsync.ts —— Monaco 异步加载封装（详情页/编辑页共用）
// 为什么异步：Monaco ~4MB，直接 import 会打进主 bundle，首屏要下载完才显示页面；
// defineAsyncComponent 让页面骨架先渲染、进编辑器才加载 Monaco，期间显示占位。
// delay=200：加载 <200ms 就完成时不闪占位（避免转圈一闪而过）
// 与 main.ts 预热配合：空闲时后台预载模块，首次进编辑器秒开
// ════════════════════════════════════════════════════════
export function useMonacoAsync() {
  const MonacoEditor = defineAsyncComponent({
    loader: () => import('@/components/editor/MonacoEditor.vue'),
    loadingComponent: MonacoLoading, // 加载中显示转圈遮罩
    delay: 200
  })
  return { MonacoEditor }
}
