// ════════════════════════════════════════════════════════
// main.ts —— 应用入口：注册 Pinia/router、注入 iconfont 雪碧图、浏览器空闲预热 Monaco
// ════════════════════════════════════════════════════════
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'
// 所有界面图标都定义在 src/assets/iconfont.svg（一个 <svg> 装多个 <symbol>），
// 组件通过 AppIcon.vue 的 <use> 引用；这里只负责在启动时把整个文件注入页面
import iconfontSvg from './assets/iconfont.svg?raw' // ?raw：让 Vite 以纯字符串返回 SVG 内容，才能手动注入 DOM

// iconfont symbol 必须在 app.mount 前注入 DOM，否则首屏 <use> 解析不到 symbol、图标空白。
// 雪碧图本身不可见：零尺寸 + absolute + overflow:hidden（不能用 display:none，会破坏 symbol 解析）
// innerHTML 只能设在元素上，先拿 div 装 SVG 字符串，再取出里面的 <svg>（含所有 <symbol>）
const iconfontHolder = document.createElement('div')
iconfontHolder.innerHTML = iconfontSvg
const sprite = iconfontHolder.firstElementChild as SVGElement
sprite.setAttribute('aria-hidden', 'true')//无障碍阅读，让屏幕阅读器忽略当前元素
sprite.style.width = '0'
sprite.style.height = '0'
sprite.style.position = 'absolute'
sprite.style.overflow = 'hidden'
document.body.insertBefore(sprite, document.body.firstElementChild) // 插到 body 最顶端，确保 mount 前就位、首屏 <use> 能解析到

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Monaco 体积大（~4MB）异步加载；应用空闲时后台预热模块缓存，
// 首次进详情/编辑页编辑器即可秒开（同一模块后续 import 直接命中缓存）。
// 弱网不预热：4MB 预加载会与首屏交互抢带宽，弱网里"浏览器空闲"其实是假空闲，
// 改由真正进编辑器时再按需加载（与不预热行为一致）。
// 弱网判定覆盖三层：省流量模式 / 网络类型 2G·3G / 实测带宽很低
// （downlink 能抓到标称 4G 但实际很慢的情况，如 DevTools 的 Slow 4G 只有 0.4Mbps）。
type ConnectionInfo = { saveData?: boolean; effectiveType?: string; downlink?: number }
const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
const isSlowNetwork =
  !!connection &&
  (connection.saveData === true ||
    connection.effectiveType === 'slow-2g' ||
    connection.effectiveType === '2g' ||
    connection.effectiveType === '3g' ||
    (typeof connection.downlink === 'number' && connection.downlink < 1.5))
if (!isSlowNetwork) {
  if ('requestIdleCallback' in window) {
    //浏览器空闲时执行的回调函数
    window.requestIdleCallback(() => {
      import('@/components/editor/MonacoEditor.vue')
    }, { timeout: 3000 })
  } else {
    setTimeout(() => import('@/components/editor/MonacoEditor.vue'), 2000)
  }
}
