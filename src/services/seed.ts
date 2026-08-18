// ════════════════════════════════════════════════════════
// services/seed.ts —— 首次使用示例数据：seedIfFirstUse 只注入一次，之后以用户数据为准
// 32 条示例围绕前端热门方向（Vue/React/TS/JS/CSS/算法/SQL），方便演示 AI 功能也方便讲解
// ════════════════════════════════════════════════════════
import type { Snippet, Folder } from '@/types'
import { persistSnippets, persistFolders } from './storage'

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
    folderIds: ['utils']
  },
  {
    id: '2',
    title: 'Vue 组合式 API 请求封装',
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
    folderIds: ['frontend']
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
    folderIds: ['frontend']
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
    folderIds: ['utils']
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
    folderIds: ['algorithm']
  },
  {
    id: '6',
    title: 'SQL 按状态聚合统计订单',
    code: `-- 按订单状态分组统计数量与金额，日常报表高频查询
SELECT status, COUNT(*) AS count, SUM(total) AS amount
FROM orders
WHERE created_at >= '2026-08-01'
GROUP BY status
ORDER BY count DESC;`,
    language: 'SQL',
    description: 'GROUP BY + 聚合函数统计不同状态的订单数量与金额，基础但高频',
    createdAt: '2026-07-20T15:00:00Z',
    updatedAt: '2026-07-20T15:00:00Z',
    folderIds: ['database']
  },
  {
    id: '7',
    title: '事件循环输出顺序（经典题）',
    code: `// 经典面试题：说出下面的输出顺序
console.log('1: script start')

setTimeout(() => console.log('2: setTimeout'), 0)

Promise.resolve().then(() => console.log('3: promise 1'))
  .then(() => console.log('4: promise 2'))

queueMicrotask(() => console.log('5: microtask'))

console.log('6: script end')

// 答案：1 -> 6 -> 3 -> 4 -> 5 -> 2`,
    language: 'JavaScript',
    description: '考察事件循环：同步代码 → 微任务（Promise/queueMicrotask）→ 宏任务（setTimeout）的执行顺序',
    createdAt: '2026-08-16T09:00:00Z',
    updatedAt: '2026-08-16T09:00:00Z',
    folderIds: ['utils']
  },
  {
    id: '8',
    title: '闭包陷阱：var 循环变量',
    code: `// ⚠️ 这段代码有坑，可以让 AI 助手检查：输出什么？为什么？
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100)
}
// 期望 0,1,2，实际输出 3,3,3 —— 闭包捕获了同一个循环变量 i

// 修复 1：var 换 let
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100)
}
// 修复 2：立即执行函数包一层快照
for (var i = 0; i < 3; i++) {
  (j => setTimeout(() => console.log(j), 100))(i)
}`,
    language: 'JavaScript',
    description: '闭包捕获同一个循环变量的经典坑，var 声明导致所有回调读到最终值，展示 let 与 IIFE 两种修复',
    createdAt: '2026-08-17T10:00:00Z',
    updatedAt: '2026-08-17T10:00:00Z',
    folderIds: ['utils', 'default']
  },
  {
    id: '9',
    title: '函数柯里化 curry',
    code: `function curry(fn) {
  return function curried(...args) {
    if (args.length >= fn.length) {
      return fn(...args)
    }
    return (...next) => curried(...args, ...next)
  }
}

const add = (a, b, c) => a + b + c
const addCurried = curry(add)

console.log(addCurried(1)(2)(3))   // 6
console.log(addCurried(1, 2)(3))   // 6
console.log(addCurried(1)(2, 3))   // 6`,
    language: 'JavaScript',
    description: '把多参数函数转成逐个传参的柯里化形式，闭包保存已收集参数，参数凑齐再执行',
    createdAt: '2026-08-15T11:00:00Z',
    updatedAt: '2026-08-15T11:00:00Z',
    folderIds: ['utils']
  },
  {
    id: '10',
    title: 'Promise 并发控制（限流）',
    code: `// 并发控制：最多同时跑 limit 个任务
async function mapLimit(items, limit, fn) {
  const results = []
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (items.length) {
      const item = items.shift()
      results.push(await fn(item))
    }
  })
  await Promise.all(workers)
  return results
}

// 用法：10 个任务，最多 3 个并发
const output = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async n => {
  await new Promise(r => setTimeout(r, 100))
  return n * 2
})
console.log(output) // [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]`,
    language: 'JavaScript',
    description: '固定数量 worker 循环取任务实现并发上限控制，防止一次性打爆后端',
    createdAt: '2026-08-14T14:00:00Z',
    updatedAt: '2026-08-14T14:00:00Z',
    folderIds: ['utils']
  },
  {
    id: '11',
    title: 'Vue Router 登录守卫',
    code: `import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/Login.vue') },
    {
      path: '/dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { requiresAuth: true }
    }
  ]
})

// 全局前置守卫：未登录跳登录页并记录来源，登录后跳回原目标
router.beforeEach(to => {
  const token = localStorage.getItem('token')
  if (to.meta.requiresAuth && !token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.path === '/login' && token) {
    return '/dashboard'
  }
})`,
    language: 'TypeScript',
    description: '全局前置守卫做登录鉴权：未登录跳登录页并记录来源，登录后再跳回原目标',
    createdAt: '2026-08-13T09:00:00Z',
    updatedAt: '2026-08-13T09:00:00Z',
    folderIds: ['frontend']
  },
  {
    id: '12',
    title: 'provide/inject 跨层级共享',
    code: `import { provide, inject, ref, type Ref } from 'vue'

// 祖先组件：向整棵子树提供主题状态
const theme = ref<'light' | 'dark'>('light')
provide('theme', theme)

// 任意后代组件：注入使用，不用层层 props 透传
const theme = inject<Ref<'light' | 'dark'>>('theme')
function toggle() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
}

// 跨多层传递省去中间组件转发，配合 readonly 可避免误改
import { readonly } from 'vue'
provide('theme', readonly(theme))`,
    language: 'TypeScript',
    description: 'provide/inject 让祖先数据跨多层级注入到后代，替代繁琐的逐层 props 透传',
    createdAt: '2026-08-13T15:30:00Z',
    updatedAt: '2026-08-13T15:30:00Z',
    folderIds: ['frontend']
  },
  {
    id: '13',
    title: '自定义组件实现 v-model',
    code: `<template>
  <div class="counter">
    <button @click="dec">-</button>
    <span>{{ modelValue }}</span>
    <button @click="inc">+</button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const inc = () => emit('update:modelValue', props.modelValue + 1)
const dec = () => emit('update:modelValue', props.modelValue - 1)
</script>

<!-- 父组件用法：<Counter v-model="count" /> -->`,
    language: 'TypeScript',
    description: '自定义组件实现 v-model 双向绑定，父子数据通过 update:modelValue 事件同步',
    createdAt: '2026-08-16T10:30:00Z',
    updatedAt: '2026-08-16T10:30:00Z',
    folderIds: ['frontend']
  },
  {
    id: '14',
    title: 'TypeScript 工具类型 Pick/Omit',
    code: `interface User {
  id: number
  name: string
  email: string
  password: string
}

// 只取需要的字段返回给前端，排除敏感字段
type PublicUser = Omit<User, 'password'>

// 列表场景只要 id + name
type UserListItem = Pick<User, 'id' | 'name'>

const toPublic = (u: User): PublicUser => {
  const { password, ...rest } = u
  return rest
}`,
    language: 'TypeScript',
    description: 'Pick/Omit 从一个接口派生新类型，安全裁剪字段，避免重复定义相似结构',
    createdAt: '2026-08-12T09:30:00Z',
    updatedAt: '2026-08-12T09:30:00Z',
    folderIds: ['utils']
  },
  {
    id: '15',
    title: 'TypeScript 自定义类型守卫 is',
    code: `// 自定义类型守卫：把运行时判断告诉 TS，让窄化在分支里可靠生效
type Fish = { swim: () => void }
type Bird = { fly: () => void }

function isFish(pet: Fish | Bird): pet is Fish {
  return (pet as Fish).swim !== undefined
}

const pet: Fish | Bird = getPet()

if (isFish(pet)) {
  pet.swim() // TS 在这里知道它是 Fish
} else {
  pet.fly() // 自动收窄为 Bird
}`,
    language: 'TypeScript',
    description: 'pet is Fish 语法把类型收窄交给运行时判断，比 as 断言更安全，else 分支自动是另一类型',
    createdAt: '2026-08-15T09:30:00Z',
    updatedAt: '2026-08-15T09:30:00Z',
    folderIds: ['utils']
  },
  {
    id: '16',
    title: 'Axios 拦截器封装',
    code: `import axios from 'axios'

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE,
  timeout: 10000
})

// 请求拦截：自动带 token
http.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = \`Bearer \${token}\`
  return config
})

// 响应拦截：统一解包数据、统一处理 401
http.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err.response?.data?.message || '请求失败')
  }
)`,
    language: 'TypeScript',
    description: 'axios 实例 + 请求/响应双拦截器：自动带 token、401 统一登出、错误信息解包，全项目共用',
    createdAt: '2026-08-17T14:00:00Z',
    updatedAt: '2026-08-17T14:00:00Z',
    folderIds: ['frontend']
  },
  {
    id: '17',
    title: 'AbortController 请求取消',
    code: `// 搜索场景：新请求发出时取消上一个，避免过期结果覆盖新结果
let controller: AbortController | null = null

async function search(keyword: string) {
  controller?.abort()
  controller = new AbortController()

  try {
    const res = await fetch(\`/api/search?q=\${keyword}\`, {
      signal: controller.signal
    })
    render(await res.json())
  } catch (err) {
    if (err.name === 'AbortError') return // 主动取消，静默处理
    throw err
  }
}`,
    language: 'TypeScript',
    description: '用 AbortController 取消上一个未完成的请求，解决搜索竞态，过期响应不再覆盖新结果',
    createdAt: '2026-08-18T08:30:00Z',
    updatedAt: '2026-08-18T08:30:00Z',
    folderIds: ['frontend']
  },
  {
    id: '18',
    title: 'defineAsyncComponent 懒加载',
    code: `import { defineAsyncComponent } from 'vue'

// 组件懒加载：把组件代码拆成独立 chunk 按需加载，减少首屏体积
const Editor = defineAsyncComponent(() => import('@/components/Editor.vue'))

// 加载期间显示占位，配合 Suspense 使用
<template>
  <Suspense>
    <template #default><Editor /></template>
    <template #fallback><div>加载中...</div></template>
  </Suspense>
</template>`,
    language: 'TypeScript',
    description: 'defineAsyncComponent 把组件代码拆成独立 chunk 按需加载，优化首屏体积，配 Suspense 显示占位',
    createdAt: '2026-08-18T10:00:00Z',
    updatedAt: '2026-08-18T10:00:00Z',
    folderIds: ['frontend']
  },
  {
    id: '19',
    title: 'Flex 三栏经典布局',
    code: `/* 左右固定宽，中间自适应的三栏布局 */
.layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  flex: 0 0 200px;  /* 固定 200px，不放大不缩小 */
}

.content {
  flex: 1;          /* 占满剩余空间 */
  min-width: 0;     /* 防止长文本/表格撑破容器 */
}

.right-panel {
  flex: 0 0 240px;
}`,
    language: 'CSS',
    description: 'flex 三栏经典布局：flex:1 自适应 + min-width:0 防止长内容撑破容器',
    createdAt: '2026-08-14T10:00:00Z',
    updatedAt: '2026-08-14T10:00:00Z',
    folderIds: ['frontend']
  },
  {
    id: '20',
    title: '二分查找（闭区间写法）',
    code: `// 有序数组二分查找，每次排除一半，O(log n)
function binarySearch(arr, target) {
  let left = 0
  let right = arr.length - 1

  while (left <= right) {
    const mid = (left + right) >> 1
    if (arr[mid] === target) return mid
    if (arr[mid] < target) left = mid + 1
    else right = mid - 1
  }
  return -1
}

console.log(binarySearch([1, 3, 5, 7, 9], 7)) // 3`,
    language: 'JavaScript',
    description: '有序数组二分查找，每次排除一半 O(log n)，闭区间 while(left<=right) 是最好记的写法',
    createdAt: '2026-08-12T14:00:00Z',
    updatedAt: '2026-08-12T14:00:00Z',
    folderIds: ['algorithm']
  },
  {
    id: '21',
    title: '两数之和（哈希表最优解）',
    code: `// 经典：找出数组中和为目标值的两个下标，O(n)
function twoSum(nums, target) {
  const seen = new Map()
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i]
    if (seen.has(need)) return [seen.get(need), i]
    seen.set(nums[i], i)
  }
  return []
}

console.log(twoSum([2, 7, 11, 15], 9)) // [0, 1]`,
    language: 'JavaScript',
    description: '用哈希表把双重循环降为单次遍历，空间换时间 O(n)，两数之和的最优解',
    createdAt: '2026-08-11T09:00:00Z',
    updatedAt: '2026-08-11T09:00:00Z',
    folderIds: ['algorithm']
  },
  {
    id: '22',
    title: 'Vue 3 Pinia store 组合式写法',
    code: `import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useCounterStore = defineStore('counter', () => {
  const count = ref(0)
  const double = computed(() => count.value * 2)

  function increment() { count.value++ }
  function reset() { count.value = 0 }

  return { count, double, increment, reset }
})`,
    language: 'TypeScript',
    description: '组合式写法定义 Pinia store，setup 风格比 options 更贴合 TypeScript 类型推导',
    createdAt: '2026-07-26T11:00:00Z',
    updatedAt: '2026-07-26T11:00:00Z',
    folderIds: ['frontend']
  },
  {
    id: '23',
    title: 'Vue 自定义指令 v-debounce',
    code: `import type { Directive } from 'vue'

const vDebounce: Directive<HTMLInputElement, number> = {
  mounted(el, binding) {
    let timer: ReturnType<typeof setTimeout>
    el.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        el.dispatchEvent(new Event('change'))
      }, binding.value ?? 300)
    })
  }
}

export default vDebounce`,
    language: 'TypeScript',
    description: '全局指令实现输入防抖，模板里 v-debounce="500" 直接用，不用每个组件写一遍',
    createdAt: '2026-07-24T10:20:00Z',
    updatedAt: '2026-07-24T10:20:00Z',
    folderIds: ['frontend']
  },
  {
    id: '24',
    title: 'Vue Teleport 模态框组件',
    code: `<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="modal-mask" @click.self="$emit('close')">
        <div class="modal-panel">
          <slot />
          <button @click="$emit('close')">关闭</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()
</script>`,
    language: 'TypeScript',
    description: 'Teleport 把模态框渲染到 body，规避父级 overflow/层级上下文，配合 Transition 做淡入淡出',
    createdAt: '2026-07-22T09:40:00Z',
    updatedAt: '2026-07-22T09:40:00Z',
    folderIds: ['frontend']
  },
  {
    id: '25',
    title: '节流函数 throttle',
    code: `function throttle<T extends (...args: any[]) => any>(fn: T, limit: number) {
  let lastCall = 0
  return (...args: Parameters<T>) => {
    const now = Date.now()
    if (now - lastCall >= limit) {
      lastCall = now
      fn(...args)
    }
  }
}`,
    language: 'TypeScript',
    description: '控制函数执行频率，滚动/窗口缩放等高频事件里限制回调次数，与防抖互补',
    createdAt: '2026-07-20T09:00:00Z',
    updatedAt: '2026-07-20T09:00:00Z',
    folderIds: ['utils']
  },
  {
    id: '26',
    title: 'TypeScript 深拷贝',
    code: `export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => deepClone(v)) as T
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (value instanceof RegExp) return new RegExp(value) as T
  const clone: Record<string, unknown> = {}
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      clone[key] = deepClone((value as Record<string, unknown>)[key])
    }
  }
  return clone as T
}`,
    language: 'TypeScript',
    description: '递归深拷贝，处理数组/Date/RegExp 等类型，避免引用共享导致修改互相影响',
    createdAt: '2026-07-18T15:30:00Z',
    updatedAt: '2026-07-18T15:30:00Z',
    folderIds: ['utils']
  },
  {
    id: '27',
    title: '浅拷贝踩坑：展开运算符只拷贝一层',
    code: `// ⚠️ 这段代码有隐患，可以让 AI 助手帮你检查
const copy = obj => ({ ...obj })

const original = { a: 1, nested: { b: 2 } }
const cloned = copy(original)
cloned.nested.b = 99

console.log(original.nested.b) // 99，原对象被意外改了`,
    language: 'JavaScript',
    description: '对象展开只做浅拷贝，修改嵌套对象会影响原对象，经典引用共享问题',
    createdAt: '2026-08-17T16:00:00Z',
    updatedAt: '2026-08-17T16:00:00Z',
    folderIds: ['utils', 'default']
  },
  {
    id: '28',
    title: 'JavaScript 事件委托',
    code: `// 列表点击事件委托：父元素统一处理，避免给每个 li 单独绑定
document.querySelector('#list').addEventListener('click', e => {
  const item = e.target.closest('li')
  if (!item) return
  console.log('点击了', item.dataset.id)
})`,
    language: 'JavaScript',
    description: '把子元素事件上抛到父级统一处理，动态新增的 li 也自动生效',
    createdAt: '2026-07-16T17:20:00Z',
    updatedAt: '2026-07-16T17:20:00Z',
    folderIds: ['frontend']
  },
  {
    id: '29',
    title: 'CSS 响应式卡片网格',
    code: `.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
  padding: 1rem;
}

.card {
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}`,
    language: 'CSS',
    description: 'auto-fill + minmax 自适应列数，不用写媒体查询也能在小屏自动降为单列',
    createdAt: '2026-07-14T13:00:00Z',
    updatedAt: '2026-07-14T13:00:00Z',
    folderIds: ['frontend']
  },
  {
    id: '30',
    title: 'CSS 暗色模式适配',
    code: `:root {
  --bg: #ffffff;
  --text: #1f2937;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111827;
    --text: #f9fafb;
  }
}

body {
  background: var(--bg);
  color: var(--text);
}`,
    language: 'CSS',
    description: '用 CSS 变量 + prefers-color-scheme 跟随系统自动切换明暗主题',
    createdAt: '2026-07-12T11:10:00Z',
    updatedAt: '2026-07-12T11:10:00Z',
    folderIds: ['utils']
  },
  {
    id: '31',
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
    createdAt: '2026-07-10T08:45:00Z',
    updatedAt: '2026-07-10T08:45:00Z',
    folderIds: ['frontend']
  },
  {
    id: '32',
    title: 'React 请求竞态守卫',
    code: `import { useEffect, useState } from 'react'

function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then(res => res.json())
      .then(json => { if (!cancelled) setData(json) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [url])

  return { data, loading }
}`,
    language: 'React',
    description: '用 cancelled 标志守卫异步结果，组件卸载后不再 setState，规避 React 竞态更新警告',
    createdAt: '2026-07-08T08:30:00Z',
    updatedAt: '2026-07-08T08:30:00Z',
    folderIds: ['frontend']
  }
]

// 示例收藏夹：与片段 folderIds 对应，侧边栏「按收藏夹」筛选的数据来源
const demoFolders: Folder[] = [
  { id: 'default', name: '默认收藏夹', createdAt: '2026-07-01T00:00:00Z' },
  { id: 'frontend', name: '前端', createdAt: '2026-07-01T00:00:00Z' },
  { id: 'algorithm', name: '算法', createdAt: '2026-07-01T00:00:00Z' },
  { id: 'database', name: '数据库', createdAt: '2026-07-01T00:00:00Z' },
  { id: 'utils', name: '实用工具', createdAt: '2026-07-01T00:00:00Z' }
]

// 首次使用写入示例数据（只写一次，之后以用户数据为准）
export function seedIfFirstUse(snippets: Snippet[], folders: Folder[]) {
  if (localStorage.getItem(SEEDED_KEY) === null) {
    demos.forEach(s => snippets.push(s))
    demoFolders.forEach(f => folders.push(f))
    localStorage.setItem(SEEDED_KEY, '1')
    persistSnippets(snippets)
    persistFolders(folders)
  }
}
