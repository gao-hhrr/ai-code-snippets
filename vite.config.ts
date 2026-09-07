import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import monacoEditorPluginDefault from 'vite-plugin-monaco-editor'

const monacoEditorPlugin = (monacoEditorPluginDefault as any).default || monacoEditorPluginDefault

// 首屏 modulepreload 注入：路由懒加载让浏览器只能"解析完上一个文件才发现下一个"，
// 首访形成串行瀑布（HTML→入口→路由 chunk→共享 chunk，每跳 1 个 RTT，弱网下单跳数百 ms）。
// 在 index.html 里提前声明首屏 chunk，三份并行下载，省掉 2 个串行等待。
// 文件名 hash 每次构建都变，所以在 build 阶段从产物 bundle 取真实文件名注入，永不指向失效文件。
function firstScreenPreload(routeModules: string[]): Plugin {
  let base = '/'
  return {
    name: 'first-screen-modulepreload',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html // dev 服务器没有产物 bundle，跳过
        const chunks = Object.values(bundle).filter(c => c.type === 'chunk')
        // 从首屏路由组件的 chunk 出发，沿静态 import 收集闭包（入口自身 Vite 已处理）
        const queue = chunks.filter(c => routeModules.some(m => c.facadeModuleId?.includes(m)))
        const files = new Set(queue.map(c => c.fileName))
        while (queue.length) {
          for (const f of queue.pop()!.imports) {
            if (files.has(f)) continue
            files.add(f)
            const dep = chunks.find(k => k.fileName === f)
            if (dep) queue.push(dep)
          }
        }
        const dir = base.endsWith('/') ? base : base + '/'
        // chunk.fileName 已含 assets/ 前缀（如 "assets/index-xxx.js"），拼接 base 即可
        const links = [...files]
          .map(f => `<link rel="modulepreload" crossorigin href="${dir}${f}">`)
          .join('\n    ')
        return html.replace('</head>', `    ${links}\n  </head>`)
      }
    },
    configResolved(resolved) {
      base = resolved.base
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    monacoEditorPlugin({
      // 只保留基础 editorWorkerService：片段浏览/编辑不需要 TS/JSON 智能提示，
      // 去掉 typescript/json worker 可砍掉最大的一块体积（约 2-3MB）
      languageWorkers: ['editorWorkerService']
    }),
    firstScreenPreload(['views/snippet-list'])
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
