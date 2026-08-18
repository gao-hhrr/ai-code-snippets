import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Snippet, Folder } from '@/types'
import { compareSnippets } from '@/services/sort'
import type { SortBy, SortDir } from '@/services/sort'
import { generateDescription } from '@/api/ai'
import {
  loadSnippets, loadFolders, persistSnippets, persistFolders, migrateData
} from '@/services/storage'
import { seedIfFirstUse } from '@/services/seed'

// 排序类型定义在 services/sort.ts，这里 re-export 保持既有引用（SortMenu）不变
export type { SortBy, SortDir } from '@/services/sort'
export type FilterType = 'all' | 'language' | 'favorites' | 'recent'

// ════════════════════════════════════════════════════════
// snippetStore：片段 + 收藏夹 + 批量选择 + AI 描述生成 四个域的编排中心。
// 数据所有权：snippets / folders 在此声明，watch deep 自动落盘 localStorage；
// 纯逻辑已抽到 services（sort / storage / seed），store 只留「必须碰响应式数据」的编排。
// ════════════════════════════════════════════════════════
export const useSnippetStore = defineStore('snippet', () => {

  // ════════════════════════════════════════════════════════
  //  状态
  // ════════════════════════════════════════════════════════
  // --- 数据源：watch deep 自动落盘 localStorage（见「初始化与持久化」）---
  const snippets = ref<Snippet[]>(loadSnippets())
  const folders = ref<Folder[]>(loadFolders())
  const loading = ref(false)

  // --- 筛选 / 排序条件：会话内状态，不持久化 ---
  const searchQuery = ref('')
  const filterType = ref<FilterType>('all')
  const filterValue = ref('')//对应筛选条件的值
  // 排序不持久化：每次进入页面默认「最近更新 ↓」，会话内切换即时生效
  const sortBy = ref<SortBy>('updated')
  const sortDir = ref<SortDir>('desc')

  // --- 批量选择状态 ---
  // 没有显式"批量模式"：有选中片段即视为批量态（底部操作条随之出现）
  const selectedIds = ref<string[]>([])
  const batchMode = computed(() => selectedIds.value.length > 0)


  // ════════════════════════════════════════════════════════
  //  初始化与持久化
  // ════════════════════════════════════════════════════════
  // 首次使用写入示例数据（只写一次，之后以用户数据为准）
  seedIfFirstUse(snippets.value)
  // 一次性迁移：旧的 isFavorited 收藏 → 「默认收藏夹」，并规范化 folderIds
  migrateData(snippets.value, folders.value)

  // 数据变化自动落盘（localStorage）
  watch(snippets, persistSnippets, { deep: true })
  watch(folders, persistFolders, { deep: true })


  // ════════════════════════════════════════════════════════
  //  筛选 / 排序 / 统计
  // ════════════════════════════════════════════════════════
  function setFilter(type: FilterType, value = '') {
    // 切换筛选即清空选择，避免跨视图残留批量操作栏
    selectedIds.value = []
    filterType.value = type
    filterValue.value = value
    searchQuery.value = ''
  }

  // --- 核心列表：筛选 → 搜索 → 排序（拷贝后原地 sort，不改 snippets 原数组）---
  const filteredSnippets = computed(() => {
    let result = snippets.value

    switch (filterType.value) {
      case 'language':
        result = result.filter(s => s.language === filterValue.value)
        break
      case 'favorites':
        result = result.filter(s => s.folderIds.includes(filterValue.value))
        break
      case 'recent':
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        result = result.filter(s => new Date(s.createdAt).getTime() > weekAgo)
        break
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      result = result.filter(s => s.title.toLowerCase().includes(q))
    }

    // sort 返回负值 a 在 b 前，正值 a 在 b 后；比较逻辑见 services/sort.ts
    result = [...result].sort((a, b) => compareSnippets(a, b, sortBy.value, sortDir.value))

    return result
  })

  // --- 语言统计：导航「按语言」筛选项的数据来源 ---
  const languageStats = computed(() => {
    const map = new Map<string, number>()
    snippets.value.forEach(s => {
      map.set(s.language, (map.get(s.language) || 0) + 1)
    })
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  })

  // --- 收藏夹统计：导航侧栏每个夹的片段数 ---
  const folderStats = computed(() =>
    folders.value.map(f => ({
      id: f.id,
      name: f.name,
      count: snippets.value.filter(s => s.folderIds.includes(f.id)).length
    }))
  )


  // ════════════════════════════════════════════════════════
  //  片段 CRUD
  // ════════════════════════════════════════════════════════
  function addSnippet(snippet: Snippet) {
    snippets.value.unshift(snippet)
  }

  function updateSnippet(id: string, data: Partial<Snippet>) {
    const idx = snippets.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      snippets.value[idx] = { ...snippets.value[idx], ...data, updatedAt: new Date().toISOString() }
    }
  }

  function deleteSnippet(id: string) {
    snippets.value = snippets.value.filter(s => s.id !== id)
  }

  // AI 清空全部片段（仅在用户二次确认后调用）
  function clearAll() {
    snippets.value = []
  }


  // ════════════════════════════════════════════════════════
  //  AI 自动生成描述
  // ════════════════════════════════════════════════════════
  // 保存后异步补全 description，作为 AI 检索的语义依据；描述为空才生成、失败保持空串、UI 提供重试
  const generatingDescriptionIds = ref<string[]>([])

  function isGeneratingDescription(id: string) {
    return generatingDescriptionIds.value.includes(id)
  }

  async function ensureDescription(id: string) {
    const s = snippets.value.find(x => x.id === id)
    if (!s || s.description || isGeneratingDescription(id)) return
    generatingDescriptionIds.value.push(id)
    try {
      const desc = (await generateDescription(s.title, s.code, s.language)).trim()
      const current = snippets.value.find(x => x.id === id)
      // 生成期间片段可能被删除；用户可能在生成完成前手动填了描述
      if (current && !current.description && desc) {
        current.description = desc
      }
    } catch {
      // 生成失败保持空串，不打扰用户
    } finally {
      generatingDescriptionIds.value = generatingDescriptionIds.value.filter(x => x !== id)
    }
  }


  // ════════════════════════════════════════════════════════
  //  收藏夹 CRUD 与收藏关系
  // ════════════════════════════════════════════════════════
  // 收藏夹名重名拦截：新建/重命名共用；excludeId 用于重命名时排除自身
  function isFolderNameTaken(name: string, excludeId?: string): boolean {
    const trimmed = name.trim()
    return folders.value.some(f => f.id !== excludeId && f.name.trim() === trimmed)
  }

  function addFolder(name: string): string | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    if (isFolderNameTaken(trimmed)) return null
    const id = Date.now().toString()
    folders.value.push({ id, name: trimmed, createdAt: new Date().toISOString() })
    return id
  }

  function renameFolder(id: string, name: string) {
    const trimmed = name.trim()
    const f = folders.value.find(x => x.id === id)
    if (f && trimmed && !isFolderNameTaken(trimmed, id)) f.name = trimmed
  }

  function deleteFolder(id: string) {
    folders.value = folders.value.filter(f => f.id !== id)
    snippets.value.forEach(s => {
      if (s.folderIds.includes(id)) {
        s.folderIds = s.folderIds.filter(x => x !== id)
      }
    })
  }

  // 清空收藏夹：把所有片段移出该夹（片段本身不删除）
  function clearFolder(id: string) {
    snippets.value.forEach(s => {
      if (s.folderIds.includes(id)) {
        s.folderIds = s.folderIds.filter(x => x !== id)
      }
    })
  }

  // --- 收藏关系：folderIds 长在 snippet 上，收藏/移出实质都在改 snippets，故归属本 store ---
  function favoriteTo(snippetId: string, folderId: string) {
    const s = snippets.value.find(x => x.id === snippetId)
    if (s && !s.folderIds.includes(folderId)) s.folderIds.push(folderId)
  }

  function unfavoriteFrom(snippetId: string, folderId: string) {
    const s = snippets.value.find(x => x.id === snippetId)
    if (s) s.folderIds = s.folderIds.filter(id => id !== folderId)
  }


  // ════════════════════════════════════════════════════════
  //  批量选择与批量操作
  // ════════════════════════════════════════════════════════
  function toggleSelect(id: string) {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter(x => x !== id)
      : [...selectedIds.value, id]//展开数组追加id
  }

  function selectAll(ids: string[]) {
    selectedIds.value = [...ids]
  }

  function clearSelection() {
    selectedIds.value = []
  }

  // 幂等收藏：把选中片段都归入该夹，已在该夹的自动忽略，不存在"重复收藏"
  function batchFavoriteTo(folderId: string) {
    snippets.value.forEach(s => {
      if (selectedIds.value.includes(s.id) && !s.folderIds.includes(folderId)) {
        s.folderIds.push(folderId)
      }
    })
    clearSelection()
  }

  // 批量移出：把选中片段从该夹移除（收藏夹视图专用）
  function batchRemoveFrom(folderId: string) {
    snippets.value.forEach(s => {
      if (selectedIds.value.includes(s.id)) {
        s.folderIds = s.folderIds.filter(id => id !== folderId)
      }
    })
    clearSelection()
  }

  function batchDelete() {
    snippets.value = snippets.value.filter(s => !selectedIds.value.includes(s.id))
    clearSelection()
  }

  // 对外暴露：状态 / 筛选结果 / 片段 / 收藏夹 / 批量 / AI 描述操作方法
  return {
    snippets, folders, loading, searchQuery, filterType, filterValue, sortBy, sortDir,
    filteredSnippets, languageStats, folderStats,
    batchMode, selectedIds,
    setFilter,
    addSnippet, updateSnippet, deleteSnippet, clearAll,
    ensureDescription, isGeneratingDescription,
    addFolder, renameFolder, isFolderNameTaken, deleteFolder, clearFolder, favoriteTo, unfavoriteFrom, batchFavoriteTo,
    toggleSelect, selectAll, clearSelection, batchRemoveFrom, batchDelete
  }
})
