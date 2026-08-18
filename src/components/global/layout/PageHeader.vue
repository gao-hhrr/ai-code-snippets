<!-- ════════════════════════════════════════════════════════
     PageHeader —— 页面级顶栏（详情/编辑页共用）：品牌 + 返回 + 右侧标题，样式与首页内联顶栏一致
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import BrandMark from '@/components/global/layout/BrandMark.vue'
import AppIcon from '@/components/global/base/AppIcon.vue'
import { useGoBack } from '@/composables/useGoBack'

defineProps<{ title: string }>()

const { goBack } = useGoBack()
</script>

<template>
  <div class="h-14 shrink-0 flex items-center gap-3 px-4 sm:px-6 bg-white border-b border-zinc-200">
    <BrandMark />
    <button
      class="flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg px-2.5 py-1.5 -ml-1 transition-colors cursor-pointer shrink-0"
      title="返回"
      @click="goBack"
    ><AppIcon name="back" :size="15" /> 返回</button>
    <span class="ml-auto text-sm text-zinc-600">{{ title }}</span>
  </div>
</template>
