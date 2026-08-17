<script setup lang="ts">
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

// 搜索式语言下拉：鼠标驱动——点击展开、输入即过滤、点选（GitHub 语言选择器同款）。
// 解决长列表（24 种）靠滚动找语言的痛点；弹层 Teleport 到 body，避免被容器 overflow 裁剪
const model = defineModel<string>({ required: true })
const props = defineProps<{
  languages: string[]
  disabled?: boolean
}>()

const open = ref(false)
const query = ref('')
const triggerEl = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const popEl = ref<HTMLElement>()
const popStyle = ref<{ top: string; left: string; width: string }>()

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.languages
  return props.languages.filter(l => l.toLowerCase().includes(q))
})

async function openMenu() {
  if (props.disabled || open.value) return
  open.value = true
  query.value = ''
  const rect = triggerEl.value?.getBoundingClientRect()
  if (rect) {
    const GAP = 4
    // 弹层内容上限（搜索框 + 列表区），方向按上下可用空间比较，避免固定估算误判
    const estHeight = 266
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    // 下方空间更足则向下开，否则向上开；top 收敛在视口内防止负数/溢出被裁
    const top = spaceBelow >= estHeight || spaceBelow >= spaceAbove
      ? Math.min(rect.bottom + GAP, window.innerHeight - estHeight - GAP)
      : Math.max(GAP, rect.top - estHeight)
    popStyle.value = {
      top: `${top}px`,
      left: `${rect.left}px`,
      width: `${Math.max(rect.width, 176)}px`
    }
  }
  await nextTick()
  searchInput.value?.focus({ preventScroll: true })
}

function toggle() {
  if (open.value) close()
  else openMenu()
}

function select(lang: string) {
  model.value = lang
  close()
}

function close() {
  open.value = false
}

// 点击外部关闭：document 级 mousedown（拖选在框内按下、框外松开不误关）
function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return
  if (!(e.target as HTMLElement).closest('.lang-select, .lang-select-pop')) {
    close()
  }
}

// 外部滚动时关闭（避免 fixed 弹层与触发框错位）；弹层内部列表滚动不算外部
function onDocScroll(e: Event) {
  if (!open.value) return
  if (popEl.value && popEl.value.contains(e.target as Node)) return
  close()
}

// Esc 关闭
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}

// 窗口缩放后 fixed 定位与触发框错位，resize 时关闭
function onWindowResize() {
  close()
}

watch(open, (o) => {
  if (o) {
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('scroll', onDocScroll, true)
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', onWindowResize)
  } else {
    document.removeEventListener('mousedown', onDocMouseDown, true)
    document.removeEventListener('scroll', onDocScroll, true)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onWindowResize)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('scroll', onDocScroll, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWindowResize)
})
</script>

<template>
  <div ref="triggerEl" class="lang-select relative">
    <button
      type="button"
      class="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-300 rounded-lg bg-white cursor-pointer disabled:opacity-60"
      :disabled="disabled"
      title="选择语言"
      @click="toggle"
    >
      <span class="min-w-0 truncate">{{ model }}</span>
      <AppIcon name="chevron" :size="14" class="shrink-0 text-zinc-500 transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
    </button>
  </div>

  <Teleport to="body">
    <Transition name="pop">
      <div
        v-if="open"
        ref="popEl"
        class="lang-select-pop fixed z-50 flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg max-h-[calc(100vh-8px)]"
        :style="popStyle"
      >
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          placeholder="搜索语言…"
          class="w-full shrink-0 border-b border-zinc-200 px-3 py-2 text-sm bg-zinc-50 focus:outline-none"
        />
        <div class="min-h-0 flex-1 max-h-56 overflow-y-auto p-1">
          <button
            v-for="l in filtered"
            :key="l"
            type="button"
            class="w-full text-left px-2.5 py-1.5 rounded text-sm cursor-pointer hover:bg-zinc-200"
            :class="l === model ? 'text-github-blue font-medium' : 'text-zinc-700'"
            @click="select(l)"
          >{{ l }}</button>
          <div v-if="filtered.length === 0" class="px-2.5 py-4 text-sm text-zinc-400 text-center">无匹配语言</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pop-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.pop-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}
</style>
