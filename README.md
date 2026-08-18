# AI 代码片段管理器

轻量级的代码片段收藏 / 浏览 / 编辑工具,**AI 深度集成**为差异化核心:对话式检索、库操作提议、代码生成与修改。

- **定位**:轻量代码保管,不做正式 IDE——所有设计围绕"存得方便、找得快、AI 帮你想"
- **纯前端实现**:localStorage 模拟后端,无需部署即可跑;数据完全归用户(JSON 导出备份)
- **无第三方 AI SDK**:手写 fetch + SSE 流式 + function calling,可讲底层原理

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Vue 3.5 `<script setup>` + TypeScript + Vite 8 |
| 状态 | Pinia |
| 路由 | Vue Router 4 |
| 样式 | TailwindCSS 4(zinc 骨架 + GitHub 蓝 `#0969DA`) |
| 编辑器 | Monaco Editor(**裁剪入口**:去掉 4 个语言服务 worker,dist 5.8MB) |
| AI | DeepSeek(OpenAI 兼容 API,SSE 流式) |
| 存储 | localStorage(数据:片段/收藏夹)+ sessionStorage(临时状态:草稿/AI 对话/滚动位置) |

## 快速开始

```bash
npm install
npm run dev      # 开发
npm run build    # 类型检查 + 构建
npm run preview  # 预览构建产物
```

启用 AI 功能(可选,不影响浏览):
1. 创建 `.env`(项目根目录),填入:
   ```
   VITE_AI_API_KEY=sk-你的key
   VITE_AI_MODEL=deepseek-v4-flash   # 可选,默认即可
   ```
2. 重新 `npm run dev`。

> ⚠️ 作品集阶段 key 暂放前端,演示可用;生产化需服务端代理(见《架构决策记录》D3)。

## 目录结构(入口地图)

```
src/
├── main.ts                 # 入口:注册 Pinia/router、浏览器空闲预热 Monaco
├── router/index.ts         # 路由表(4 个页面)
├── views/                  # 只放页面组件(index.vue),纯组装;零件全在 components/
│   ├── snippet-list/       # 路由 / —— 片段列表页 = 网站主界面(顶栏 + 站点导航 + 片段列表)
│   │   └── index.vue           # 顶栏内联 + 组装 SiteNav + 列表部件(自带滚动容器/返回顶部/批量操作)
│   ├── snippet-detail/     # 路由 /snippet/:id
│   │   └── index.vue           # 详情页:阅读 + 复制/导出/AI 入口
│   ├── snippet-editor/     # 路由 /snippet/new + /snippet/:id/edit
│   │   └── index.vue           # 新建/编辑页:Monaco + AI 生成抽屉
│   └── ai-assistant/       # 路由 /ai(KeepAlive 按组件名缓存)
│       └── index.vue           # AI 助手页(编排者):对话流 + 确认操作 + 双重确认,零件在 business/assistant/
├── components/             # 两层:global 通用基础 + business 业务组件(判断依据=换项目还能不能用)
│   ├── global/             # 通用基础组件(业务无关、跨项目可复用),按 UI 类别分子目录
│   │   ├── base/               # 原子小组件:AppIcon
│   │   ├── form/               # 表单控件:FontSizeControl / LanguageSelect
│   │   ├── feedback/           # 弹窗/空态反馈:ConfirmDialog / EmptyState
│   │   ├── search/             # 搜索/排序:SearchBar / SortMenu
│   │   ├── layout/             # 纯框架:PageHeader(页面顶栏) / BrandMark(列表页顶栏已内联进 snippet-list/index.vue)
│   │   └── content/            # 内容渲染:MarkdownText(净化防 XSS)
│   ├── business/           # 业务组件(直接操作片段/收藏夹领域对象),按业务域分
│   │   ├── snippet/            # 代码片段:SiteNav / SnippetCard / ListToolbar / BatchActionBar / AiGeneratePanel
│   │   ├── folder/             # 收藏夹:FolderPicker / NavFolders / FolderRow
│   │   └── assistant/          # AI 助手页零件:展示卡 props/emit + 功能块直连 store
│   │       ├── SnippetResultCard  搜索结果卡(语言色点+标题+AI 描述+代码预览)
│   │       ├── ModifyCard         AI 改代码卡(diff 二次确认,可另存/替换/导出)
│   │       ├── OperateCard        AI 库操作提议卡(12 种 op,danger 决定红/蓝配色)
│   │       ├── ThinkingFold       思考过程折叠面板(四步总结,缺失兜底 reasoning)
│   │       ├── ChatInputBar       底部输入区(错误/重试/上限/输入/换话题;defineExpose 聚焦)
│   │       └── WaitingIndicator   等待四步阶段指示(读 store phase/elapsed)
│   └── editor/             # Monaco 封装(第三方集成):MonacoEditor / MonacoLoading / DiffView / monaco.ts(裁剪入口)
├── stores/                 # Pinia
│   ├── snippetStore.ts         # 片段 + 收藏夹(watch deep 自动持久化)
│   └── aiAssistantStore.ts     # AI 对话状态(流式累积/阶段指示/库操作确认)
├── api/                    # AI 调用层(唯一 AI 入口,见 barrel ai.ts)
│   ├── ai.ts                  # barrel 出口
│   ├── client.ts              # 底层请求:SSE 流式/503 退避/AIError/function calling 工具
│   ├── tasks.ts               # 单项任务:chatAboutCode / generateDescription / generateCode / modifyCode
│   ├── assistant.ts           # AI 助手核心:两级召回 + 6 工具分发
│   └── assistantPrompt.ts     # prompt 组装(候选/历史/行为规则)
├── composables/            # useDraft(草稿)/ useMonacoAsync / useClickOutside / useEscape / useGoBack
├── services/               # 纯 TS,不依赖 Vue
│   ├── storage.ts              # localStorage/sessionStorage 读写 + 迁移
│   ├── seed.ts                 # 种子示例数据(首次使用注入)
│   ├── languages.ts            # 24 种语言清单
│   ├── sort.ts / file.ts / date.ts   # 排序 / 文件导入导出 / 日期格式化
├── types/                  # 领域类型(Snippet / Folder)
├── assets/  style.css      # 全局样式(zinc 层级 / 焦点环 / 过渡)
```

## 阅读路径(从哪开始)

**建议先跑起来点一遍**:`npm run dev` → 新建几个片段 → 玩搜索/排序/收藏 → 进 AI 助手问一句。对界面有了手感,读代码才有上下文。

然后按用户旅程追,每条线 **view → store → service/api**:

1. **片段列表页(最简单)**:`views/snippet-list/index.vue` → `snippetStore` → `services/storage` + `seed`——理解"store 是唯一数据源 + watch 自动持久化"
2. **新建/编辑**:`views/snippet-editor/index.vue` → `composables/useDraft`(草稿 + 未保存确认)→ `components/editor`(Monaco 封装 + 异步加载)
3. **详情页**:`views/snippet-detail/index.vue` → `api/tasks`(AI 生成描述)
4. **AI 助手(最复杂,最后啃)**:`views/ai-assistant/index.vue`(编排者)→ `components/business/assistant/`(6 个零件)→ `aiAssistantStore` → `api/assistant` → `api/client`——集中了最多的设计决策(两级召回、工具分发、错误体系);页面管流程,展示卡 props/emit,输入条/等待指示直连 store

**每读一个文件问三问**:① 它 import 了什么 / 导出什么 / 谁在用它?② 数据从哪来、往哪去?③ 我先猜它会怎么写,再验证——答不上就停下查,别硬读。

## AI 能力一览

- **对话式片段检索**:两级召回(本地关键词 Top25 进 prompt + 模型读全库内容自主分析),支持主观描述/属性/组合/追问
- **库操作提议**:删除/重命名/收藏/新建/清空/收藏夹管理/改描述语言——**AI 只提议、用户确认**,不可逆项双重确认
- **代码生成 / 修改**:按描述生成(diff 二次确认、可另存)
- **片段描述自动生成**:保存后异步补全,作为检索的语义依据
- **工程保障**:SSE 流式 + AbortController 中断 + 503 退避重试 + 错误码体系 + function calling(6 工具)

## 文档索引

| 文档 | 回答什么 |
|---|---|
| **README**(本文件) | 怎么读——定位/结构/路径 |
| **架构决策记录与执行计划.md** | 为什么这么做——设计决策 D1-D9 + 秋招备战(面试 Q&A) |
| **项目难点记录.md** | 踩过什么坑——难点因果 + 工程方法论(面试复习) |
