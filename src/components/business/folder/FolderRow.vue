<!-- ════════════════════════════════════════════════════════
     FolderRow —— 侧边栏收藏夹行：点击筛选 + 行内气泡重命名/清空/删除
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { useClickOutside, useEscape } from '@/composables/useClickOutside'

import AppIcon from '@/components/global/base/AppIcon.vue'

const props = defineProps<{
  folder: { id: string; name: string; count: number }
  active: boolean
  // 侧边栏其他操作（新建 / 别行重命名 / 别行菜单）进行中时锁定本行
  locked?: boolean
  // 重命名重名检测：父组件传入并排除当前收藏夹自身
  isNameTaken?: (name: string) => boolean
}>()

const emit = defineEmits<{
  select: []
  rename: [name: string]
  clear: []
  delete: []
  activate: []
  deactivate: []
}>()

// 编辑收藏夹名称（行下方气泡浮层，行本身不变）
const editing = ref(false)
const editFolderName = ref('')
const editFolderInput = ref<HTMLInputElement>()
const rowRef = ref<HTMLElement>()
// 气泡方向：默认出现在行下方，贴近视口底部时翻到行上方，避免被滚动区裁掉
const editBubbleAnchor = ref<'top' | 'bottom'>('top')

async function startRename() {
  if (props.locked) return
  editing.value = true
  editFolderName.value = props.folder.name
  menuOpen.value = false
  const rect = rowRef.value?.getBoundingClientRect()
  editBubbleAnchor.value = rect && rect.bottom + 160 > window.innerHeight ? 'bottom' : 'top'
  emit('activate')
  await nextTick()
  editFolderInput.value?.focus()
}

function cancelRename() {
  editing.value = false
  editFolderName.value = ''
}

// 重命名重名检测：重名时保持气泡打开并就地提示（Enter 提交路径同样拦截）
const editNameTaken = computed(() => {
  const n = editFolderName.value.trim()
  return !!n && !!props.isNameTaken?.(n)
})

function confirmRename() {
  const name = editFolderName.value.trim()
  if (!name || editNameTaken.value) return
  emit('rename', name)
  cancelRename()
}

// 收藏夹操作菜单（more 图标：编辑信息 / 清空 / 删除），下方空间不足时改为向上弹出
const menuOpen = ref(false)
const folderMenuAnchor = ref<'top' | 'bottom'>('top')

function toggleMenu(e: MouseEvent) {
  if (props.locked || editing.value) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  folderMenuAnchor.value = rect.bottom + 160 > window.innerHeight ? 'bottom' : 'top'
  const opening = !menuOpen.value
  menuOpen.value = opening
  if (opening) emit('activate')
}

// 菜单项触发动作前先收起菜单：否则 onDocClickMenu 的 document 级捕获 click 会一直"打开"，
// 确认弹窗出现后仍会吞掉后续第一次点击（点弹窗空白取消 / 点确认按钮都失效，表现为点一下没反应）
function closeMenuThen(action: () => void) {
  menuOpen.value = false
  action()
}

// 菜单：不用全屏遮罩，document 级 click 点击外部关闭。
// capture 阶段阻止穿透（避免确认弹窗刚出现就被这次点击吞掉）；仅在菜单打开时拦截
useClickOutside(() => { menuOpen.value = false }, { selector: '.folder-menu', event: 'click', stopPropagation: true, enabled: () => menuOpen.value })

// 编辑气泡用 document 级 mousedown：按下点在气泡外则关闭。
// 不能用 click：拖选文字在气泡内按下、气泡外松开时，click 落在共同祖先上（判为"外部"）会误关编辑态
useClickOutside(() => cancelRename(), { selector: '.edit-bubble', event: 'mousedown', enabled: () => editing.value })

// Esc 关闭收藏夹操作菜单 / 编辑气泡
useEscape(() => { menuOpen.value = false; if (editing.value) cancelRename() }, () => menuOpen.value || editing.value)

// 菜单打开 5 秒无操作自动收起；鼠标悬停在菜单上时暂停，移出后重新计时
let folderMenuTimer: number | undefined

function scheduleFolderMenuClose() {
  clearTimeout(folderMenuTimer)
  folderMenuTimer = window.setTimeout(() => {
    menuOpen.value = false
  }, 5000)
}

function pauseFolderMenuClose() {
  clearTimeout(folderMenuTimer)
}

watch(menuOpen, (open) => {
  clearTimeout(folderMenuTimer)
  if (open) scheduleFolderMenuClose()
})

// 被侧边栏其他操作占用时，强制关闭本行的编辑态和菜单
watch(() => props.locked, (locked) => {
  if (locked) {
    editing.value = false
    menuOpen.value = false
  }
})

// 编辑态和菜单都关闭时通知父组件解除占用
watch([editing, menuOpen], ([e, m]) => {
  if (!e && !m) emit('deactivate')
})

onBeforeUnmount(() => {
  clearTimeout(folderMenuTimer)
})
</script>

<template>
  <div class="relative">
    <!-- 常规行（常驻渲染，编辑时行本身不变，气泡浮在下方） -->
    <div
      ref="rowRef"
      class="group flex items-center gap-1 pl-8 pr-3 py-1.5 rounded-lg transition-colors cursor-pointer"
      :class="active
        ? 'text-base text-github-blue font-medium bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400'
        : 'text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300'"
      @click="emit('select')"
    >
      <span class="flex items-center gap-1.5 min-w-0 flex-1">
        <span class="truncate">{{ folder.name }}</span>
        <span class="text-xs shrink-0 tabular-nums" :class="active ? 'text-github-blue' : 'text-zinc-600'">{{ folder.count }}</span>
      </span>
      <button
        class="shrink-0 p-1 -mr-1 text-zinc-700 hover:text-zinc-900 rounded transition-colors cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        title="收藏夹操作"
        @click.stop="toggleMenu($event)"
      ><AppIcon name="more" :size="16" /></button>
    </div>

    <!-- 编辑名称气泡：行下方浮层（贴近视口底部时翻到行上方），点击气泡外关闭 -->
    <Transition name="pop">
      <div
        v-if="editing"
        class="edit-bubble absolute left-0 right-0 z-40 bg-white border border-zinc-200 rounded-lg shadow-lg p-2.5"
        :class="editBubbleAnchor === 'top' ? 'top-full mt-1' : 'bottom-full mb-1'"
        :style="{ transformOrigin: editBubbleAnchor === 'top' ? 'top right' : 'bottom right' }"
      >
        <input
          ref="editFolderInput"
          v-model="editFolderName"
          placeholder="收藏夹名称"
          maxlength="12"
          class="w-full px-2.5 py-1.5 text-sm bg-zinc-100 rounded-md focus:outline-none focus:bg-white"
          @keydown.enter="confirmRename"
          @keydown.esc="cancelRename"
        />
        <p v-if="editNameTaken" class="mt-1 text-xs text-red-500">已存在同名收藏夹</p>
        <div class="mt-2 flex items-center justify-between gap-2">
          <span class="text-xs text-zinc-400 tabular-nums">{{ editFolderName.length }}/12</span>
          <div class="flex items-center justify-end gap-2">
            <button
              class="shrink-0 flex items-center justify-center h-8 px-2.5 text-sm text-zinc-600 bg-zinc-200 rounded-md hover:bg-zinc-300 transition-colors cursor-pointer"
              @click="cancelRename"
            >取消</button>
            <button
              class="shrink-0 flex items-center gap-1 h-8 px-2.5 text-sm text-white bg-github-blue rounded-md hover:bg-github-blue-dark transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="保存"
              :disabled="!editFolderName.trim() || editNameTaken"
              @click="confirmRename"
            >
              <AppIcon name="check" :size="14" /> 保存
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 操作菜单：编辑信息 / 清空 / 删除 -->
    <Transition name="pop">
      <div
        v-if="menuOpen"
        class="folder-menu absolute right-0 z-50 w-32 bg-white border border-zinc-200 rounded-lg shadow-lg p-1"
        :class="folderMenuAnchor === 'top' ? 'top-full mt-1' : 'bottom-full mb-1'"
        :style="{ transformOrigin: folderMenuAnchor === 'top' ? 'top right' : 'bottom right' }"
        @click.stop
        @mouseenter="pauseFolderMenuClose"
        @mouseleave="scheduleFolderMenuClose"
      >
        <button
          class="w-full flex items-center justify-center px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-200 rounded-md transition-colors cursor-pointer"
          @click="startRename"
        >编辑信息</button>
        <div class="border-t border-zinc-200 my-0.5"></div>
        <button
          class="w-full flex items-center justify-center px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-200 rounded-md transition-colors cursor-pointer"
          @click="closeMenuThen(() => emit('clear'))"
        >清空收藏夹</button>
        <div class="border-t border-zinc-200 my-0.5"></div>
        <button
          class="w-full flex items-center justify-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-100 rounded-md transition-colors cursor-pointer"
          @click="closeMenuThen(() => emit('delete'))"
        >删除</button>
      </div>
    </Transition>
  </div>
</template>
