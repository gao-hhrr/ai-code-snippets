// ════════════════════════════════════════════════════════
// services/date.ts —— 日期：相对时间 formatTime + 完整时间 formatFullTime + AI 候选标注 fmtDate + 最近 N 天判断 isWithinDays
// ════════════════════════════════════════════════════════

// 是否在最近 days 天内（列表页「最近一周」筛选与统计共用；非法日期返回 false）
export function isWithinDays(iso: string, days: number): boolean {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return false
  return t > Date.now() - days * 24 * 60 * 60 * 1000
}

// 列表卡片：今天显示 HH:mm，昨天显示「昨天」，今年显示 M/d，跨年带年份 yyyy/M/d
export function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayMs = 86400000
  if (d >= startOfToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (d >= new Date(startOfToday.getTime() - dayMs)) return '昨天'
  if (d.getFullYear() !== now.getFullYear()) {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

// 详情页完整时间：yyyy-MM-dd HH:mm
export function formatFullTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// AI prompt 候选日期标注（M/D）：候选行给模型看日期，让它能判断"最近添加的/最新的"这类无文本特征的查询。
// 没有日期信息时模型无从比较新旧，实测"最近添加的"返回空、"最新的那个"反问（都因无法判断而放弃）。
// 跨年（非今年）的日期带上年份，避免"创建于 5/12"分不清是哪年。
export function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  if (d.getFullYear() !== new Date().getFullYear()) {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}
