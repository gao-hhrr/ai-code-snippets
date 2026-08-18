import { defineAsyncComponent } from 'vue'
import MonacoLoading from '@/components/editor/MonacoLoading.vue'

// ============================================================
// Monaco 异步加载封装
//
// 为什么要异步？
//   Monaco 很大（~4MB）。如果直接 import，会打进主 bundle，
//   用户打开网站要下载完 4MB 才看到页面 → 首屏极慢。
//   所以用 defineAsyncComponent 把它变成"用到才加载"的异步组件：
//   页面骨架先渲染，等用户真正进编辑器时才加载 Monaco，期间显示占位。
//
// defineAsyncComponent(配置) 返回一个"异步组件"：
//   - loader:  () => import(...)    真正开始加载的函数（懒加载的入口）
//   - loadingComponent:            加载期间显示的占位组件（转圈"加载编辑器…"）
//   - delay:   200                 超过 200ms 才显示占位——如果加载 <200ms 就完成，
//                                   不会闪一下转圈（避免闪烁）
//
// 详情页 / 编辑页共用这个封装，避免两处各自写一遍 defineAsyncComponent。
// 与 main.ts 的"预热"配合：main.ts 在浏览器空闲时后台预载 MonacoEditor.vue，
//   首次进编辑器时模块已在缓存里，秒开（不用现场下载 4MB）。
// ============================================================
export function useMonacoAsync() {
  const MonacoEditor = defineAsyncComponent({
    loader: () => import('@/components/editor/MonacoEditor.vue'),
    loadingComponent: MonacoLoading, // 加载中显示遮罩(转圈)
    delay: 200 // 超过 200ms 才显示遮罩,避免一闪
  })
  return { MonacoEditor }
}
