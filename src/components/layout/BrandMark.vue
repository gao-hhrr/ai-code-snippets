<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <!-- 品牌标识：三个页面顶部左侧统一（点击回首页）；小屏只留 logo 省空间 -->
  <button
    class="flex items-center gap-2.5 cursor-pointer group shrink-0"
    @click="router.push('/')"
    title="返回首页"
  >
    <div class="w-7 h-7 rounded-lg bg-github-blue shadow-sm flex items-center justify-center text-white text-xs font-bold font-mono group-hover:bg-github-blue-dark group-hover:scale-105 transition-all">&lt;/&gt;</div>
    <span class="text-xl font-bold text-zinc-900 tracking-tight hidden sm:block">Code Snippets</span>
  </button>
</template>
