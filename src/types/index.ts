// ════════════════════════════════════════════════════════
// types/index.ts —— 领域模型：Snippet（代码片段）/ Folder（收藏夹），全项目数据结构的基座
// ════════════════════════════════════════════════════════
export interface Snippet {
  id: string
  title: string
  code: string
  language: string
  // 人话描述：用途/注意事项（代码表达不了的背景），AI 助手基于它理解片段
  description: string
  createdAt: string
  updatedAt: string
  folderIds: string[]
}

export interface Folder {
  id: string
  name: string
  createdAt: string
}
