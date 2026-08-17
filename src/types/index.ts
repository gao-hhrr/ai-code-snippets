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
