import type { Snippet, Folder } from '@/types'
import type { AssistantTurnMessage } from '@/api/ai'

const STORAGE_KEY = 'code-snippets:snippets'
const FOLDERS_KEY = 'code-snippets:folders'
const SEEDED_KEY = 'code-snippets:seeded'

// 首次使用写入的示例数据（只写一次，之后以用户数据为准）
const demos: Snippet[] = [
  {
    id: '1',
    title: '防抖函数 debounce',
    code: `function debounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}`,
    language: 'TypeScript',
    description: '按钮快速连续点击时只触发最后一次回调，常用于输入框联想搜索',
    createdAt: '2026-07-30T08:00:00Z',
    updatedAt: '2026-07-30T08:00:00Z',
    folderIds: []
  },
  {
    id: '2',
    title: 'Vue 组合式 API 示例',
    code: `import { ref, onMounted } from 'vue'

export function useFetch<T>(url: string) {
  const data = ref<T | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)

  onMounted(async () => {
    try {
      const res = await fetch(url)
      data.value = await res.json()
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  })

  return { data, error, loading }
}`,
    language: 'TypeScript',
    description: '页面加载后自动请求接口并返回响应式数据，带 loading/error 状态',
    createdAt: '2026-07-29T10:00:00Z',
    updatedAt: '2026-07-29T10:00:00Z',
    folderIds: ['default']
  },
  {
    id: '3',
    title: 'CSS 渐变背景',
    code: `.gradient-bg {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.animated-gradient {
  background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
  background-size: 400% 400%;
  animation: gradient 15s ease infinite;
}

@keyframes gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}`,
    language: 'CSS',
    description: '页面背景用的渐变配色，静态渐变和带动画流动的两种效果',
    createdAt: '2026-07-28T14:00:00Z',
    updatedAt: '2026-07-28T14:00:00Z',
    folderIds: []
  },
  {
    id: '4',
    title: 'JavaScript 数组去重',
    code: `// 数组去重：利用 Set 特性，一行搞定
const unique = arr => [...new Set(arr)]

console.log(unique([1, 2, 2, 3, 3, 3])) // [1, 2, 3]`,
    language: 'JavaScript',
    description: '利用 Set 的去重特性一行实现数组去重，常用于接口数据清洗',
    createdAt: '2026-08-05T10:00:00Z',
    updatedAt: '2026-08-05T10:00:00Z',
    folderIds: []
  },
  {
    id: '5',
    title: 'Python 快速排序',
    code: `def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)`,
    language: 'Python',
    description: '经典分治排序算法，平均复杂度 O(n log n)，面试常考',
    createdAt: '2026-08-03T09:30:00Z',
    updatedAt: '2026-08-03T09:30:00Z',
    folderIds: []
  },
  {
    id: '6',
    title: 'SQL 查询最近一周订单',
    code: `SELECT u.name, o.total, o.created_at
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
ORDER BY o.created_at DESC
LIMIT 50;`,
    language: 'SQL',
    description: '联表查询最近一周订单，按时间倒序取前 50 条',
    createdAt: '2026-07-20T15:00:00Z',
    updatedAt: '2026-07-20T15:00:00Z',
    folderIds: []
  },
  {
    id: '7',
    title: 'Shell 批量重命名文件',
    code: `# 给当前目录所有 .txt 文件加上 _backup 后缀
for f in *.txt; do
  mv "$f" "\${f%.txt}_backup.txt"
done`,
    language: 'Shell',
    description: '用参数替换循环重命名，文件名带空格时务必加引号',
    createdAt: '2026-07-15T11:20:00Z',
    updatedAt: '2026-07-15T11:20:00Z',
    folderIds: ['default']
  },
  {
    id: '8',
    title: 'Java 单例（双重检查锁）',
    code: `public class Singleton {
    private static volatile Singleton instance;

    private Singleton() {}

    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}`,
    language: 'Java',
    description: '双重检查锁 + volatile 保证懒加载下的线程安全单例',
    createdAt: '2026-06-25T09:00:00Z',
    updatedAt: '2026-06-25T09:00:00Z',
    folderIds: []
  },
  {
    id: '9',
    title: 'Go 并发 Worker 池',
    code: `func workerPool(tasks <-chan int, results chan<- int) {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for t := range tasks {
                results <- t * 2
            }
        }()
    }
    wg.Wait()
    close(results)
}`,
    language: 'Go',
    description: '固定 4 个 worker 从任务通道取任务处理，全部完成后关闭结果通道',
    createdAt: '2026-06-10T16:40:00Z',
    updatedAt: '2026-06-10T16:40:00Z',
    folderIds: []
  },
  {
    id: '10',
    title: 'Rust 读取文件并传播错误',
    code: `use std::fs;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let content = fs::read_to_string("config.toml")?;
    println!("{} 行", content.lines().count());
    Ok(())
}`,
    language: 'Rust',
    description: '用 ? 运算符把错误向上传播，main 返回 Result 简洁处理文件读取',
    createdAt: '2026-05-30T13:10:00Z',
    updatedAt: '2026-05-30T13:10:00Z',
    folderIds: []
  },
  {
    id: '11',
    title: 'C++ 智能指针 unique_ptr',
    code: `#include <memory>
#include <iostream>

int main() {
    auto ptr = std::make_unique<int>(42);
    std::cout << *ptr << std::endl;
    // 离开作用域自动释放，无需手动 delete
    return 0;
}`,
    language: 'C++',
    description: 'unique_ptr 独占所有权，离开作用域自动释放内存，杜绝内存泄漏',
    createdAt: '2025-05-12T10:30:00Z',
    updatedAt: '2025-05-12T10:30:00Z',
    folderIds: ['default']
  },
  {
    id: '12',
    title: 'React useDebounce Hook',
    code: `import { useState, useEffect } from 'react'

function useDebounce<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}`,
    language: 'React',
    description: '自定义 Hook 延迟更新值，搜索框输入防抖常用',
    createdAt: '2025-04-28T08:45:00Z',
    updatedAt: '2025-04-28T08:45:00Z',
    folderIds: []
  }
]

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function loadFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function persistSnippets(snippets: Snippet[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets))
  } catch {
    // 忽略存储失败
  }
}

export function persistFolders(folders: Folder[]) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
  } catch {
    // 忽略存储失败
  }
}

// 首次使用写入示例数据（只写一次，之后以用户数据为准）
export function seedIfFirstUse(snippets: Snippet[]) {
  if (localStorage.getItem(SEEDED_KEY) === null) {
    demos.forEach(s => snippets.push(s))
    localStorage.setItem(SEEDED_KEY, '1')
    persistSnippets(snippets)
  }
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

// --- AI 助手对话持久化：与编辑器草稿同策略（sessionStorage，临时会话状态）---
// 整段对话（含思考流/修改结果/操作状态）写进 sessionStorage：刷新、页面跳转、返回都保留，
// 但关掉标签页自动清空——对话是临时状态不是数据，与片段/收藏夹（localStorage 长期保存）区分开。
// 配额超限时静默放弃落盘，不影响正常使用
const AI_CONVERSATION_KEY = 'code-snippets:ai-conversation'

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
  } catch {
    // 忽略存储失败
  }
}
