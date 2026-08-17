<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
// 用精简入口：完整 monaco-editor 会拉起 TS/JSON/CSS/HTML 语言服务 worker（TS 约 7MB），
// 片段浏览/编辑不需要智能提示，只保留基础语法高亮 + 标准编辑器功能
import * as monaco from '@/editor/monaco'

const props = defineProps<{
  modelValue: string
  language?: string
  readonly?: boolean
  height?: string
  fontSize?: number
  wordWrap?: boolean
  frame?: boolean
  paddingTop?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'cursor-position': [pos: { line: number; column: number }]
}>()

const container = ref<HTMLElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null

function languageToMonaco(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'javascript',
    typescript: 'typescript',
    html: 'html',
    css: 'css',
    vue: 'html',
    react: 'javascript',
    json: 'json',
    markdown: 'markdown',
    python: 'python',
    shell: 'shell',
    yaml: 'yaml',
    sql: 'sql',
    java: 'java',
    go: 'go',
    rust: 'rust',
    c: 'c',
    'c++': 'cpp',
    'c#': 'csharp',
    php: 'php',
    ruby: 'ruby',
    swift: 'swift',
    kotlin: 'kotlin',
    r: 'r'
  }
  return map[lang.toLowerCase()] || 'plaintext'
}

onMounted(() => {
  if (!container.value) return

  editor = monaco.editor.create(container.value, {
    value: props.modelValue,
    language: languageToMonaco(props.language || ''),
    readOnly: props.readonly || false,
    minimap: { enabled: false },
    fontSize: props.fontSize || 13,
    wordWrap: props.wordWrap ? 'on' : 'off',
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    tabSize: 2,
    padding: { top: props.paddingTop || 0, bottom: 16 },
    automaticLayout: true,
    theme: 'vs'
  })

  // 内嵌编辑器保留 Tab 缩进（编辑器行为），Esc 作为键盘离开的出口：
  // 焦点跳到编辑器之后的第一个可聚焦控件（即页面上的下一个按钮）
  editor.addCommand(monaco.KeyCode.Escape, () => {
    const focusables = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    let index = -1
    for (let i = 0; i < focusables.length; i++) {
      if (container.value?.contains(focusables[i])) {
        index = i
        break
      }
    }
    focusables[index + 1]?.focus()
  })

  editor.onDidChangeModelContent(() => {
    emit('update:modelValue', editor!.getValue())
  })

  editor.onDidChangeCursorPosition((e) => {
    emit('cursor-position', {
      line: e.position.lineNumber,
      column: e.position.column
    })
  })
})

watch(() => props.fontSize, (val) => {
  if (editor && val) editor.updateOptions({ fontSize: val })
})

watch(() => props.wordWrap, (val) => {
  if (editor) editor.updateOptions({ wordWrap: val ? 'on' : 'off' })
})

watch(() => props.language, (lang) => {
  if (editor && lang) {
    monaco.editor.setModelLanguage(editor.getModel()!, languageToMonaco(lang))
  }
})

watch(() => props.readonly, (val) => {
  if (editor) editor.updateOptions({ readOnly: val })
})

watch(() => props.modelValue, (val) => {
  if (editor && editor.getValue() !== val) {
    editor.setValue(val)
  }
})

onBeforeUnmount(() => {
  editor?.dispose()
})
</script>

<template>
  <div
    ref="container"
    class="overflow-hidden"
    :class="frame !== false ? 'border border-zinc-200 rounded-lg' : ''"
    :style="{ height: height || '400px' }"
  ></div>
</template>
