// ════════════════════════════════════════════════════════
// services/file.ts —— 文件导入/导出：上传按扩展名识别语言（detectLanguage）+ 导出下载（langToExt/downloadText）
// ════════════════════════════════════════════════════════

// 语言 → 导出文件扩展名；未收录的归 .txt
const langExt: Record<string, string> = {
  python: 'py', javascript: 'js', typescript: 'ts', react: 'jsx', vue: 'vue',
  css: 'css', html: 'html', json: 'json', shell: 'sh', markdown: 'md',
  java: 'java', go: 'go', rust: 'rs', ruby: 'rb', php: 'php',
  swift: 'swift', kotlin: 'kt', c: 'c', 'c++': 'cpp', 'c#': 'cs',
  yaml: 'yaml', sql: 'sql', r: 'r'
}

export function langToExt(language: string): string {
  return langExt[language.toLowerCase()] || 'txt'
}

export function downloadText(text: string, filename: string, ext = 'txt') {
  // 标题可能带 Windows 非法字符（/ \ : * ? " < > | 与控制符）或首尾点/空格：
  // 非法字符会让保存名被系统截断，首尾点会被 Windows 吃掉导致后缀丢失 → 全部清洗后再拼后缀。
  // 控制符用 RegExp 构造（\\x00-\\x1f）避免在源码里写裸控制字符
  const safeName = filename
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(new RegExp('[\\x00-\\x1f]', 'g'), '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim() || 'snippet'
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 在 Firefox 会中断尚未开始的下载，延迟释放
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 上传文件时按扩展名识别语言；识别不了归为 Other
const extensionMap: Record<string, string> = {
  js: 'JavaScript', jsx: 'React', ts: 'TypeScript', tsx: 'TypeScript',
  vue: 'Vue', css: 'CSS', scss: 'CSS', less: 'CSS',
  html: 'HTML', htm: 'HTML', py: 'Python', json: 'JSON',
  sh: 'Shell', bash: 'Shell', md: 'Markdown', java: 'Java',
  go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP',
  swift: 'Swift', kt: 'Kotlin',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', cs: 'C#',
  yml: 'YAML', yaml: 'YAML', sql: 'SQL', kql: 'SQL',
  r: 'R'
}

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return extensionMap[ext] || 'Other'
}
