// ════════════════════════════════════════════════════════
// services/storage.ts —— 本地持久化：片段/收藏夹（localStorage）+ AI 对话（sessionStorage）+ migrateData 数据迁移
// ════════════════════════════════════════════════════════
// 首次示例数据见 seed.ts，migrateData 负责老数据结构升级。
import type { Snippet, Folder } from '@/types'
import type { AssistantTurnMessage } from '@/api/ai'

const STORAGE_KEY = 'code-snippets:snippets'
const FOLDERS_KEY = 'code-snippets:folders'
const AI_CONVERSATION_KEY = 'code-snippets:ai-conversation'

// localStorage 读写统一封装：JSON 解析/序列化 + 失败静默兜底
function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const data = JSON.parse(raw)
    return (Array.isArray(data) ? data : fallback) as T
  } catch {
    return fallback
  }
}

function setJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 忽略存储失败
  }
}

export function loadSnippets(): Snippet[] {
  return getJSON<Snippet[]>(STORAGE_KEY, [])
}

export function loadFolders(): Folder[] {
  return getJSON<Folder[]>(FOLDERS_KEY, [])
}

export function persistSnippets(snippets: Snippet[]) {
  setJSON(STORAGE_KEY, snippets)
}

export function persistFolders(folders: Folder[]) {
  setJSON(FOLDERS_KEY, folders)
}

// 一次性迁移：旧的 isFavorited 收藏 → 「默认收藏夹」，规范化 folderIds，补 description。
// 就地修改传入数组；有变化时自行持久化
export function migrateData(snippets: Snippet[], folders: Folder[]) {
  let snippetsChanged = false
  snippets.forEach(s => {
    const anyS = s as any
    const hasFolderIds = Array.isArray(s.folderIds)
    if (anyS.isFavorited !== undefined || !hasFolderIds) snippetsChanged = true
    let folderIds = hasFolderIds ? [...s.folderIds] : []
    if (anyS.isFavorited === true && !folderIds.includes('default')) {
      folderIds.push('default')
    }
    delete anyS.isFavorited
    s.folderIds = folderIds
    // 老数据没有 description（AI 分析依赖的元信息字段）→ 补空串
    if (typeof s.description !== 'string') {
      s.description = ''
      snippetsChanged = true
    }
  })

  // 片段引用了不存在的收藏夹时补建（旧收藏 / demo 的 default）
  let foldersChanged = false
  const referenced = new Set<string>()
  snippets.forEach(s => s.folderIds.forEach(id => referenced.add(id)))
  referenced.forEach(id => {
    if (!folders.some(f => f.id === id)) {
      folders.push({
        id,
        name: id === 'default' ? '默认收藏夹' : id,
        createdAt: new Date().toISOString()
      })
      foldersChanged = true
    }
  })

  if (snippetsChanged) persistSnippets(snippets)
  if (foldersChanged) persistFolders(folders)
}

// AI 助手对话持久化：与编辑器草稿同策略（sessionStorage，临时会话状态）——整段对话
// （含思考流/修改结果/操作状态）写进 sessionStorage：刷新、页面跳转、返回都保留，
// 但关掉标签页自动清空。对话是临时状态不是数据，与片段/收藏夹（localStorage 长期保存）区分开。

export function loadAIConversation(): AssistantTurnMessage[] {
  try {
    const raw = sessionStorage.getItem(AI_CONVERSATION_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function persistAIConversation(messages: AssistantTurnMessage[]) {
  try {
    sessionStorage.setItem(AI_CONVERSATION_KEY, JSON.stringify(messages))
  } catch (err) {
    // 写入失败（配额/隐私模式等）：不静默，控制台定位是写入失败而非渲染/恢复问题
    console.warn('[ai-persist] AI 对话写入 sessionStorage 失败', err)
  }
}
