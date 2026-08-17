<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  size?: number
  filled?: boolean
}>(), { size: 18, filled: false })

// 语义名 → iconfont 图标名（symbol id 为 icon-<名>）。未映射的 name 渲染为空。
const ICFONT_MAP: Record<string, string> = {
  search: 'sousuo',
  plus: 'jiahao',
  x: 'chahao',
  check: 'duigou',
  more: 'gengduo',
  'arrow-up': 'fanhuidingbu',
  doc: 'daimapianduan',
  clock: 'shizhong',
  folder: 'yuyan',
  back: 'fanhui',
  chevron: 'chevron'
}

// star 用两态：空心 = 未收藏（shoucang），实心 = 已收藏（shixinshoucang）
const iconfontId = computed(() => {
  if (props.name === 'star') {
    return props.filled ? 'icon-shixinshoucang' : 'icon-shoucang'
  }
  const mapped = ICFONT_MAP[props.name]
  return mapped ? `icon-${mapped}` : ''
})
</script>

<template>
  <!-- iconfont symbol 图标：currentColor 跟随主题色，1024 网格；未映射的 name 渲染为空 -->
  <svg
    v-if="iconfontId"
    :width="size"
    :height="size"
    viewBox="0 0 1024 1024"
    fill="currentColor"
    aria-hidden="true"
  >
    <use :href="`#${iconfontId}`" />
  </svg>
</template>
