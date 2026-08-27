<!-- ════════════════════════════════════════════════════════
     MonacoEditor —— Monaco 代码编辑器封装（受控组件）：内容/语言/只读/高度/字号，经 v-model 双向绑定
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
// 用精简入口：完整 monaco-editor 会拉起 TS/JSON/CSS/HTML 语言服务 worker（TS 约 7MB），
// 片段浏览/编辑不需要智能提示，只保留基础语法高亮 + 标准编辑器功能
import * as monaco from '@/components/editor/monaco'

// ════════════════════════════════════════════════════════
// 1. props：父组件传进来的「配置」——被 v-model 用的受控组件：
//    内容值由外部 ref 决定（modelValue 接收），编辑器内部改动后 emit 上抛
// ════════════════════════════════════════════════════════
const props = defineProps<{
  modelValue: string          // 编辑器的内容（代码全文）
  language?: string           // 应用语言名，如 'JavaScript'（会被 languageToMonaco 翻译成 Monaco 的语言）
  readonly?: boolean          // 是否只读（详情页传 true）
  height?: string             // 高度，CSS 字符串，如 '300px'
  fontSize?: number           // 字号
  wordWrap?: boolean          // 是否自动换行
  frame?: boolean             // 是否显示边框（默认 true）
  paddingTop?: number         // 顶部留白
}>()

// ════════════════════════════════════════════════════════
// 2. emit：编辑器向外「广播」的事件
// ════════════════════════════════════════════════════════
const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// container：模板里那个 div 的引用。Monaco 编辑器就"长"在这个 div 里。
const container = ref<HTMLElement>()
// editor：编辑器实例。注意它是命令式 API 创建的对象，不是响应式数据，用普通变量存。
let editor: monaco.editor.IStandaloneCodeEditor | null = null

// ════════════════════════════════════════════════════════
// 3. 语言翻译：应用语言名 → Monaco 语言名
// 应用叫 'Vue'/'C++'，Monaco 内部叫 'html'/'cpp'，名字对不上，需映射才知道用哪套高亮
// ════════════════════════════════════════════════════════
function languageToMonaco(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'javascript',
    typescript: 'typescript',
    html: 'html',
    css: 'css',
    vue: 'html',            // Vue 模板本质是 HTML 结构
    react: 'javascript',    // JSX 按 JS 高亮
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
    'c++': 'cpp',           // Monaco 里 C++ 叫 cpp
    'c#': 'csharp',         // C# 叫 csharp
    php: 'php',
    ruby: 'ruby',
    swift: 'swift',
    kotlin: 'kotlin',
    r: 'r'
  }
  return map[lang.toLowerCase()] || 'plaintext'  // 查不到 → 纯文本（没有高亮）
}

// ════════════════════════════════════════════════════════
// 4. 生命周期：组件挂载到 DOM 后创建编辑器
// ════════════════════════════════════════════════════════
onMounted(() => {
  if (!container.value) return

  // monaco.editor.create(容器 div, 配置) 把 div 变成编辑器；创建一次性，之后改配置用 updateOptions（见 5）
  editor = monaco.editor.create(container.value, {
    value: props.modelValue,                                   // 初始内容
    language: languageToMonaco(props.language || ''),          // 初始语言（要翻译）
    readOnly: props.readonly || false,
    minimap: { enabled: false },                               // 关掉右侧小地图（片段用不上，省空间）
    fontSize: props.fontSize || 13,
    wordWrap: props.wordWrap ? 'on' : 'off',
    lineNumbers: 'on',                                         // 显示行号
    scrollBeyondLastLine: false,                               // 不允许滚动到最后一行之后
    tabSize: 2,                                                // Tab 宽度 2 空格
    padding: { top: props.paddingTop || 0, bottom: 16 },
    automaticLayout: true,                                     // 容器尺寸变化自动重排（AI 抽屉推开编辑器时靠它）
    theme: 'vs'
  })

  // 按 Esc 键：焦点从编辑器跳走
  // 内嵌编辑器不该"困住"用户，Esc 是离开编辑器的出口：
  // 找到页面所有可聚焦元素，焦点跳到编辑器之后的第一个（通常是下一个按钮）
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

  // 编辑器 → 页面：内容被修改时，把最新全文上抛给父组件
  // （父组件 v-model 的 code ref 因此更新，进而触发保存草稿、未保存标记等联动）
  editor.onDidChangeModelContent(() => {
    emit('update:modelValue', editor!.getValue())
  })

})

// ════════════════════════════════════════════════════════
// 5. 页面 → 编辑器：props 变化时「热更新」编辑器
// 每个 watch 回调先判 `if (editor && ...)`：防止 onMounted 之前触发报错
// ════════════════════════════════════════════════════════
watch(() => props.fontSize, (val) => {
  if (editor && val) editor.updateOptions({ fontSize: val })
})

watch(() => props.wordWrap, (val) => {
  if (editor) editor.updateOptions({ wordWrap: val ? 'on' : 'off' })
})

watch(() => props.language, (lang) => {
  if (editor && lang) {
    // 语言变了 → 换一套高亮规则（重新着色，内容不动）
    monaco.editor.setModelLanguage(editor.getModel()!, languageToMonaco(lang))
  }
})

watch(() => props.readonly, (val) => {
  if (editor) editor.updateOptions({ readOnly: val })
})

watch(() => props.modelValue, (val) => {
  // 外部改了值（比如 AI 流式生成代码、上传文件）→ 回填编辑器
  // 加 if(editor.getValue() !== val) 防止死循环：
  //   用户打字 → emit 上抛 → 父组件把同一个值 setValue 回来 → 又触发 onDidChange → …
  // 只有"外部值和编辑器当前值不同"时才回填
  if (editor && editor.getValue() !== val) {
    editor.setValue(val)
  }
})

// ════════════════════════════════════════════════════════
// 6. 卸载：销毁编辑器，释放内存和事件监听
// ════════════════════════════════════════════════════════
onBeforeUnmount(() => {
  editor?.dispose()
})
</script>

<template>
  <!-- 这就是编辑器的"宿主容器"：一个空的 div，Monaco 会把它变成编辑器 -->
  <div
    ref="container"
    class="overflow-hidden"
    :class="frame !== false ? 'border border-zinc-200 rounded-lg' : ''"
    :style="{ height: height || '400px' }"
  ></div>
</template>
