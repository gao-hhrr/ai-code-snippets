<!-- ════════════════════════════════════════════════════════
     NavFolders —— 侧边栏收藏夹列表：折叠/展开 + 筛选联动高亮 + 新建/重命名/删除收藏夹
     ════════════════════════════════════════════════════════ -->
<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useSnippetStore } from '@/stores/snippetStore'
import { useRouter, useRoute } from 'vue-router'
import { useClickOutside, useEscape } from '@/composables/useClickOutside'

import ConfirmDialog from '@/components/global/feedback/ConfirmDialog.vue'
import FolderRow from '@/components/business/folder/FolderRow.vue'
import AppIcon from '@/components/global/base/AppIcon.vue'

const snippetStore = useSnippetStore()
const router = useRouter()
const route = useRoute()

// 折叠状态不持久化：每次进入默认展开，用户本次会话内折叠即可
const showFolders = ref(true)

// 激活联动：筛选某收藏夹时自动展开对应组，保证高亮项可见
watch(
  () => [snippetStore.filterType, snippetStore.filterValue],
  ([type, value]) => {
    if (type === 'favorites' && value) showFolders.value = true
  }
)

// 仅在列表页时高亮收藏夹子项
function isActiveFolder(id: string) {
  return (
    snippetStore.filterType === 'favorites' &&
    snippetStore.filterValue === id &&
    route.name === 'snippets'
  )
}

// 筛选某收藏夹并确保停留在列表页
function applyFolderFilter(id: string) {
  snippetStore.setFilter('favorites', id)
  if (route.name !== 'snippets') {
    router.push('/')
  }
}

// 收藏夹操作互斥：新建输入框、行重命名、行菜单同一时间只允许一个
const creatingFolder = ref(false)
const activeRowId = ref<string | null>(null)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement>()
const newFolderBtn = ref<HTMLElement>()
// 新建气泡方向：默认在按钮下方，贴近视口底部时翻到上方，避免被滚动区裁掉
const newFolderBubbleAnchor = ref<'top' | 'bottom'>('top')

async function startCreateFolder() {
  creatingFolder.value = true
  activeRowId.value = null
  newFolderName.value = ''
  const rect = newFolderBtn.value?.getBoundingClientRect()
  newFolderBubbleAnchor.value = rect && rect.bottom + 160 > window.innerHeight ? 'bottom' : 'top'
  await nextTick()
  newFolderInput.value?.focus()
}

// 某行开始重命名或打开菜单：关闭新建输入框并占用互斥锁
function onRowActivate(id: string) {
  activeRowId.value = id
  creatingFolder.value = false
}

// 行操作完全关闭：若该行仍持锁则释放
function onRowDeactivate(id: string) {
  if (activeRowId.value === id) activeRowId.value = null
}

function cancelCreateFolder() {
  creatingFolder.value = false
  newFolderName.value = ''
}

// 新建收藏夹名重名检测：重名时禁用保存并就地提示（Enter 提交路径同样拦截）
const isNewNameTaken = computed(() => {
  const n = newFolderName.value.trim()
  return !!n && snippetStore.isFolderNameTaken(n)
})

function confirmCreateFolder() {
  const name = newFolderName.value.trim()
  if (!name || isNewNameTaken.value) return
  snippetStore.addFolder(name)
  creatingFolder.value = false
  newFolderName.value = ''
}

// 新建气泡用 document 级 mousedown：按下点在气泡外则关闭。
// 不能用 click：拖选文字在气泡内按下、气泡外松开时，click 落在共同祖先上（判为"外部"）会误关编辑态
useClickOutside(() => cancelCreateFolder(), { selector: '.new-folder-bubble', event: 'mousedown', enabled: () => creatingFolder.value })
// Esc 关闭新建收藏夹气泡
useEscape(() => cancelCreateFolder(), () => creatingFolder.value)

// 清空收藏夹（把所有片段移出该夹，片段不删除）
const showClearFolder = ref(false)
const clearingFolder = ref<{ id: string; name: string } | null>(null)

function askClearFolder(f: { id: string; name: string }) {
  clearingFolder.value = f
  showClearFolder.value = true
}

function confirmClearFolder() {
  if (!clearingFolder.value) return
  snippetStore.clearFolder(clearingFolder.value.id)
  showClearFolder.value = false
  clearingFolder.value = null
}

// 删除收藏夹
const showDeleteFolder = ref(false)
const deletingFolder = ref<{ id: string; name: string } | null>(null)

function askDeleteFolder(f: { id: string; name: string }) {
  deletingFolder.value = f
  showDeleteFolder.value = true
}

function confirmDeleteFolder() {
  if (!deletingFolder.value) return
  snippetStore.deleteFolder(deletingFolder.value.id)
  // 若当前正筛选该夹，删除后回到全部
  if (snippetStore.filterType === 'favorites' && snippetStore.filterValue === deletingFolder.value.id) {
    snippetStore.setFilter('all')
  }
  showDeleteFolder.value = false
  deletingFolder.value = null
}

</script>

<template>
  <div>
    <button
      class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300 transition-colors cursor-pointer"
      @click="showFolders = !showFolders"
    >
      <span class="flex items-center gap-2"><AppIcon name="star" :size="16" /> 收藏夹</span>
      <span class="flex items-center gap-1">
        <span class="text-xs text-zinc-600 tabular-nums">{{ snippetStore.folders.length }}</span>
        <AppIcon
          name="chevron"
          :size="14"
          class="text-zinc-500 transition-transform duration-200"
          :class="showFolders ? 'rotate-180' : ''"
        />
      </span>
    </button>

    <!-- 收藏夹列表（点「收藏夹」条目展开，子列表缩进表达层级） -->
    <div v-if="showFolders" class="space-y-0.5">
      <!-- 单行（编辑态 / 操作菜单 / 自动关闭）在 FolderRow.vue；清空/删除确认在下方 ConfirmDialog -->
      <div v-for="f in snippetStore.folderStats" :key="f.id">
        <FolderRow
          :folder="f"
          :active="isActiveFolder(f.id)"
          :locked="creatingFolder || (activeRowId !== null && activeRowId !== f.id)"
          :is-name-taken="(name) => snippetStore.isFolderNameTaken(name, f.id)"
          @select="applyFolderFilter(f.id)"
          @rename="snippetStore.renameFolder(f.id, $event)"
          @clear="askClearFolder(f)"
          @delete="askDeleteFolder(f)"
          @activate="onRowActivate(f.id)"
          @deactivate="onRowDeactivate(f.id)"
        />
      </div>

      <!-- 新建收藏夹：按钮常驻，气泡浮在按钮下方（贴近视口底部时翻到上方），点击气泡外关闭 -->
      <div class="relative">
        <button
          ref="newFolderBtn"
          class="w-full flex items-center gap-1 pl-8 pr-3 py-1 text-xs text-zinc-600 text-left hover:text-zinc-900 hover:bg-zinc-200 rounded-md transition-colors cursor-pointer"
          @click.stop="startCreateFolder"
        >
          <AppIcon name="plus" :size="12" />
          新建收藏夹
        </button>
        <Transition name="pop">
          <div
            v-if="creatingFolder"
            class="new-folder-bubble absolute left-0 right-0 z-40 bg-white border border-zinc-200 rounded-lg shadow-lg p-2.5"
            :class="newFolderBubbleAnchor === 'top' ? 'top-full mt-1' : 'bottom-full mb-1'"
            :style="{ transformOrigin: newFolderBubbleAnchor === 'top' ? 'top right' : 'bottom right' }"
          >
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              placeholder="收藏夹名称"
              maxlength="12"
              class="w-full px-2.5 py-1.5 text-sm bg-zinc-100 rounded-md focus:outline-none focus:bg-white"
              @keydown.enter="confirmCreateFolder"
              @keydown.esc="cancelCreateFolder"
            />
            <p v-if="isNewNameTaken" class="mt-1 text-xs text-red-500">已存在同名收藏夹</p>
            <div class="mt-2 flex items-center justify-between gap-2">
              <span class="text-xs text-zinc-400 tabular-nums">{{ newFolderName.length }}/12</span>
              <div class="flex items-center justify-end gap-2">
                <button
                  class="shrink-0 flex items-center justify-center h-8 px-2.5 text-sm text-zinc-600 bg-zinc-200 rounded-md hover:bg-zinc-300 transition-colors cursor-pointer"
                  @click="cancelCreateFolder"
                >取消</button>
                <button
                  class="shrink-0 flex items-center gap-1 h-8 px-2.5 text-sm text-white bg-github-blue rounded-md hover:bg-github-blue-dark transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="保存"
                  :disabled="!newFolderName.trim() || isNewNameTaken"
                  @click="confirmCreateFolder"
                >保存</button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
      <div v-if="snippetStore.folders.length === 0 && !creatingFolder" class="pl-8 pr-3 py-4 text-sm text-zinc-600 text-left">
        暂无收藏夹
      </div>
    </div>

    <ConfirmDialog
      :show="showClearFolder"
      title="清空收藏夹"
      :message="clearingFolder ? `确定清空收藏夹「${clearingFolder.name}」吗？片段不会被删除，只是全部移出该收藏夹。` : ''"
      confirm-text="清空"
      danger
      @cancel="showClearFolder = false"
      @confirm="confirmClearFolder"
    />

    <ConfirmDialog
      :show="showDeleteFolder"
      title="删除收藏夹"
      :message="deletingFolder ? `确定删除收藏夹「${deletingFolder.name}」吗？其中的片段不会被删除，只会移出该收藏夹。` : ''"
      confirm-text="删除"
      danger
      @cancel="showDeleteFolder = false"
      @confirm="confirmDeleteFolder"
    />
  </div>
</template>
