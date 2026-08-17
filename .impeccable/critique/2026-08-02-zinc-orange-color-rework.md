# Critique — 墨灰×焦橙配色改造评审

日期：2026-08-02
Method：dual-agent（Assessment A 设计评审 + Assessment B detector/浏览器证据，隔离并行）
目标：`src/**/*.vue/.ts/.css` + `index.html` + `public/favicon.svg`
状态：评审完成，快照存档

## 结论速览

Design Health Score：**78/100**
评审对象：zinc 冷灰骨架 + orange 焦橙点睛的整站配色改造（已构建通过、无旧色残留）。
整体判断：配色纪律性强、组件打磨密度高，但**强调色语义过载 + 主按钮对比度不达标 + 焦点可见性缺失**三项拖分。

## 评估详情

### Strengths
1. zinc 骨架层次（50/100/200 边框，900/700/500 墨阶）使用一致，`::selection` 焦橙是安静的签名细节 —— 配色是有意的，不是简单换皮。
2. 详情页打磨密度（自动高度 Monaco、底部操作栏、内联 AI 解释、流式 AI 输出、统一 diff、逐组件过渡动画）是作品集级别的加分项。
3. red 严格限用于破坏性操作，焦橙从不渗入删除/危险区 —— 面试官看得见的约束纪律。

### Priority Issues

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| 1 | **P1** | 主按钮 `bg-orange-600`(#EA580C)，白字对比 3.56:1 **不达 WCAG AA**；简报所述品牌色 #C2410C 实为 orange-700 | Sidebar:84, EmptyState:48/57, SnippetDetail:137, AiModifyPanel, FolderPicker:158, FolderRow:110, SnippetEditor:188 |
| 2 | **P1** | orange 语义过载（主操作/激活/收藏/AI/成功 toast/未保存点 六义）| Toast.vue:18, SnippetEditor.vue:176 |
| 3 | **P1** | 焦点可见性缺失：`focus:outline-none` 无替代 ring，多数按钮无 `focus-visible:ring` | SnippetEditor:126/128, FolderRow, SnippetCard 星, SearchBar 清除 |
| 4 | P2 | 两个 AI 主操作竞争：实底「AI 解释」vs 浅底「AI 优化」| SnippetDetail:137/142 |
| 5 | P2 | 批处理栏层级倒挂：「全选」orange 浅底比真正动作「收藏」更显眼 | BatchActionBar:58 |
| 6 | P2 | 图标系统泄漏：返回顶部是文本「↑」| App.vue:71 |
| 7 | P2 | orange-50 次级按钮 hover 不一致（orange-100 vs zinc-200）| SnippetDetail:142 vs BatchActionBar:58/AiModifyPanel:122 |
| 8 | P2 | 「激活态」三变体：Sidebar 带 font-medium+bg、FolderRow 无 font-medium、SidebarFolders 无 bg | Sidebar:99/139/155, FolderRow:131, SidebarFolders:147 |
| 9 | P3 | logo/favicon 是文字 glyph 非矢量 mark | BrandMark.vue:14, favicon.svg:3 |
| 10 | P3 | 原生未主题化 `<select>` 是唯一不协调控件 | SnippetEditor:128 |
| 11 | P3 | red 破坏性对比略低于 AA（text-red-500 on white 3.4:1）| SnippetDetail:156, ConfirmDialog:35 |
| 12 | P3 | input 边框 zinc-200 vs zinc-300 不统一 | SearchBar:35 |
| 13 | P3 | toast 成功态用焦橙承担"成功"语义，与 diff 绿区分割 | Toast.vue |

### Persona 红旗（面试官会注意的）
- 未主题化的原生 `<select>` 混在精修 Manrope/zinc 里
- 「↑」文本字形旁是整套 AppIcon SVG
- 品牌/favicon 用浏览器文本而非矢量 mark
- CJK 混排：Manrope 无中文字形，中文回落系统字体，混排时数字/中文字重观感不均

### 对比度核查（Agent B）
- 白字 on orange-600 = 3.56:1 ✗（按钮文本需 4.5:1）→ **改 orange-700(#C2410C) = 5.18:1 ✓**
- text-orange-700 on orange-50 = 4.88:1 ✓
- text-orange-600 on orange-50 = 3.35:1（图标可，正文 ✗）
- 星标 filled orange-600 vs unfilled zinc-400 区分清晰 ✓
- red：text-red-500 on white 3.4:1 ✗、白字 on red-500 3.9:1 ✗（P3，破坏性可接受）

### 残留扫描
- 旧色族（indigo/teal/emerald/amber/stone/neutral/gray）0 命中
- emoji 0 命中；bg-zinc-900 仅 ConfirmDialog 遮罩 `/30`
- red/green 范围正确：green 仅 DiffView，red 仅破坏性/DiffView
- detector 唯一警告 `DiffView.vue:12 border-l-4` 为 diff 行号边条误报

## Recommended Actions（按影响/成本排序）
1. **主按钮 orange-600→orange-700**（对品牌 #C2410C、过 AA、更"焦"）—— P1，改一次覆盖全站
2. **style.css 加全局 focus-visible ring 规则** —— 一处代码修所有键盘可达缺口
3. **orange 语义收窄**：未保存点→zinc/amber，成功 toast 保持焦橙
4. **AI 双主 CTA 收成单实底**；批处理栏实底给真正动作
5. **「↑」→ AppIcon arrow-up**（+1 个图标 path）
6. 收尾 `/impeccable polish` 过一遍细节

## 已修复（2026-08-02，用户确认全做）
1. ✅ 主按钮/品牌/checkbox 全部 `bg-orange-700`（hover→orange-800），白字对比 5.18:1 过 AA
2. ✅ style.css 全局 `:focus-visible` 焦橙环（box-shadow !important + 白间隔），并清理各组件冗余 focus 类
3. ✅ 未保存点 `text-zinc-400`，成功 toast 保持焦橙
4. ✅ AI 解释单实底、AI 优化降 zinc 浅底；批处理条「全选」降 zinc、「收藏」升焦橙
5. ✅ 「↑」→ AppIcon `arrow-up`（AppIcon +1 path）
6. ✅ 一致性：orange-50 hover 统一 orange-100；激活态三变体统一；输入边框统一 zinc-300

验证：`npm run build` 通过（2.22s）；detector 全绿；残留扫描干净。
