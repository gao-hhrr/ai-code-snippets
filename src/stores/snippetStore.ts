import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Snippet, Folder } from '@/types'
import { compareSnippets } from '@/services/sort'
import type { SortBy, SortDir } from '@/services/sort'
import { generateDescription } from '@/api/ai'
import {
  loadSnippets, loadFolders, persistSnippets, persistFolders, seedIfFirstUse, migrateData
} from '@/services/storage'

// 排序类型定义在 services/sort.ts，这里 re-export 保持既有引用（SortMenu）不变
export type { SortBy, SortDir } from '@/services/sort'
export type FilterType = 'all' | 'language' | 'favorites' | 'recent'

export const useSnippetStore = defineStore('snippet', () => {
  const snippets = ref<Snippet[]>(loadSnippets())
  const folders = ref<Folder[]>(loadFolders())
  const loading = ref(false)
  const searchQuery = ref('')
  const filterType = ref<FilterType>('all')
  const filterValue = ref('')
  // 排序不持久化：每次进入页面默认「最近更新 ↓」，会话内切换即时生效
  const sortBy = ref<SortBy>('updated')
  const sortDir = ref<SortDir>('desc')
  // 没有显式"批量模式"：有选中片段即视为批量态（底部操作条随之出现）
  const batchMode = computed(() => selectedIds.value.length > 0)
  const selectedIds = ref<string[]>([])

  // 首次使用写入示例数据（只写一次，之后以用户数据为准）
  seedIfFirstUse(snippets.value)
  // 一次性迁移：旧的 isFavorited 收藏 → 「默认收藏夹」，并规范化 folderIds
  migrateData(snippets.value, folders.value)

  watch(snippets, persistSnippets, { deep: true })
  watch(folders, persistFolders, { deep: true })

  function setFilter(type: FilterType, value = '') {
    // 切换筛选即清空选择，避免跨视图残留批量操作栏
    selectedIds.value = []
    filterType.value = type
    filterValue.value = value
    searchQuery.value = ''
  }

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

    // 排序（拷贝后原地 sort，避免误改 snippets 原数组）；比较逻辑见 services/sort.ts
    result = [...result].sort((a, b) => compareSnippets(a, b, sortBy.value, sortDir.value))

    return result
  })

  const languageStats = computed(() => {
    const map = new Map<string, number>()
    snippets.value.forEach(s => {
      map.set(s.language, (map.get(s.language) || 0) + 1)
    })
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  })

  const folderStats = computed(() =>
    folders.value.map(f => ({
      id: f.id,
      name: f.name,
      count: snippets.value.filter(s => s.folderIds.includes(f.id)).length
    }))
  )

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

  // --- AI 自动生成描述（保存后异步调用，不阻塞跳转）---
  // 描述为空才生成；已在生成中的不重复触发；失败保持空串，UI 提供重试
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

  // --- 收藏夹 ---
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

  function favoriteTo(snippetId: string, folderId: string) {
    const s = snippets.value.find(x => x.id === snippetId)
    if (s && !s.folderIds.includes(folderId)) s.folderIds.push(folderId)
  }

  function unfavoriteFrom(snippetId: string, folderId: string) {
    const s = snippets.value.find(x => x.id === snippetId)
    if (s) s.folderIds = s.folderIds.filter(id => id !== folderId)
  }

  // --- 批量选择 ---
  function toggleSelect(id: string) {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter(x => x !== id)
      : [...selectedIds.value, id]
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
