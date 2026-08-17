import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import monacoEditorPluginDefault from 'vite-plugin-monaco-editor'

const monacoEditorPlugin = (monacoEditorPluginDefault as any).default || monacoEditorPluginDefault

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    monacoEditorPlugin({
      // 只保留基础 editorWorkerService：片段浏览/编辑不需要 TS/JSON 智能提示，
      // 去掉 typescript/json worker 可砍掉最大的一块体积（约 2-3MB）
      languageWorkers: ['editorWorkerService']
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
