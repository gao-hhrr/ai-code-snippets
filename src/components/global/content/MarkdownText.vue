<!-- ════════════════════════════════════════════════════════
     MarkdownText —— Markdown 渲染：marked 解析 + DOMPurify 净化，防 XSS
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{ text: string; size?: string }>()

marked.setOptions({ gfm: true, breaks: true })

// marked 同步模式下返回 string；先解析后净化，防止 XSS
const html = computed(() => DOMPurify.sanitize(marked.parse(props.text) as string))
</script>

<template>
  <div class="markdown-body leading-relaxed" :class="props.size ?? 'text-sm'" v-html="html"></div>
</template>

<style>
.markdown-body > :first-child {
  margin-top: 0;
}
.markdown-body > :last-child {
  margin-bottom: 0;
}
.markdown-body p {
  margin: 0.4em 0;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  font-weight: 600;
  margin: 0.8em 0 0.4em;
  color: var(--color-zinc-900);
}
.markdown-body h1 {
  font-size: 1.125rem;
}
.markdown-body h2 {
  font-size: 1.0625rem;
}
.markdown-body h3 {
  font-size: 1rem;
}
.markdown-body h4 {
  font-size: 0.9375rem;
}
.markdown-body ul,
.markdown-body ol {
  padding-left: 1.25em;
  margin: 0.4em 0;
  list-style: disc;
}
.markdown-body ol {
  list-style: decimal;
}
.markdown-body li {
  margin: 0.15em 0;
}
.markdown-body a {
  color: var(--color-github-blue);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.markdown-body blockquote {
  margin: 0.5em 0;
  padding-left: 0.75em;
  border-left: 3px solid var(--color-zinc-300);
  color: var(--color-zinc-600);
}
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  background: var(--color-zinc-100);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
.markdown-body pre {
  margin: 0.6em 0;
  padding: 0.75em 1em;
  background: var(--color-zinc-100);
  border: 1px solid var(--color-zinc-200);
  border-radius: 8px;
  overflow-x: auto;
}
.markdown-body pre code {
  background: transparent;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.5;
}
.markdown-body hr {
  margin: 0.8em 0;
  border: 0;
  border-top: 1px solid var(--color-zinc-200);
}
</style>
