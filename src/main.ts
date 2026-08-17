import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'
import iconfontSvg from './assets/iconfont.svg?raw'

// iconfont symbol 必须在 app.mount 前注入 DOM，否则首屏 <use> 解析不到 symbol、图标空白。
// 雪碧图本身不可见：零尺寸 + absolute + overflow:hidden（不能用 display:none，会破坏 symbol 解析）
const iconfontHolder = document.createElement('div')
iconfontHolder.innerHTML = iconfontSvg
const sprite = iconfontHolder.firstElementChild as SVGElement
sprite.setAttribute('aria-hidden', 'true')
sprite.style.width = '0'
sprite.style.height = '0'
sprite.style.position = 'absolute'
sprite.style.overflow = 'hidden'
document.body.insertBefore(sprite, document.body.firstElementChild)

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Monaco 体积大（~4MB）异步加载；应用空闲时后台预热模块缓存，
// 首次进详情/编辑页编辑器即可秒开（同一模块后续 import 直接命中缓存）
if ('requestIdleCallback' in window) {
  window.requestIdleCallback(() => {
    import('@/editor/MonacoEditor.vue')
  }, { timeout: 3000 })
} else {
  setTimeout(() => import('@/editor/MonacoEditor.vue'), 2000)
}
