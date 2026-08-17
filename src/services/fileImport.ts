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
