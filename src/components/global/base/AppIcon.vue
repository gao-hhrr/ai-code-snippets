<!-- ════════════════════════════════════════════════════════
     AppIcon —— 图标组件：把语义名（search/plus/...）翻译成 iconfont symbol id，
     再用 <use> 从雪碧图里"复印"出对应图标。

     机制（配 src/assets/iconfont.svg 一起看）：
     · iconfont.svg 是"雪碧图"：一个 <svg> 里装 N 个 <symbol>，每个 symbol 是一个图标
     · main.ts 启动时用 ?raw 读入整个文件、注入 DOM（svg 被藏起来，但 symbol 全局注册）
     · 这里用 <use :href="'#icon-xxx'"> 按 id 引用；viewBox 1024 与 symbol 对齐，缩放不变形
     · 颜色：symbol 用 fill="currentColor"（或省略继承），图标跟随所在文字的颜色变化

     新增图标三步：
     1. 把 1024 坐标系的 <symbol> 粘进 src/assets/iconfont.svg
     2. 在下面 ICFONT_MAP 加一行 语义名 → 图标名
     3. 组件里写 <AppIcon name="新名字" />
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  size?: number
  filled?: boolean
}>(), { size: 18, filled: false })

// 语义名 → iconfont 图标名（symbol id 为 icon-<名>）。未映射的 name 渲染为空。
// 新增图标：先在 src/assets/iconfont.svg 加对应 <symbol>，再在这表加一行即可。
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
  <!-- iconfont symbol 图标：<use> 按 id 从雪碧图复印；viewBox 1024 与 symbol 对齐不变形；
       fill="currentColor" 让颜色跟随所在文字；未映射的 name 渲染为空 -->
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
