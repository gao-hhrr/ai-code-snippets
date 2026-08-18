// ════════════════════════════════════════════════════════
// services/seed.ts —— 首次使用示例数据：seedIfFirstUse 只注入一次，之后以用户数据为准
// ════════════════════════════════════════════════════════
import type { Snippet } from '@/types'
import { persistSnippets } from './storage'

const SEEDED_KEY = 'code-snippets:seeded'

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

// 首次使用写入示例数据（只写一次，之后以用户数据为准）
export function seedIfFirstUse(snippets: Snippet[]) {
  if (localStorage.getItem(SEEDED_KEY) === null) {
    demos.forEach(s => snippets.push(s))
    localStorage.setItem(SEEDED_KEY, '1')
    persistSnippets(snippets)
  }
}
