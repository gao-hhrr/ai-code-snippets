// ════════════════════════════════════════════════════════
// services/sort.ts —— 片段排序比较 compareSnippets：按更新时间/创建时间/标题（中文转拼音混排），asc/desc
// ════════════════════════════════════════════════════════
import { pinyin } from 'pinyin-pro'
import type { Snippet } from '@/types'

export type SortBy = 'updated' | 'created' | 'title'
export type SortDir = 'asc' | 'desc'

// 统一"正向比较"（时间类旧的在前、首字母 A-Z），desc 时整体反向。
// 不能对"自然方向"取反：首字母的自然方向是 asc，取反会变成 Z-A（方向颠倒的 bug）。
// 标题排序把中文转拼音（无声调）再与英文统一按字母混排，
// 避免 localeCompare('zh') 把汉字拼音段整体排在拉丁字母段前面导致中英不混排。
export function compareSnippets(a: Snippet, b: Snippet, by: SortBy, dir: SortDir): number {
  const d = dir === 'asc' ? 1 : -1
  if (by === 'created') {
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * d
  }
  if (by === 'title') {
    const ka = pinyin(a.title, { toneType: 'none' }).toLowerCase()
    const kb = pinyin(b.title, { toneType: 'none' }).toLowerCase()
    return (ka < kb ? -1 : ka > kb ? 1 : 0) * d
  }
  return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * d
}
