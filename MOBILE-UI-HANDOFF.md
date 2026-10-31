# 移动端 UI / 交互改造交接文档

**日期**：2026-10-28 起，最后一轮 2026-10-29
**范围**：移动端信息架构、触控目标、安全区、文字可读性、错误提示、分板编辑、页面去重；桌面尺寸契约、错误边界、上传门槛
**依据规范**：`ios-design-guidelines`（Apple HIG）+ `ui-ux-pro-max`（UX 规则库）
**协作文档**：与 `GEMINI-UI-HANDOFF.md` 并列，那份讲"下一轮 UI 优化"的边界，这份讲"已经改了什么"。

> **二十轮改动**，按下表跳转。只看结论读第 1 节；准备动手改代码先读第 5 节（测试契约）和第 7 节（未完成）。

| 轮次 | 章节 | 主题 |
|---|---|---|
| 1 | 1–9 | 补基础：安全区、100dvh、触控 ≥44、字号 ≥11px、底部三层压成两层 |
| 2 | 10 | 首屏压缩、绘制缩放、iOS 输入框 16px、面板全宽 |
| 3 | 11 | 画布改为「按板编辑」，对标分版导出 |
| 4 | 12 | 色卡失败提示可关闭 |
| 5 | 13 | 迁移到正确版目录 + 分版标尺修复 |
| 6 | 14 | 分板导航从遮挡画布的浮层搬到停靠标签条 |
| 7 | 15 | 转图页入口收敛：一个返回、一个主操作（含 15.3b：无图时按钮直接唤起选择器） |
| 8 | 16 | 参数表去重：转图 tab 是唯一归属 |
| 9 | 17 | 底栏「更多」改名「工具箱」 |
| 10 | 18 | 去掉「导入项目 JSON / 导出项目 JSON」（全链路） |
| 11 | 19 | 移动端首页移除社区作品/创作者（连请求一起停） |
| 12 | 20 | 导航栏高度契约化：内容不再被底部导航压住 |
| 13 | 21 | 移动端控件尺寸与字号统一（12/13/14/16 × 44/48） |
| 14 | 22 | 原生下拉换成自绘底部选择面板 |
| 15 | 23 | PC 端从移动端改动里摘出来（桌面字号/尺寸隔离） |
| 16 | 24.1–24.7 | 侧栏面板尺寸收进一套尺度（下拉框 20px→32px） |
| 17 | 24.8 | 主按钮被 flex 压成 16px：禁止整列收缩 + 自绘复选框 |
| 18 | 24.9 | 桌面/移动隔离现状 + 真浏览器尺寸契约（会响的警报） |
| 19 | 24.10 | 风险防控：错误边界、上传门槛、提示条全局化、verify 脚本 |
| 20 | 25 | 三处空间压缩：移动端用量卡横排、社区卡片与页头收紧 |

**当前基线（2026-10-29 22:40）**：

- `tsc --noEmit` 通过，`vite build` 通过（6.8s，仅 chunk 体积警告）；
- **非浏览器**：`1445 passed / 1 skipped`（117 文件）；
- **浏览器类**：10 文件 / 40 条，**必须成组跑**。

```bash
npm run test:serial   # vitest run --no-file-parallelism
npm run verify        # tsc --noEmit && vite build && vitest run --no-file-parallelism
```

> 全量并发跑时，带 Chrome 的用例会互相抢端口，报 `Server.httpServer.listen` 失败，
> 一次挂 3–5 个**文件**（注意：是文件级失败，`Tests` 计数里看不到失败用例）。
> 判读顺序：先看是不是 `listen`，是就成组重跑，别当回归。

> 各轮小节里出现的 `1483 / 1484 / 1492 passed` 都是**那一轮**的记录，不是最新基线，别拿它判断现状。

**这份文档怎么维护（重要）**

| 区段 | 性质 | 规则 |
|---|---|---|
| 第 0–9 节 | **现状**（唯一真相） | 每次改动**就地更新**：改哪个文件就改第 2 节那一行，加了契约就改第 5 节表，基线变了就改顶部数字。**不许再追加「补记」表** |
| 第 10 节起 | **轮次记录**（历史） | 只追加、不改写。用来回答「为什么是现在这样」，不承担「现在是什么」的职责 |

> 之前犯过的错：第 10–19 轮的改动只写进了末尾的新章节，前面的「改动总览」停在 9 轮，
> 于是又补了一张「第 10–19 轮」的表——同一份文档里两套事实，读的人不知道该信哪个。
> 现在已合并成第 2 节一张表。

---

## 现状速查（2026-10-29 收盘；移动 390×844、桌面 1440×1024 实测）

**画布页**从上到下的分层，单位 px：

| 层 | 高度 | 说明 |
|---|---|---|
| 色卡横幅 | 57 | **仅当品牌目录读取失败时出现**，可 × 关闭；正常不占位 |
| 头部 `MobileHeaderNav` | 57 | 返回 / 图纸名 / 通知 / ⋯ / 头像 |
| 画布 | 560 | 浮层只有三处：左上「打开原图参考」44×44、左下尺寸胶囊、右下缩放簇 4×44 |
| 分板标签条 | 56 | `[全图] 1 2 3 … N`，**只有多板时才渲染**；单板为 0 |
| 工具条 | 56 | 色号 52 + 四件工具（分段控件）+ 撤销/重做 |
| 工作台底栏 | 58 | 画布 / 转图 / 用量 / 工具箱 / 保存 |

**转图页**：没有子页标题栏，`SettingsPanel` 自己带标题和重置；底部是常驻整行主按钮
（有图 `生成图纸` / 无图 `先上传图片`），再往下才是工作台底栏。

**用量页**：统计卡一律横排（标签左、数值右，约 44px），不再上下堆叠；
`CompletionSummary` 的「手工画板」头、整合散豆、搜索框依次排列。

**底栏四格各管什么**：画布 = 画；转图 = 参数与生成；用量 = 色号与消耗；工具箱 = 视图与质感。

**桌面端（1440×1024 实测，`desktopLayout.browser.test.ts` 守着）**：

| 项 | 值 |
|---|---|
| 左栏 `SettingsPanel` | 320 宽，控件统一 32，主按钮 36，两行预设卡 40，滑块 24，复选框 16 |
| 右栏 `StatsPanel` | 320 宽，控件统一 32（含搜索框、分段、应用按钮），色卡行图标 24 |
| 顶栏 | 导航 4 项与右侧胶囊全部 32，文字 12px，**不折行** |
| 工具条 | `buttonBase` 32，标签在 ≥1300px 才显示，以下只留图标 |
| 硬约束 | 任意面板控件高度 ∈ `{16,24,32,36,40}`；`body.scrollWidth ≤ innerWidth` |

---

## 0. 给接手的 AI 先说三句话

1. **改的是表现层，没有动算法、后端、数据结构、`types.ts` 契约。** 图片转换、色卡匹配、导出、鉴权、计费全部未触碰。
2. **有 14 条测试契约是硬的**（见第 5 节），动了会红。动之前先读那节。
3. **不要回退第 4 节的设计决策**，那些是为了修具体缺陷做的，不是审美偏好。

---

## 1. 一句话结论

把移动端从"能显示"改到"能单手用"：消除 3 个硬缺陷（安全区失效、100vh 溢出、技术错误外泄），把两处最拥挤的界面（画布页底部、大画板工具栏）重新分层，触控目标全部达标 ≥44×44，最小字号从 8px 提到 11px。

第二轮再把"要滚很久 / 点了没反应 / 手指按不准"解决掉：首页与社区首屏压缩 300–400px，立体拼豆上传区省 330px，大画板画布不再被底部导航永久遮住 66px，21% 无法落豆的问题用「点此放大绘制」一键解决，输入框全部 16px 以阻止 iOS 聚焦缩放。

---

## 2. 改动总览（唯一一份，就地维护）

按文件合并，不再按轮次分表。`轮次` 列指向后面的历史小节，需要「为什么」时再跳。

| 文件 | 现状职责 / 改动 | 轮次 | 风险 |
|---|---|---|---|
| `index.html` | 视口语义、语言标记 | 1 | 低 |
| `src/index.css` | 导航高度契约 `--mobile-nav-clearance`、全局降级规则 | 1/12 | 低 |
| `src/main.tsx` | 根级 `ErrorBoundary` 包住两个 Provider | 19 | 低 |
| `src/App.tsx` | 根容器高度、品牌错误条、删 JSON、提示条移出 studio 分支、上传门槛接线 | 1/10/19 | 中 |
| `src/components/ui/panelScale.ts` | **新增**：侧栏面板尺寸的唯一来源（桌面 32 / 移动 44） | 16 | 低 |
| `src/components/ui/MobileSelect.tsx` | **新增**：移动端底部选择面板（替原生 select） | 14 | 中 |
| `src/components/SettingsPanel.tsx` | `variant` + 尺寸 token、自绘复选框、删 JSON 导入导出、`hideFooterAction` | 14/16/17 | 中 |
| `src/components/StatsPanel.tsx` | 新增 `variant`、尺寸收进 token、统计卡改横排（移动端 76→44px）、三张 KPI 卡改一行三格（21 轮，见第 28 节） | 14/16/17/20/21 | 中 |
| `src/components/Header.tsx` | 右上角胶囊统一 32、删 JSON、导航项禁止折行 | 10/17/18 | 中 |
| `src/components/Toolbar.tsx` | `buttonBase` 加 `shrink-0 + nowrap`，标签阈值 1300px | 18 | 低 |
| `src/components/GridCanvas.tsx` | 分板导航搬到停靠标签条、参考面板按钮 28→32 | 6/18 | **高** |
| `src/components/ErrorBoundary.tsx` | **重写**为 class 边界（`getDerivedStateFromError`） | 19 | 低 |
| `src/components/mobile/MobileHeaderNav.tsx` | **重写**（信息架构） | 1 | 中 |
| `src/components/mobile/MobileBottomNav.tsx` | **重写**（视觉统一） | 1 | 中 |
| `src/components/mobile/MobileWorkspace.tsx` | **底部结构重写**（核心：dock、分板条、转图/用量 tab 化） | 1/7/12 | **高** |
| `src/components/mobile/MobileFeatureSheet.tsx` | 工具箱面板、删「参数设置」二级 tab、删 JSON 两张卡 | 1/8/10 | 中 |
| `src/components/LargeCanvasView.tsx` | 移动端工具栏尺寸 + 默认折叠 | 1 | 中 |
| `src/components/CommunityView.tsx` | 筛选 chip 形态、页头间距收紧（搜索 mt-5、chip/排序桌面 36px、栅格 my-4）、手机端三列缩略图（见第 29 节）、详情弹窗删「框选区域副本」+ 获赞/收藏改可点（第 30 节） | 1/20/21 | 低 |
| `src/components/CommunityPostCard.tsx` | 卡片压缩：标题不再撑 44、查看图纸 36、操作区 pt-2；手机端紧凑形态（封面 + 2 行标题 + 作者/点赞） | 20/21 | 低 |
| `src/components/HomeView.tsx` | 底部留白、`showCommunityFeed` 开关、社区作品图改 4:3、区块内边距收紧、hero 四按钮改三级色阶（白 / 亮玻璃 / 静音玻璃，暖色只上一次）、`lg` 2×2 到 `xl` 单排 | 1/11/15/20/21 | 中 |
| `src/utils/uploadGuards.ts` | **新增**：30MB / 4000 万像素门槛 | 19 | 低 |
| `src/components/ui/panelScale.test.ts` | **新增**：尺度关系断言（5 条） | 16 | 低 |
| `src/components/desktopIsolation.test.ts` | **新增**：桌面隔离 4 条契约 | 15/16/18 | 低 |
| `src/components/desktopLayout.browser.test.ts` | **新增**：真浏览器尺寸契约（1440 / 390） | 18 | 低 |
| `src/components/ErrorBoundary.test.ts` | **新增**：边界契约（必须有 `getDerivedStateFromError`） | 19 | 低 |
| `src/utils/uploadGuards.test.ts` | **新增**：门槛单测（5 条） | 19 | 低 |
| `src/data/brandCatalog.browser.test.ts` | 只改探针锚点字符串，未改断言 | 1 | 低 |
| `package.json` | 新增 `test:serial` / `verify` | 19 | 低 |

> 风险列的判断标准：**高** = 改了要跑一遍真机/浏览器回归；**中** = 影响两端布局但有用例兜底；**低** = 局部且无共享状态。

---

## 3. 第一轮逐文件说明（历史存档）

> 这 12 条写于第 1 轮，只保证**当时**的准确性（例如 `GridCanvas` 那会儿只改了浮层按钮尺寸，
> 现在它还多了分板导航和参考面板 32px）。**现状一律以第 2 节表格为准**，这里只用来回看第 1 轮的意图。


### 3.1 `index.html`

```
lang="en" → lang="zh-CN"
viewport 增加 viewport-fit=cover
新增 <meta name="theme-color" content="#ffffff">
新增 <meta name="description" ...>
```

**为什么**：`viewport-fit=cover` 是安全区生效的**前置条件**。没有它，`env(safe-area-inset-bottom)` 在所有设备上恒为 `0px`，代码里写得再对也没用 —— 这是本次最隐蔽的根因。

### 3.2 `src/index.css`（+46 行）

新增：

- `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100% }`
- `body` 增加 `min-height: 100dvh`、`-webkit-tap-highlight-color: transparent`、`overscroll-behavior-x: none`
- `.app-shell-height { height: 100vh; height: 100dvh; }` ← 替代 `h-screen`
- `:root` 定义 `--safe-top/--safe-bottom/--safe-left/--safe-right` 四个变量
- `.pb-safe`、`.pb-safe-3` 两个工具类
- `@media (prefers-reduced-motion: reduce)` 全局降级（动画/过渡压到 0.01ms，布局不变）

**为什么**：`100vh` 在 iOS Safari 上等于"地址栏收起后的高度"，实际可视区更矮，导致固定底部栏被顶出屏幕。`dvh` 跟随真实视口。

### 3.3 `src/App.tsx`

**改动 1 —— 根容器**

```diff
- <div className="flex flex-col h-screen bg-slate-50 ...">
+ <div className="app-shell-height flex flex-col bg-slate-50 ...">
```

**改动 2 —— 品牌目录错误条**（原第 2105 行附近）

原实现把 `brandCatalog.error` 原样插进 DOM，用户看到的是：

> 品牌目录不可用：Unexpected token '<', "<!doctype "... is not valid JSON

现实现：紧凑单行（`⚠` + 12px 文案 + 44px「重试」按钮），原始错误移入按钮 `title` 属性（开发者悬停可见，用户看不到）。

**保留了被测试锁定的两句话**：`正在读取品牌目录，暂不可开始新转换。`、`新转换暂停`（见第 5 节）。

### 3.4 `src/components/mobile/MobileHeaderNav.tsx`（重写）

**改前**：一行塞 7 个控件 —— 返回 / Logo+品牌 / 通知铃 / VIP / EN / ⋯ / 头像。其中返回 27px、VIP 25px、EN 25px、头像 26px 高。

**改后**：`h-14` 单行，5 个 44px 目标：

| 位置 | 元素 | 说明 |
|---|---|---|
| 左 | `返回`（h-11，带 `aria-label` + `title="返回首页"`） | 仅 studio 页显示 |
| 左 | Logo 32px + 品牌块 | 副标题 = studio 时显示**当前图纸名**，其他页显示当前板块名 |
| 右 | `AnnouncementBell`（本就 44px，包一层 h-11） | |
| 右 | `⋯` 溢出菜单（h-11 w-11，内层 h-9 w-9） | **测试锁定，勿改结构** |
| 右 | 账号按钮（h-11） | 未登录显示 `User` 图标而非首字 |

`⋯` 菜单项扩为：我的图纸 / 使用指南 / 会员权益 / 界面语言（显示当前语言）。
新增**点击外部关闭 + Esc 关闭**（`pointerdown` + `keydown` 监听）。

**被移除的 UI**：VIP 胶囊、EN 胶囊。功能没删，都进了 `⋯` 菜单。

### 3.5 `src/components/mobile/MobileBottomNav.tsx`（重写）

**改前**：4 个 tab +「我的」是一个紫色实心胶囊，几何和其他 4 个不一致，看起来像 CTA 而不是 tab；图标 16px、标签 10px。

**改后**：

- 5 个槽位共用同一套几何：`min-h-11 flex-1`，图标 `h-5 w-5`，标签 `text-[11px]`
- 选中态：`bg-purple-50 text-purple-700` + 图标 `stroke-[2.4]`，不再用实心块
- 「我的」槽位图标位是一个 20px 圆（登录态 `bg-purple-100`），VIP 时右上加 8px 琥珀点
- 容器：`fixed bottom-0` + `margin-bottom: max(0.75rem, env(safe-area-inset-bottom))`
- 外层 `pointer-events-none`，nav 自身 `pointer-events-auto`（避免整条横带挡住页面点击）

⚠️ **「我的」槽位里不能放用户名首字**：`AdminEntry.browser.fixture` 用 `nav button` 的 `textContent` **严格等于**「我的」来定位这个入口。放了首字就变成"张我的"，测试直接红。头像字母请只放在顶部 Header 里。

### 3.6 `src/components/mobile/MobileWorkspace.tsx`（核心，305 行改动）

**改前**：底部叠了三层

```
[状态胶囊 79×44 豆 · 6板] ...... [− 21% +]   ← 浮在画布上
[色号 A1][区域清除][残点][画笔][油漆桶][吸管][橡皮][抓手][撤销][重做][⋯]  ← 横向滚动，溢出 218px
[实操][画布][转图][用量][省豆][保存][导出]  ← 7 项，导航和动作混在一起
```

**改后**：两层，职责分离

```
第 1 层（h-[52px]，仅画布 tab）工具条
  [色号 52px] [画笔][油漆桶][吸管][橡皮] │ [撤销 44][重做 44]
  —— 固定 6 项，不滚动；每项 h-11

第 2 层（h-14）视图 + 主操作
  [画布][转图][用量]（role=tab） [更多] │ [保存]（紫色填充主按钮）
```

> 注：上图是第二轮结束时的样子。后续变化——「更多」已于第九轮改名「工具箱」（见第 17 节），
> 转图 / 用量不再有自己的子页标题栏（见第 15 节），画布与工具条之间多了一条分板标签条（见第 14 节）。
> 需要看现在的结构请直接读 14.2 与 15.2。

**被移走的入口**（功能都还在，位置变了）：

| 原入口 | 新位置 |
|---|---|
| 省豆 | 「更多」面板 → 智能精准省豆（原有卡片） |
| 导出 | 「更多」面板 → 新增「导出图纸」主色卡 |
| 实操 | 「更多」面板 → 新增「实操模式」开关卡 |
| 区域清除 | 「更多」面板 → 新增「区域清除」开关卡 |
| 清理残点 | 「更多」面板 → 新增卡（沿用 `backgroundCleanup`） |
| 抓手（hand） | **已移除**。移动端用双指拖动/缩放（`interactionProfile="touch"` 已支持），单指留给绘制 |

**其他细节**：

- 色号托盘：chip `h-8` → `h-11`，`text-[9px]` → `text-[11px]`，`max-h-16` → `max-h-[60px]`
- 底部容器加 `pb-safe`
- 传给 `MobileFeatureSheet` 的新 prop 见 3.7
- 清理了 20 个不再使用的 lucide 图标导入

**验证数据**（390×844，CDP 实测）：

| 指标 | 改前 | 改后 |
|---|---|---|
| <44×44 的可点元素 | 11 | **0** |
| 底部占用高度 | 115px（无安全区） | 109px + `env(safe-area-inset-bottom)` |
| 工具条横向隐藏内容 | 218px（43% 不可见） | 0 |
| 最小字号 | 8px | 11px |
| 底部项数 | 7（导航+动作混排） | 3 tab + 1 更多 + 1 主按钮 |

### 3.7 `src/components/mobile/MobileFeatureSheet.tsx`

**新增 7 个可选 prop**（全部可选，不传则不渲染对应卡片，向后兼容）：

```ts
onOpenExportModal?: () => void;
onTogglePractice?: () => void;
isPracticeMode?: boolean;
onOpenResidualCleanup?: () => void;
residualCleanupDisabled?: boolean;
onSelectRegionClear?: () => void;
isRegionClearActive?: boolean;
```

**新增 4 张卡**（插在"快捷操作"网格最前面）：导出图纸（紫色主色）、实操模式（开关态）、区域清除（开关态）、清理残点（沿用原有 disable 逻辑）。

**尺寸修正**：

- 关闭按钮 `w-8 h-8`（32px）→ `h-11 w-11` 外层 + `h-9 w-9` 内层视觉
- `max-h-[85vh]` → `max-h-[85dvh]`
- 底部内边距 `env(safe-area-inset-bottom)` → `var(--safe-bottom)`
- 全文件 `text-[9px]`(11 处) / `text-[10px]`(5 处) → `text-[11px]`

### 3.8 `src/components/GridCanvas.tsx`（只动浮层，不动绘制）

- 左上信息胶囊：`text-[9px]` → `text-[11px]`，对称徽章 `text-[8px]` → `text-[11px]`，`max-w` 从 `calc(100vw-220px)` 调到 `-200px`
- 右下缩放簇：`w-8 h-8` → **`h-11 w-11 sm:h-8 sm:w-8`**（桌面尺寸不变）
- **「居中适应」按钮在移动端隐藏**（`hidden sm:flex`）：捏合缩放手势可替代，把宽度让给「全屏预览」
- 「全屏 / 缩小 / 放大」三个按钮补 `aria-label`（原来只有 `title`，读屏读不到）；桌面尺寸用 `sm:h-8 sm:w-8` 保持原样

⚠️ 这个文件同时被桌面和移动端使用。所有尺寸改动都以 `sm:` 作为桌面分支保留原样。

### 3.9 `src/components/LargeCanvasView.tsx`

**改前**（360×800 实测）：30 个按钮中 **20 个 < 44×44**（工具按钮 30×32），画布从 **y=371** 才开始，占屏 46%。

**改后**：

1. `toolbarExpanded` 默认值：`true` → 手机折叠、宽屏展开

```ts
useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 639px)').matches)
```

2. 顶部动作行（折叠工具 / +图框 / 导出 / 清空）→ `min-h-11`、`text-[11px]`、`rounded-xl`
3. 移动面板 tab（工具/视图/设置）→ `min-h-11`
4. 工具网格：`grid-cols-10` + `h-8` → **`grid-cols-5` + `h-11`**（2 行），图标 `h-3.5` → `h-[18px]`
5. **对称 + 色号 + 撤销/重做合并成一行**（原来三行，省 50px）
6. 视图/设置面板所有 `h-8` → `h-11`，`text-[10px]` → `text-[11px]`
7. 删掉固定高度容器 `min-h-[116px]` / `min-h-[78px]`（内容自己撑开）

| 指标 | 改前 | 改后 |
|---|---|---|
| <44×44 按钮 | 20 | **0** |
| 画布起始 y（360×800） | 371 | **226**（折叠）/ 438（展开） |
| 工具行 | 1 行 10 列 × 32px | 2 行 5 列 × 44px |

### 3.10 `src/components/CommunityView.tsx`

- 根容器 `pb-16` → `pb-28`（浮动底部导航约 72px + 12px 边距，原来内容被压住）、`min-h-screen` → `min-h-full`
- 分类筛选 chip：`rounded-xl min-w-11 break-words px-4 py-2` → `rounded-full px-4 py-1.5`
  - 原来标签只有一个时，会被 `min-w-11 + px-4 + py-2` 撑成接近正方的大块，看起来像卡片/按钮而不是 chip
  - 顺手删掉了无效类 `scale-102`（Tailwind 没有这个档位）

### 3.11 `src/components/HomeView.tsx`

- `min-h-screen` → `min-h-full`
- `pb-24` → `pb-28`

### 3.12 `src/data/brandCatalog.browser.test.ts`

**只改了一行字符串**，没有改任何断言：

```diff
- const marker = '  return (\n    <div className="flex flex-col h-screen';
+ const marker = '  return (\n    <div className="app-shell-height';
```

这个测试用字符串定位 `App.tsx` 里插入探针的位置，根容器类名变了就必须同步，否则报 `App probe insertion point changed`。

---

## 4. 设计决策（请勿回退）

1. **单一强调色 `purple-600`**。改前底部同时出现 purple（画布）、emerald（保存/导出）、amber（省豆）、rose（区域清除），四个强调色抢注意力。现在：主操作保存 = 紫色填充；其他动作退到「工具箱」面板，颜色只做语义区分不做层级竞争。
2. **导航栏放"目的地"，动作不单独占坑**。全局底栏（`MobileBottomNav`）只有 5 个目的地：首页 / 画板 / 豆社 / 大画板 / 我的，不塞动作。画布内的工作台 dock 是另一层：`画布 / 转图 / 用量` 三个视图 + `工具箱`（视图与质感）+ `保存`（唯一主操作，紫色实心）。**一层里最多一个主操作**，所以保存可以留在 dock 里，但不能再出现第二个实心按钮。
3. **工具条不横向滚动**。原工具条 `scrollWidth 509 / clientWidth 291`，43% 的工具藏在屏幕外且没有任何提示。宁可减少工具数量（把低频工具下沉到面板），也不要让用户猜。
4. **画布优先**。大画板在手机上默认折叠工具栏，因为展开时 44px 控件要吃掉 180px；折叠后画布从 y=371 提到 y=226。折叠/展开按钮常驻且显眼。
5. **错误信息面向用户，技术细节面向开发者**。原始异常字符串只进 `title` / 日志，不进正文。
6. **触控目标 44×44 是硬线**，包括图标按钮；视觉圆点可以小，热区不能小（`h-11 w-11` 外层 + `h-9 w-9` 内层）。
7. **尺寸只有两个来源**。侧栏面板的控件尺寸只能来自 `ui/panelScale.ts`（桌面 32 / 移动 44），其余按 4px 网格。
   禁止在 JSX 里写 `sm:h-auto` / 裸 `min-h-11`「覆盖一下」——第 16 轮那批 9 种高度就是这么长出来的。
8. **滚动容器不许压缩子元素**。`flex flex-col` + `overflow-y-auto` 必须同时给子元素 `shrink-0`，
   否则内容超长时不会出滚动条，而是把每个固定高度的控件均匀压扁（第 17 轮主按钮 16px 就是这么来的）。
9. **一个按钮组只用一套色阶，暖色只上一次**（第 21 轮，`HomeView.tsx` hero 区）。
   改前那四个入口各说各话：纯白实心 / 白 15% 玻璃 / 白 5% 幽灵（桌面还直接 `sm:bg-transparent`，所以那一排在桌面上是歪的）/ 琥珀 15% 描边。
   四个填充色相读起来像四个不相干的控件，琥珀压在紫上还发土——这就是「色彩乱」的全部来源。

   现在固定三级，全部落在白–紫单色族：

   | 层级 | 用途 | 类 |
   |---|---|---|
   | 主 | 进入画板创作 | `bg-white text-purple-950` + 深紫投影 + 底部内阴影 |
   | 次主 | 照片一键转拼豆（核心卖点） | `bg-white/24 border-white/45` + `inset 0 1px 0 white/45` 顶边高光 |
   | 次级 | 探索社区作品 / 颜色识别 | `bg-white/[0.06] border-white/[0.16]`，文字 `purple-100` |

   暖色只保留一处：转图按钮的琥珀闪电（`fill-amber-300` + 微光）。**不要给次级按钮再加第二种色相**，
   那正是这排按钮最初显得脏的原因。主按钮必须带 `border border-transparent`，否则比带 1px 边框的兄弟矮 2px。
   排布：`sm` 起单排 → `lg`（右栏示例图占位后左栏只剩 ~660px，四颗胶囊会折成 3+1）回退成 2×2 等宽格 → `xl` 再回单排（此时左栏 757px 放得下 684px 的按钮组，需要搭配 `xl:col-span-8/4`）。

---

## 5. 测试契约（硬约束，改了会红）

| # | 文件 | 约束 |
|---|---|---|
| 1 | `AdminEntry.browser.fixture.tsx:71` | `nav button` 的 `textContent.trim()` **严格等于**「我的」 |
| 2 | `UserProfileModal.browser.fixture.tsx:255` | 必须存在 `header button[title="返回首页"]` |
| 3 | `brandCatalog.browser.fixture.tsx:37` | 正文必须包含「正在读取品牌目录，暂不可开始新转换。」 |
| 4 | `brandCatalog.browser.fixture.tsx:39` | 正文必须包含「新转换暂停」 |
| 5 | `brandCatalog.browser.test.ts:30` | `App.tsx` 的 `return (` 后紧跟 `<div className="app-shell-height` |
| 6 | `NavigationVisibility.test.ts` | `MobileBottomNav` 恰好 5 个 `<button>`，且含「画板」「豆社」；`MobileHeaderNav` 含「豆织」、不含「立体」「3D Fuse Bead」 |
| 7 | `MobileHeaderNav.overflow.test.ts` | `⋯` 触发器：`h-11 w-11` + 内层 `h-9 w-9` + `aria-haspopup="menu"` + `aria-expanded` + `focus-visible:ring-2` + `lucide-ellipsis`；`onOpenPatternsModal` 为 undefined 时**不得渲染**该触发器 |
| 8 | `overlayWiring.test.ts` | `MobileWorkspace` / `DesktopWorkspace` 的 `<GridCanvas>` 必须保留 `overlayOpacity` 与 `keepImageAspectRatio` |
| 9 | `UserProfileModal.browser.fixture.tsx:140` | 手机端按 **aria-label「画板工具箱」** 点击底栏第四个入口。改这个标签必须同步改这里，否则浏览器用例会静默点空 |
| 10 | `ui/panelScale.test.ts` | 侧栏面板的尺寸只能来自 `createPanelScale`：桌面 `control/numberInput/headerBtn` 解析出的高度**必须相等**（32），`control` 不得含 `h-auto`；移动端 ≥40；每端字号 ≤4 档 |
| 11 | `desktopIsolation.test.ts` | ① `<h1>` 同时有 `text-[22px]` + `lg:text-5xl` 且无第二个 `lg:text-[..px]`；② `SettingsPanel`/`StatsPanel` 必须用 `createPanelScale` 且无 `sm:h-auto`/`sm:min-h-0`/`min-h-11`；③ 侧栏容器必须含 `[&>*]:shrink-0`；④ 导航四个 tab 与 `Toolbar` 的 `buttonBase` 必须 `shrink-0 + whitespace-nowrap` |
| 12 | `desktopLayout.browser.test.ts` | 真 Chrome 量尺寸：桌面 1440 下每个控件高度 ∈`{16,24,32,36,40}`、「重新计算拼豆图纸」=36、导航/工具条高度 ≤40；移动 390 下控件 ≥40 且 sheet `padding=0`；两端无横向溢出 |
| 13 | `utils/uploadGuards.test.ts` | 30MB / 4000 万像素门槛；宽高读不出来时必须**放行**而不是抢着拒绝 |
| 14 | `ErrorBoundary.test.ts` | 必须具备 `getDerivedStateFromError`（有人改回函数组件 + `window.addEventListener` 时会红） |
| 15 | `ImportBlueprintWizard.hooks.test.ts` | 扫全部组件：**组件体里的提前 `return` 之后不允许出现任何 Hook**。第一版没做作用域限制扫出 62 条误报，改成按顶层声明做花括号配对后才干净 |

---

## 6. 如何验证

```bash
# 一条命令跑完类型 + 构建 + 全量串行测试（推荐）
npm run verify

# 分开跑
npm run lint          # tsc --noEmit
npm run build         # vite build
npm run test:serial   # vitest run --no-file-parallelism

# 开发服务器
./node_modules/.bin/vite --host 127.0.0.1 --port 3000 --strictPort
```

**当前实测（2026-10-29 22:40）**：

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `vite build` | 通过，6.8s（仅 chunk >500kB 警告） |
| 非浏览器用例 | **1445 passed / 1 skipped**（117 文件） |
| 浏览器类用例 | **10 文件 / 40 条**，成组跑全绿 |

**关于「浏览器类用例的假红」**——这是这个项目最容易误判的地方：

- 现象：全量并发跑时 3–5 个**文件**报 `Server.httpServer.listen` 失败；
- 注意：这是**文件级**失败，`Tests` 计数里连失败用例都没有，很容易被当成「测试全绿」；
- 原因：每个浏览器用例自己 `createServer` + 起 Chrome，并发时互相抢端口/进程；
- 处理：`npm run test:serial` 串行跑，或把那 10 个文件单独成组重跑，**必绿**；
- 判读顺序：先看报错是不是 `listen`，是就重跑那一组，别当回归。

---

## 7. 未完成 / 建议下一轮

| 优先 | 事项 | 说明 |
|---|---|---|
| **P0** | **提交当前改动** | 48 个文件未提交（含今天全部 UI 修复）。没有 commit 就没有回滚点，下一次改动出问题只能靠记忆恢复 |
| P1 | **装 `@types/react` + 开 strict** | 现在 `.tsx` 的 props **完全没被检查**（`@types` 下只有 node，`react` 是无类型模块，`Component` 解析成 `any`）。这是「类型检查通过」名不副实的主因，估计会报几百条，需要单独一轮 |
| P1 | **CI** | 仓库没有 `.github/`。最小可用版本：push 跑 `npm run verify`，红了不许合 |
| P2 | **主包 1.03MB（gzip 302KB）** | `AdminPage` / `AssemblyWorkspace` 已经分包，但入口 chunk 仍偏大，移动端首屏吃流量 |
| P2 | **画布页没有跨 tab 出口** | studio 隐藏了全局底部导航（沉浸式编辑的合理取舍），但用户在画布里无法直达「豆社/大画板」，必须先点「返回」 |
| P2 | **平板断点** | 工具栏文字标签阈值是 1300px，768px 竖屏 iPad 只显示图标，信息密度偏低 |
| P3 | **真机安全区未验证** | 无头 Chrome 的 `env(safe-area-inset-*)` 恒为 0，刘海/Home Indicator 的真实遮挡必须在真机或 DevTools 设备模拟里确认 |
| P3 | **深色模式** | 未引入。若要支持，需要把散落的 `slate-*` / `purple-*` 收敛成语义 token |

> **已完成（不要再当 TODO 捡起来）**
>
> - 转图/用量子页 header 冗余 —— 第七轮把子页栏整条删掉（15.1–15.4）；
> - 桌面 Header 1280 折成竖排单字 —— 第 18 轮补 `shrink-0 + whitespace-nowrap`，
>   工具条标签阈值提到 1300px（24.4）；`desktopIsolation.test.ts` 第 4 条守着；
> - 侧栏下拉框 20px / 主按钮 16px —— 第 16、17 轮修掉（24.3、24.8），
>   `panelScale.test.ts` + `desktopLayout.browser.test.ts` 守着。

---

## 8. 本次新增的本地工具（未进 git）

全部在 `.workbuddy/` 下，**不属于仓库产物**，可安全删除。

| 路径 | 作用 |
|---|---|
| `.workbuddy/live/server.mjs` | 实时操作台：持有无头 Chrome 的 CDP 连接，`/cmd` 执行动作、`/events` 推 SSE |
| `.workbuddy/live/hud.html` | 看板页面：左侧实时画面（含点击波纹）、右侧操作时间线 |
| `.workbuddy/live/agent.mjs` | 命令行驱动，`node agent.mjs clickText "橡皮" "点橡皮"` |
| `.workbuddy/live/README.md` | 操作台用法 |
| `.workbuddy/tools/cdp.mjs` | 一次性 CDP 截图/测量脚本。`--dsf` 控制像素密度；结尾连拍两帧，因为无头 Chrome 的合成器有时不出新帧，只拍一张会拿到上一帧的字节 |
| `.workbuddy/tools/audit-home.js` | 审计表达式：横向溢出、越界元素、<12px 文字、<44px 触控目标 |
| `.workbuddy/tools/audit-all.js` | 画布页审计：小控件、溢出、<11px 文字、被底栏遮挡、滚动容器 |
| `.workbuddy/tools/flow-ws-audit.js` | 进入画板后立即审计（SPA 无法靠 URL 直达画布） |
| `.workbuddy/tools/probe-structure.js` | 打印工作区各层高度与浮层位置，判断谁压住了画布 |
| `.workbuddy/tools/probe-paper.js` | 用 `getImageData` 找纸面边界，判断聚焦板是否被控件盖住 |
| `.workbuddy/tools/flow-upload.js` | 用 `DataTransfer` 往 `input[type=file]` 塞图，验证「有图 / 无图」两种状态 |
| `.workbuddy/tools/measure-studio.js` | 画布页各区域高度测量 |
| `.workbuddy/tools/measure-large.js` | 大画板控件尺寸与画布起点测量 |
| `.workbuddy/shots/*.png` | 改前/改后对比截图 |
| `.workbuddy/memory/2026-10-28.md`、`2026-10-29.md` | 当日工作日志（含决策与契约备忘） |

---

## 9. 一句话交付标准

移动端：360×800 下画布页与大画板页**没有小于 44×44 的可点元素、没有小于 11px 的文字、没有横向溢出、底部内容不被 Home Indicator 遮挡**。

桌面端：1440×1024 下**所有面板控件高度落在 16/24/32/36/40，主按钮 36，导航与工具条不折成竖排，无横向溢出**。

两端：`npm run verify` 全绿（`tsc` + `vite build` + 串行测试），且浏览器类用例成组重跑全绿。

---

# 第二轮（同日追加）：把「能用」改成「好用」

第一轮解决的是「不达标」，第二轮解决的是「要滚很久 / 点了没反应 / 手指按不准」。
本轮只改移动端表现层，桌面端布局一律用 `sm:` / `lg:` 前缀保持原样。

## 10.1 本轮修的 6 个真实痛点

| # | 现象（改前实测） | 根因 | 改法 |
|---|---|---|---|
| 1 | 大画板画布**底部 66px 永远看不见**：滚动容器 `bottom=844`，底部导航 `top=778`，`paddingBottom` 只有 16px | 固定导航悬浮在滚动区之上，没有为它预留滚动余量 | 滚动容器加 `pb-24 sm:p-6`，滚到底时画布可完整露出 |
| 2 | 立体拼豆要滚 **1.5 屏**才能传完 4 张视角图（4 个 `min-h-20` 全宽盒子竖排，约 600px） | 上传区在移动端是单列 | 移动端改 `grid-cols-2`，上传框改全宽虚线块，3D 模型行 `col-span-2`。**省约 330px**，图纸规格进入首屏 |
| 3 | 社区页首屏**看不到任何社区作品**（banner 440px，内容从 y≈880 开始） | 落地页式的巨型 hero 被搬进信息流页 | hero 从 440px 压到 260px：`py-8→py-4`、`h1 text-3xl→text-xl`、描述 `hidden sm:block`、CTA/搜索间距收紧；标签栏改**横向滑动**不换行 |
| 4 | 首页 4 个 CTA **尺寸各不相同**（大白胶囊 / 灰边框 / 纯文字链 / 琥珀胶囊）折行后错位；4 张示例卡 2×2 铺满 | 全部 `flex-wrap` 自由排布 | CTA 移动端 `grid grid-cols-2` 等宽等高；示例改横向滑动条（86px 方块）；副标题 `line-clamp-2`、统计脚注 `hidden sm:flex`。**省约 300px** |
| 5 | 大图纸 fitToView 后缩放到 **21%**，单颗豆约 4px，**手指根本点不准** | 只提供双指缩放，无提示、无快捷入口 | 豆格 < 9px 时浮出「豆格太小，点此放大绘制」，一点跳到 26px/颗；同时把「适应全图」按钮**放回移动端**（之前 `hidden sm:flex`，放大后无法一键回到全图） |
| 6 | 登录框、搜索框字号 12–14px → **iOS Safari 聚焦时自动放大整页**，键盘还挡住主按钮 | 输入框字号 < 16px | 全局 `@media (max-width:639px)` 强制文本类 input/textarea/select 为 16px；图片/单选/滑杆除外 |

## 10.2 另外 4 处修正

- **320px 小屏工具按钮被压到 37px**：工具改 `min-w-10`，色卡按钮窄屏 `w-11`，分隔线在 <360px 隐藏 → 41px 且无横向溢出。（320px 下 8 个控件按 44px 排需要 352px，物理上放不下，41px 是取舍结果）
- **设置/统计面板在移动端只有 320px 宽**，右边留 58px 空白 + 一条多余竖线：`SettingsPanel` 少传了 `variant="sheet"`，`StatsPanel` 写死 `w-80`。改为 sheet / `w-full lg:w-80`。
- **顶栏错误横幅占 66px 两行**、永远常驻：移动端改单行短文案（`色卡读取失败 · 新转换暂停`），长文案保留给 ≥sm。
- **触控目标补齐**：转图面板 21 个 → 0 个（tab、模式 chip、对称 chip、底板色、勾选行、宽高输入、比例锁），更多面板 17 个 → 0 个，用量面板 8 个 → 0 个，社区 2 个 → 0 个，大画板色卡下拉从 38px 不可读 → 整行 44px。

## 10.3 本轮涉及文件

```
src/App.tsx                       错误横幅移动端单行
src/index.css                     +@media(max-width:639px) 输入框 16px
src/components/AuthModal.tsx      输入框 16px、图标垂直居中、placeholder 缩短
src/components/HomeView.tsx       hero 压缩、CTA 2×2、示例横向滑动
src/components/CommunityView.tsx  hero 压缩、标签横向滑动、刷新改图标按钮
src/components/AssemblyWorkspace.tsx  上传区 2×2、说明折行、字号 11px
src/components/GridCanvas.tsx     「豆格太小」提示、适应全图按钮回移动端、百分比收进桌面
src/components/LargeCanvasView.tsx    pb-24、色卡下拉整行、图例 11px
src/components/SettingsPanel.tsx  触控目标、字号、宽度修复
src/components/StatsPanel.tsx     全宽修复、触控目标、字号
src/components/mobile/MobileFeatureSheet.tsx  tab/chip 44px
src/components/mobile/MobileWorkspace.tsx     工具条 min-w-10、variant="sheet"、子页 header 44px
```

## 10.4 本轮验证数据（360×800 与 390×844，头层 Chrome 移动仿真）

| 页面 | <44px 可点元素 | 横向溢出 | <11px 文字 |
|---|---|---|---|
| 首页 | 0 | 0 | 0 |
| 社区 | 0 | 0 | 1（V2.0 角标，装饰） |
| 画布 | 0（1 个 `sr-only` 文件 input 不计） | 0 | 0 |
| 转图 | 0 | 0 | 0 |
| 用量 | 0 | 0 | 0 |
| 更多 | 0 | 0 | 0 |
| 大画板 | 0 | 0 | 62（全部是网格标尺数字，装饰） |
| 立体拼豆 | 6（全是 `sr-only` file input）+1 个 20×20 复选框（在整行 label 内） | 0 | 0 |

`tsc --noEmit` 通过；`vitest --no-file-parallelism` **1483 passed / 3 skipped**。

## 10.5 本轮仍未做

| 优先 | 事项 | 说明 |
|---|---|---|
| P1 | **桌面 Header 11 个入口在 1280px 被压成竖排单字** | 仍未动。根治要把「使用指南 / 会员 / EN / 登录签到 / 智能省豆」收敛进 ⋯ 菜单，属于信息架构决策，需产品确认 |
| P2 | **画布触摸精度** | 现在放大后单颗 26px，手指仍会盖住 1–2 格。专业做法是加「手指上方落点偏移」或放大镜，属于绘制逻辑改动，未在本轮范围 |
| P2 | **画布页没有跨 tab 出口** | 同第一轮 P2，未变 |
| P3 | 子页 header 冗余（「返回画板」+「应用」与底部 tab 重复） | 已放大到 44px，但信息冗余仍在 |
| P3 | 真机安全区未验证 | 无头 Chrome 的 `env(safe-area-inset-*)` 恒为 0 |


---

# 第三轮：画布改为「按板编辑」（对标分版图纸）

用户原话：「移动端进行自由创作或者进行图纸修改，我的建议是，类似于导出时的分版导出的分版图纸，这样更加方便」。

## 11.1 为什么必须这么改

79×44 的图纸在 390px 宽的手机上 fit 到全图是 **21% 缩放 ≈ 4px 一颗豆**，手指直径约 34px，等于一次按下去会盖住 8 颗豆——根本没法落点。之前只加了「点此放大绘制」的提示，属于治标。

导出模块早就有「分版」概念（`ExportModal` 里 `boardsX/boardsY`，25 张分板图纸），编辑端现在复用同一套几何：**一次只编辑一块 29×29 的实物拼豆板**。

## 11.2 改了什么（全部在 `src/components/GridCanvas.tsx`）

| 能力 | 实现 | 说明 |
|---|---|---|
| 打开即进分板 | `resetCanvasView()` | 手机且 `totalBoards > 1` → `focusBoard(0)`；桌面仍 `fitToView()`。**实测单颗豆从 4px 提升到 ~12px** |
| 板间导航 | 画布左上角浮层 `‹ 第 1/6 板 ›` | 左右箭头 44×44 翻板；**点中间文字回全图**，两行副标题直接写「点此回全图 / 点此看整图」 |
| 分板坐标 | `focusRect` | 分板模式下标尺**从 1 重新编号到 29**（与纸质分版图纸一致），不再是全局 1..79 |
| 聚光遮罩 | 半透明 scrim + 2px 紫框 | 相邻板的拼豆纹理和当前板**完全一样**，不打暗根本分不清边界；遮罩只画四块矩形，不用合成模式，低端机也便宜 |
| 板缝线 | 每 `boardSize` 一条紫线 | 之前只有 5/10 格辅助线，物理拼豆板的边界反而不画 |
| 纸面投影 | `ctx.shadowColor` + 二次填充 | 图纸从「一块涂色矩形」变成「浮在桌面上的纸」，桌面改纯色渐变、去掉满屏点阵 |

## 11.3 顺手重做的视觉

- **工具条改一体式分段控件**：原来是 4 个各自描边的圆角盒子并排，现在是一个 `.flex.h-[46px]` 容器内 4 个等分格子（选中填紫、分隔线 1px），撤销/重做合成另一组双格胶囊。少 5 条描边，选中态一眼可辨。
- **画布桌面**：`bg-[#F5F0FD]` + 满屏 20px 点阵 → 纯色渐变 `#F2F0F9 → #E6E3F1`。原来的点阵和板内的拼豆点阵视觉冲突，看不出哪块是板。
- 板号浮层的次级文字用 `text-purple-400`，主文字 11px 黑体，符合两行胶囊的信息密度。

## 11.4 关键实现细节（接手时别踩）

1. **`clampCanvasViewport` 会强制居中**：当内容小于视口时它返回居中值，会覆盖你算好的 pan。所以 `focusBoard` 里的 pan 只在「缩放后图纸整体大于视口」时才是精确的。当前 79×44 在分板缩放下整体 543px < 617px 视口，**纵向会被居中，板会贴顶**——这是已知且可接受的（相邻板被遮罩压暗，视觉上不突兀）。若以后要精确居中，需要给 `boundGridTransform` 传 focusRect 作为 content 边界。
2. **`fitToView()` 会 `setFocusedBoard(null)`**：这是「回全图」的实现方式，别把它删掉。
3. **首次挂载容器宽度可能是 0**：`focusBoard` 里有 `clientWidth <= 0` 的早退，真正生效靠 80ms 后那次 `resetCanvasView()`。改这段时不要把那个 timer 删了。
4. 分板导航用 `lg:hidden`：**平板（640–1023）也走这个浮层**，因为平板同样跑的是移动端 shell（`useIsDesktop` 断点是 1024）。

## 11.5 验证

- 像素级探测分板框：`340×340` CSS px，正方形无误（用 canvas `getImageData` 找紫色描边，阈值 `b>228` 以区分板缝线 `b=217`）。
- 交互链路实测（实时操作台）：`第 1/6 板 → 点下一板 → 第 2/6 板 → 点中间 → 全图 · 6 板`。
- 390×844 全页面审计：横向溢出 0、<44px 可点元素 0（除 `sr-only` 文件 input）、<11px 文字 0。
- `tsc` 通过；`vitest --no-file-parallelism` **1482 passed / 1 failed / 3 skipped**，唯一失败是 `practiceBrowser.test.ts` 报 `Received network error or non-101`（CDP 连接被本地调试浏览器抢占），单独重跑通过。

## 11.6 这一轮没做、但真正决定手感的一件事

**手指偏移落点**：即便 12px/颗，指尖仍会盖住 2–3 格。专业像素编辑器会把手指导致的落点上移约 24px（并在上方显示放大镜/预览），这样眼睛能看见要画的那一格。这需要改 `clientToGrid` 与绘制预览，属于绘制逻辑，建议下一轮做——它比继续调视觉更能解决「按不准」。

---

# 第四轮：色卡失败提示可关闭

用户要求：给顶部「色卡读取失败 · 新转换暂停」横幅加一个 × 。

## 12.1 改动（仅 `src/App.tsx`）

| 位置 | 内容 |
|---|---|
| `StudioApp` 状态区 | 新增 `isCatalogNoticeDismissed`，并用 `useEffect` 监听 `brandCatalog.status` 与 `brand`，任一变化即重置为 `false` |
| 横幅条件 | `(status !== 'ready' || !BRAND_PALETTES[brand]) && !isCatalogNoticeDismissed` |
| 横幅右侧 | 在「重试」后新增 44×44 幽灵按钮，`aria-label="关闭这条提示"`，图标 `X`（lucide 已导入） |

## 12.2 为什么是「按状态重置」而不是永久关闭

横幅同时是**唯一的重试入口**。如果永久关闭，`status='error'` 时用户既看不到原因也没有重试按钮，等于把新转换功能静默锁死。

改成「一次关闭只对当前状态有效」后：

- 关闭 → 横幅消失（实测画布高度 617 → 674，多出 57px）
- 浏览器 focus / 切回标签页触发后台刷新，`error → loading → error` → 横幅**自动重新出现**
- 切换色卡品牌、或刷新成功后再次失败，同样会重新出现

即使用户关掉后立刻去转换，`imageLoadMessage` 仍会提示「品牌目录不可用」，不会静默失败。

## 12.3 实测

| 项目 | 数值 |
|---|---|
| 横幅高度 | 57px（`py-1.5` + 44px 按钮） |
| 重试按钮 | 50×44 @ x=276（390 宽） |
| 关闭按钮 | 44×44 @ x=334，右边距 12 |
| 关闭后画布 | top 114→57，height 617→674 |
| 360px 宽 | 无横向溢出；<44px 元素仅剩 1 个 `sr-only` 文件 input |
| 桌面 1280 | 长文案 + 重试 + × 同一行，右侧对齐正常 |

`tsc` 通过；`vitest --no-file-parallelism` **1483 passed / 3 skipped**（含 `brandCatalog.browser.test.ts` 2 项）。

---

# 第五轮：把改动搬到「正确版」+ 分版标尺修复

## 13.1 版本事实（先看这段，避免再走弯路）

`pindouwangge`（正确版）与 `pindouwangge-原始错版` 的 **git HEAD 完全相同**（`ec85286`），
两棵树只差我改过的 24 个文件。所以"版本错误"不是代码不同：

- **立体拼豆在本地开发永远可见**，因为开关是 `import.meta.env.DEV || VITE_ASSEMBLY_DEV_MODE`；
  生产构建里没有 `public.assembly` 开关或管理员旁路就隐藏。要让本地也不显示，只改这一行常量。
- 该功能已被产品废弃，本轮把 `AssemblyWorkspace / AssemblyGridEditor / AssemblyStructurePreview`
  三个文件**还原到 HEAD**，不再在这个死功能上做优化。

## 13.2 搬迁方式

在旧目录 `git diff --binary > patch`，新目录 `git apply`（同基线，零冲突），再补两件 Git 不管的事：
`.workbuddy/{tools,live,memory}` 与 `MOBILE-UI-HANDOFF.md`（未跟踪文件）。

## 13.3 三个环境级坑（会反复咬人）

| 坑 | 现象 | 处置 |
|---|---|---|
| Windows 不能复制 pnpm 符号链接 | `cp -a node_modules` 报 `Operation not permitted` | `CI=true corepack pnpm install --frozen-lockfile --config.confirmModulesPurge=false` |
| `git apply` 在 `core.autocrlf=true` 下写入 CRLF | `brandCatalog.browser.test.ts` 报 `App probe insertion point changed` | 24 个改动文件统一回 LF；新增 **`.gitattributes`**（`* text=auto eol=lf`）防止再次漂移 |
| 颜色断言用字面量类名 | 对比度改造后 `GridCanvas.referencePanel.test.ts` 失败 | 断言改为 `text-purple-600` 并注释原因（purple-500 在浅底仅 4.12:1） |

## 13.4 本轮新修的两个真实缺陷（分版视图）

1. **标尺被分板导航压住**。实测：内容起点 51px，胶囊底部 58px → 第 1–9 列坐标被盖。
   根因是 `clampCanvasViewport` 在内容小于视口时**强制居中**、内容大于视口时**上界只有 gutter**，
   两条路径都会把我算好的坐标改回去。
   修法：给 `clampCanvasViewport` 增加第 5 个参数 `topInset`（默认 0，向后兼容），
   居中分支在 `[inset, height]` 内居中，溢出分支上界放宽到 `gutter + inset`；
   `GridCanvas` 仅在「移动端 + 多板」时传 `MOBILE_CANVAS_CONTROL_BAND = 56`。
   实测三档：390 / 360 / 320 下内容起点 108 / 107 / 107，胶囊底 58，**全部无重叠**。
2. **坐标数字几乎看不见**。它按 `canvasBackdrop === 'dark_grid' ? '#E2E8F0' : '#334155'` 取色，
   而本项目所有底板都是浅色，"dark_grid" 只是名字 → 近白色号写在浅桌面上。改为恒用 `#334155`。
   顺带把聚光遮罩限制在网格区内（不再压暗上方与左侧的标尺条）。

## 13.5 验证

- `tsc` 通过；`vitest --no-file-parallelism` **1483 passed / 3 skipped**（130 文件）。
- 像素级断言：用 canvas `getImageData` 找板框（跳过 `alpha < 200` 的遮罩像素），与胶囊 DOM 底边比较。
- 触控审计：390/360 仅剩 `sr-only` 文件输入；320 有 5 个 41px 控件（8 个控件按 44px 排需 352px，物理放不下）。

---

# 第六轮：分板导航从「遮挡画布」搬到「底部标签条」

## 14.1 改之前的实测（390×844）

| 元素 | 位置 | 问题 |
|---|---|---|
| 分板胶囊 `第 1/6 板 / 点此回全图` | `left-2 top-2`，174×50 | **压在网格第 1–4 行上**，正好盖住左上角起手区 |
| 缩放簇（适应/全屏/放大/缩小） | `right-2 bottom-2.5`，192×54 | 占掉画布底部整条，**聚焦板最后两行被盖住** |
| 尺寸胶囊 `79 × 44 豆 · 6 板` | `left-2 bottom-2.5`，146×31 | 与缩放簇一起把底部 390px 占满 |
| 内容顶部预留带 | `MOBILE_CANVAS_CONTROL_BAND = 56` | 为了躲胶囊，画布白白少 56px 可用高度 |

另外「跳板」只能靠 ‹ › 一格一格挪：1 → 6 要连点 5 次。

## 14.2 改之后

**分板导航变成停靠式标签条**，放在画布与工具条之间（`MobileWorkspace` 里，行高 56）：

```
[▦ 全图]  1  2  3  4  5  6      ← 横向可滚，当前板实心紫；活动标签自动滚到可视区
```

- 任何一板都是**一次点击直达**，不再连点。
- 标签条**在文档流里**，不浮在画布上，永远不可能盖住格子。
- 在拇指区（HIG 1.3「主要动作放底部」），单手可达。
- 单板图纸（`totalBoards === 1`）不渲染这一行，零成本。

**顶部预留带删除**：胶囊没了，`MOBILE_CANVAS_CONTROL_BAND` 与
`clampCanvasViewport` 的第 5 个参数 `topInset` 一并删掉（已无调用方，测试也没覆盖它）。

**新增底部控制带 `MOBILE_CANVAS_BOTTOM_BAND = 64`**：聚焦板取景时
`availH` 与 `centerY` 都减掉这条，保证板子（含行列标尺）完整落在缩放簇上方。
实测 390×844 聚焦第 3 板：纸面 `top 35.6 / bottom 483.4`，画布高 560，缩放簇从 496 起 → **无重叠**。

## 14.3 实现要点（接手别踩）

`GridCanvas` 不再自己画分板导航，改成对外暴露两个可选 prop：

```ts
boardNavApiRef?: MutableRefObject<BoardNavApi | null>;   // { focusBoard(i), showWholePattern() }
onBoardNavStateChange?: (s: BoardNavState) => void;      // { focusedBoard, totalBoards }
```

- 状态仍**只存在 GridCanvas 内部**（`focusedBoard`），外壳只镜像一份用来高亮，不反向控制，避免双份真相。
- 两个 prop 都是可选的：桌面端不传，行为完全不变（`canvasBottomBand` 在 `desktop` 下恒为 0）。
- `MobileWorkspace` 用 `useRef` 拿 API、`useState` 存镜像；活动标签用 `scrollTo` 手动滚动，
  **不要用 `scrollIntoView`**——在 iOS 上会把整个文档一起滚走。

## 14.4 顺带修好的工具链坑（会反复咬人）

| 坑 | 现象 | 处置 |
|---|---|---|
| 无头 Chrome 合成器不出新帧 | 截图与上一张**字节完全相同**，看起来"改了没生效" | `cdp.mjs` 结尾连拍两张，取第二张；测量前先空拍一帧 |
| `__gc` 调试快照写在 effect 里 | effect 依赖只有 `focusedBoard`，zoom 变了不重跑 → 读到旧值，误判"取景失效" | 调试值写在 render 体里，或直接读 `__flush` 队列 |
| 实时操作台的 Chrome 会白屏卡死 | `/health` 正常、`#root` 为空、`Page.navigate` 也救不回来 | 杀掉 3030 端口进程重启 `server.mjs`；HUD 的 SSE 会自动重连 |

## 14.5 验证

- `tsc` 通过；`vitest --no-file-parallelism` **1483 passed / 3 skipped**（130 文件）。
- 看板实跑：点「第 3 板」→ 断言 `aria-pressed` 命中 `3`；点「全图」→ 断言全图按钮 `aria-pressed=true`；
  画布页 44px 触控断言通过（0 个 <44px 控件）。
- 360×640 压力测试：画布 356、标签条 56、两行工具栏各 56，合计正好占满，无横向溢出。

---

# 第七轮：转图页的入口收敛（一个返回、一个主操作）

## 15.1 病灶：一屏三个出口，主操作还叫「应用」

390 宽实测，转图页同时存在：

| 控件 | 行为 | 结果 |
|---|---|---|
| 顶部 `‹ 返回` | 回首页 | 与下一个只差一行，容易点错 |
| 页内 `‹ 返回画板` | 回画布 | 和顶部返回是两件事，但长得一样 |
| 标题行 `×` | 回画布 | 与「返回画板」完全重复 |
| 标题行右侧紫色 `应用` | **重算图纸 + 回画布** | 名字是「应用」，没人知道它其实是「生成图纸」 |

**根因是信息架构，不是样式**：转图 / 用量是底部 dock 里的**同级 tab**，不是被 push 出来的子页面。
iOS HIG 的 tab 不带返回键（返回靠 tab 自身），这两个页面却各做了一套「返回 + 标题 + 完成」的子页栏，
于是既多出返回键，又多出一个和面板标题重复的大标题（`转图与算法设置` vs `拼豆转换参数设置`）。

## 15.2 改法

**转图页**

- 删掉整条子页栏（返回画板 / 转图与算法设置 / 应用）。
- 面板自带「拼豆转换参数设置 + 重置」，标题不再重复。
- 主操作改为**贴底常驻的整行按钮**，永远不用滑到列表尽头：
  - 有图 → `✨ 生成图纸`（黄色星标 + 紫色实心，宽 366/430 下 406）
  - 无图 → `🖼 先上传图片`（直接跳首页选图；旧版此时**根本没有生成入口**，因为底部按钮被 `hasImage` 挡住）
- 返回只剩一个：底栏的「画布」tab。

**用量页** 同样的病（返回画板 + 完成 + ×，三个都回画布），一并清成「只有内容 + 面板自带标题」。

**SettingsPanel** 新增 `hideFooterAction`：移动端已经用常驻底栏承担提交，面板末尾不再重复一个
「重新计算拼豆图纸」，否则又变成两个提交按钮。

## 15.3 为什么不用「保留两个返回」

底部 dock 一直在屏幕上，「画布」tab 就是返回；再加页内返回属于同一个动作的第三个副本。
少一个按钮不等于少一条路——这条路本来就在拇指下面。

## 15.3b 补丁：无图时那颗按钮原本点了没反应

第一版把「先上传图片」写成 `onNavigateTab?.('home')`——想的是「回首页自己找上传入口」。
两个错误叠在一起：

1. `MobileWorkspace` 的 `onNavigateTab` **App 从来没传过**（可选 prop，一直是 undefined），
   所以这颗按钮点了**完全没反应**，比跳转更糟。
2. 就算跳了也是绕路：用户在转图页，想上传就该当场弹出选择器。

修法（`MobileWorkspace` + `App`）：

- 新增 `onImageUpload?: (file: File) => void`，App 传 `onImageUpload={handleImageUpload}`——
  和首页「上传图片」**同一条链路**，转换完自动打开图像工作坊。
- 新增一个隐藏的 `<input type="file" accept="image/*">`，用项目现成的
  `consumeSelectedImageFile()` 取值（和 Header / Home / Landing / MobileHeaderNav 一致）。
- 按钮逻辑：无图 → `imageFileInputRef.current?.click()`；有图 → `applyConversionSettings()`。
- 顺手删掉 `MobileWorkspace` 那个从未被传值的 `onNavigateTab` prop。

验证：点按钮命中的是 `input[type=file][accept="image/*"]`（第 4 个文件输入），
塞图后同一个按钮文案变「生成图纸」。契约写进 `ToolEntryPoints.test.ts`。

## 15.4 验证

| 项 | 结果 |
|---|---|
| 转图页出现 `返回画板` | 0 |
| 转图页出现 `应用` 按钮 | 0 |
| 关闭设置 `×` | 0 |
| 无图时主按钮 | `先上传图片`，宽 366（390 视口） |
| 有图时主按钮 | `生成图纸`，宽 366 / 406（390 / 430 视口） |
| 面板内重复提交按钮 | 0 |
| 复选行可点区域 | label 整行 366×52，非 16×16 |
| `tsc` | 通过 |
| `vitest --no-file-parallelism` | **1483 passed / 3 skipped**（130 文件） |

`hasImage` 状态用真实上传验证：把 `public/images/chibi-character.jpg` 塞进首页的 `input[type=file]`，
分发 `change` 事件，等转换完成后关掉工作坊，再切到转图页读按钮文案。

---

# 第八轮：同一张参数表出现了两次

## 16.1 病灶

`拼豆转换参数设置` 在移动端有**两份完全相同的实例**：

| 入口 | 位置 | 结果 |
|---|---|---|
| 底栏「转图」tab | `MobileWorkspace` 里 | 正常，这是它的归属 |
| 底栏「更多」→「参数设置」tab | `MobileFeatureSheet` 里 | 同一张表再出现一次，还多一个二级 tab 切换 |

用户看到的不是「两个入口」，而是**同一个东西被复制了一份**：在转图页改完尺寸，切到更多里还是那张表，
改另一个地方也看不出区别，只会怀疑哪一份才算数。

## 16.2 改法：只保留一个归属

- 删掉 `MobileFeatureSheet` 的「参数设置」二级 tab（连同 `activeTab` 状态、tablist、
  `conversionSettingsContent` / `usageContent` / `initialTab` 三个 prop）。
- 工具面板回到单一面板：**画板工具箱 & 视图控制**——只管渲染质感、辅助线、对称、底色、缩放这些
  「看」的东西，不再碰「转」的参数。
- `MobileWorkspace` 里那份只喂给 sheet 的 `conversionSettingsContent` 一并删除，避免留死代码。

职责边界因此变得可陈述：**转图 = 参数与生成；更多 = 视图与质感**。

## 16.3 验证

- `document.querySelectorAll('[role=tab]')` 在画布页只剩 3 个（画布 / 转图 / 用量），
  工具箱里没有 tablist。
- 打开「更多」后全文不含 `拼豆转换参数设置`。
- `<SettingsPanel>` 全项目只剩两处渲染：桌面侧栏、移动端转图 tab。
- `tsc` 通过；`vitest --no-file-parallelism` 全绿（见下）。

---

# 第九轮：底栏「更多」改名「工具箱」

## 17.1 为什么改

「更多」是个兜底词——用户不知道里面有什么，只能一个个点开看。既然这一格现在只管
「画板长什么样、辅助线开不开、用什么底色、缩放多少」加几条次要动作，就该叫它实际的名字：

| | 旧 | 新 |
|---|---|---|
| 底栏标签 | 更多 | **工具箱** |
| 图标 | `MoreHorizontal`（⋯） | `Wrench`（扳手） |
| aria-label | 更多工具与视图设置 | 画板工具箱 |
| 面板标题 | 画板工具箱 & 视图控制 | 画板工具箱 |

## 17.2 改动

按钮宽度 `w-12` → `w-14`（3 个汉字在 390 下不折行）。
`UserProfileModal.browser.fixture.tsx` 里按 aria-label 点击的那一行同步改为「画板工具箱」，
并写进第 5 节的测试契约（第 9 条），避免下次改名时静默点空。

## 17.3 备选名与被否原因

| 候选 | 否掉的理由 |
|---|---|
| 视图 | 更贴内容，但里面还有导出 / 导入 / 清空画板，名不副实 |
| 设置 | 直观，但会和「转图」里那套参数设置打架 |
| 工具 | 与工具条（画笔/油漆桶/吸管/橡皮）撞名 |

---

# 第十轮：去掉「导入项目 JSON / 导出项目 JSON」

## 18.1 为什么删

这两个入口是**工程文件**的保存/打开，服务的是「换设备继续编辑」这类低频需求。现状是：

- 移动端「工具箱」里占了两格彩色卡片（天蓝 + 翠绿），比「区域清除」「自动裁剪」还显眼；
- 桌面端藏在 Header 的折叠菜单里，一屏只有两个按钮的位置；
- 名字对普通用户是黑话——「JSON」不是拼豆用户会说的词。

真正需要带走作品的人，有更直白的路径：导出图纸（图片/图纸/物料单）、云端图纸库。工程文件这个能力先收起来，不做入口。

## 18.2 删了什么（全链路，不留死代码）

| 层 | 文件 | 删除内容 |
|---|---|---|
| 移动工具箱 | `mobile/MobileFeatureSheet.tsx` | 两张卡片 + `onRequestImportJson` / `onExportJson` 两个 prop |
| 移动工作区 | `mobile/MobileWorkspace.tsx` | 两个 prop、`jsonImportError` 状态、`jsonFileInputRef`、`handleJsonFileInputChange`、`handleRequestImportJson`、隐藏 `input[accept="application/json,.json"]`、错误横幅 |
| 移动头部 | `mobile/MobileHeaderNav.tsx` | 两个 prop、`jsonInputRef`、`handleJsonChange`、隐藏 `input[accept=".json"]`（本来就没有触发按钮，是纯死代码） |
| 桌面头部 | `Header.tsx` | 两个 prop、`jsonInputRef`、`handleJsonChange`、折叠菜单里的「打开工程 / 保存工程」按钮组、`FolderOpen` / `FileJson` 图标导入 |
| 应用层 | `App.tsx` | `handleExportJson`（60 行）、`handleImportJson`（30 行）、三处传参、`ProjectData` 类型导入 |
| 工具层 | `utils/exportUtils.ts` | `downloadProjectJson()`（唯一调用方已删） |
| 文案 | `context/LanguageContext.tsx` | `openProject` / `saveProject` 两个 key（中英各一对） |
| 测试夹具 | `NavigationVisibility.test.ts`、`MobileHeaderNav.overflow.test.ts` | 两个已不存在的 prop 桩 |

> `AssemblyWorkspace.tsx` 里还有一个「导入项目」，那是立体拼豆（已隐藏功能）的，不动。

## 18.3 布局副作用与修法

工具箱卡片是 `grid grid-cols-2`，删掉两张后剩 9 张（`清理残点` 条件渲染时），最后一张「自动裁剪黑白边」会单独占半行、右边空一格。

修法：给它加 `col-span-2`，变成有意的整行收尾。现在是整齐的 4 对 + 1 整行：

```
导出图纸      实操模式
区域清除      清理残点
星格会员      智能精准省豆
品牌色号卡库  云端图纸库
自动裁剪黑白边（整行）
```

## 18.4 验证

| 项 | 结果 |
|---|---|
| 工具箱出现「导入项目」/「导出项目」 | 0 |
| 画布页 `input[type=file][accept*=json]` 数量 | 0 |
| 剩余卡片渲染 | 9 张，最后一张 `col-span-2` 整行 |
| `tsc` | 通过 |
| `vitest --no-file-parallelism` | **1484 passed / 3 skipped**（130 文件） |

---

# 第十一轮：移动端首页不再放「社区作品 / 社区创作者」

## 19.1 先量，再判断（390×844）

| 元素 | 距首页顶部 | 高度 | 结论 |
|---|---|---|---|
| 社区作品 section | **1009** | 218 | 首屏 844 之外，要多滚 165px 才看到 |
| 社区创作者 aside | 1251 | 130 | 更远 |
| 两块合计 | — | **380** | 占首页总高 1493 的 25% |
| 隐藏后首页总高 | — | **1093** | 少 400px |

也就是说：**首页主体（hero + 示例 + 工具卡）已经占满一屏多，社区内容排在第二屏**。用户要么不滚（永远看不到），
要么滚到了——而你截图里那一刻正好是「正在加载社区作品…」，一整块 218px 的空白加一个转圈，没有任何可操作内容。

## 19.2 为什么该删（四条）

1. **入口重复三次**：底栏「豆社」tab、hero 里的「探索社区作品」、工具卡「豆社灵感」。
   首页正文再整块铺一次，是同一个目的地铺第四遍。
2. **它不服务首页任务**。首页要解决的是「上传一张图 → 出图纸」。社区是内容消费，属于「看完再创作」的另一条路。
3. **加载态是负资产**。社区列表是网络请求，首页挂载就发；慢网下用户滚到这里只看到转圈，比没有更糟。
4. **首屏高度很贵**。390×844 下 hero 已经占 700+，任何不属于创作流的整块内容都在挤压示例和工具卡。

## 19.3 怎么删的（不是 CSS 隐藏）

只加 `hidden lg:hidden` 之类的类名，**数据请求照样发**——因为 `useEffect` 在挂载时就 fetch。
这次用 prop 控制，连请求一起停：

```tsx
// HomeView.tsx
showCommunityFeed?: boolean;   // 默认 true，桌面不受影响

useEffect(() => {
  if (!showCommunityFeed) return;   // 手机端不发 /api/community/posts
  ...
}, [communityRequest, showCommunityFeed]);

{showCommunityFeed && (
  <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 pt-2"> … </div>
)}
```

```tsx
// App.tsx
<HomeView … showCommunityFeed={isDesktop} />
```

- `useIsDesktop()` 的断点是 1024，与 Tailwind `lg` 一致，不会出现「CSS 显示了但没请求」的错位。
- 默认值 `true`：其他调用方（测试、story）不传也保持原行为。
- 桌面 1280 实测：`#home-community-title` / `#home-creators-title` 仍在，`/api/community/posts` 照常请求。

## 19.4 验证

| 项 | 390×844 | 1280×900 |
|---|---|---|
| `#home-community-title` | 不存在 | 存在 |
| `#home-creators-title` | 不存在 | 存在 |
| 首页文档高 | 1093（原 1493） | 1065 |
| `/api/community/posts` 请求 | **无** | 有 |
| 首屏内容 | hero + 示例 + 快捷工作台 | 三列，社区作品占 3/4 |

> 页面里仍能搜到「社区作品」四个字，来源是 hero 的「探索社区作品」按钮（首屏 CTA），那是入口不是内容块，保留。

---

# 第十二轮：导航栏不再压内容（高度契约化）

## 20.1 现象与真正的根因

首页滚到底，「大画板」卡片被底部导航栏盖住 68px（卡片 78 高，只露出 10px）。

第一反应会去加 `pb`，但实测说明问题不在 padding：

```js
// 修前，390×844
HomeView 根      rect.top = 114   clientHeight = 844   paddingBottom = 112px
app-shell-height rect.top = 0     height = 844
```

**滚动容器自己比视口高 114px**：它从 header 下面 y=114 开始，却仍有 844 高，底边跑到 y=958。

原因是一对互相打架的类：

```
flex-1   → flex: 1 1 0%     （应该占「剩余空间」= 844 − 114 = 730）
min-h-full → min-height: 100%（相对父容器，直接等于 844）
```

`min-h-full` 赢了。于是那 112px 的底部留白**整段落在视口之外**——看起来就是「padding 加了也没用」。
社区页 `CommunityView` 是同一套写法，同一个 bug。

## 20.2 顺带发现的第二处遗漏

`LargeCanvasView` 写的是 `p-4 pb-24 sm:p-6`。Tailwind 里 `sm:p-6` 会在 ≥640px 覆盖 `pb-24`，
而底栏直到 1024px 才消失 → **640–1023px（平板竖屏）区间底部只留 24px**，最后一排标尺滚不出来。

## 20.3 新逻辑：导航栏高度是一个契约，不是每页猜的数字

```css
/* src/index.css */
:root {
  --mobile-nav-height: 54px;    /* 实测：min-h-11 内容 + py-1 + 边框 */
  --mobile-nav-offset: 12px;    /* 悬浮条距底部 */
  --mobile-nav-gap: 16px;       /* 内容与条的呼吸 */
  --mobile-nav-clearance: calc(
    var(--mobile-nav-height) + var(--mobile-nav-offset) + var(--mobile-nav-gap) + var(--safe-bottom)
  );
}

@media (max-width: 1023px) {
  /* 双类名：压过 sm:p-6 / pb-24，不受 Tailwind 生成顺序影响 */
  .mobile-nav-clearance.mobile-nav-clearance { padding-bottom: var(--mobile-nav-clearance); }
}
```

四个页面统一：`HomeView`、`CommunityView`、`LargeCanvasView` 的滚动区，以及后续任何新的移动端页面。
同时把 `min-h-full` 改成 `min-h-0`（这是 flex 子项的正确写法：允许收缩到剩余空间）。

以后要改导航栏高度，只动 `--mobile-nav-height` 一个数字，四个页面自动跟上；
新增页面忘了加这个类，`dvh` 之外的溢出也不会再出现（因为根因 `min-h-full` 已清掉）。

## 20.4 验证

| 场景 | 指标 | 修前 | 修后 |
|---|---|---|---|
| 390×844 首页 | 滚动容器 clientHeight | 844（溢出 114） | **730** |
| | 容器底边 | y=958（超出视口） | **y=844** |
| | padding-bottom | 112（全在屏外） | **82** |
| | 大画板卡片 | 768–846，被遮 **68px** | 684–762，**距导航 16px** |
| 360×640 首页 | 大画板卡片 vs 导航 | 不可见 | 558 vs 574，**间距 16px** |
| 768×1024 大画板页 | 滚动区 padding-bottom | 24（被 sm:p-6 压掉） | **82** |
| 390×844 社区页 | 滚动容器 / padding | 844 / 112 | **730 / 82** |
| 1280×900 桌面首页 | 无导航栏 | 正常 | 正常（`lg:` 不套用契约） |

## 20.5 没动的一处（留给产品决定）

首页「快捷工作台」5 张卡里，`进入画板` / `豆社灵感` / `大画板` 三个目的地**底栏已经有同名 tab**。
这是「首页负责引导」还是「重复入口」属于产品判断：删掉会让首页更短更聚焦，保留则方便新用户照着卡片走。
本轮只修遮挡，不动信息架构。

---

# 第十三轮：移动端控件尺寸与字号统一

## 21.1 改前实测：一屏里 6 种字号、7 种高度

转图页（390×844，37 个可见控件）：

| 维度 | 改前分布 |
|---|---|
| 字号 | `9px` / `10px` / `11px` ×25 / `12px` / `12.5px` / `13px` / `14px` / `16px` |
| 高度 | 28 / 35 / 40 / 44 ×26 / 47 ×7 / 48 / 50 ×7 / 54 / 58 |

最刺眼的是 `text-[11px] sm:text-[10px]`——**手机 11px、桌面 10px**，大屏反而更小。
另有 14 处 10px 和 1 处 9px，低于之前定的 11px 可读下限。

高度上，`min-h-11` + `py-1.5` 会算出 47px，`p-2` 的双行卡会撑到 50px，同一列控件肉眼可见参差。

## 21.2 规范（移动端，<1024px）

| 角色 | 字号 | 高度 | 圆角 |
|---|---|---|---|
| 面板区块标题 | 14 (`text-sm`) | — | — |
| 控件标签（"背景移除"） | 13 (`text-[13px]`) | — | — |
| 辅助说明 | 12 (`text-xs`) | — | — |
| 输入框 / 下拉 | 16 (`text-base`，iOS 防缩放) | **44** | 12 (`rounded-xl`) |
| 主按钮（贴底） | 14 | **48** | 16 (`rounded-2xl`) |
| 次按钮 / 分段 | 14 | **44** | 12 |
| 图标按钮 | — | **44×44** | 12 |
| 复选框 | 20 (`w-5 h-5`) | 由 label 整行承担 ≥44 | 小圆角 |
| 双行功能卡 | 12 标签 + 12 说明 | ≥48，内容撑开（54–58） | 16 |

四条规则：**字号只用 12 / 13 / 14 / 16；高度只用 44 / 48（卡片可更高）；输入类必须 16；圆角只用 12 / 16。**

## 21.3 改动清单

| 文件 | 改动 |
|---|---|
| `SettingsPanel.tsx` | 说明 `text-[11px] sm:text-[10px]` → `text-xs`（12 处）；控件标签 → 13px（4 处）；分段按钮 → 14px；尺寸预设卡 `p-2` → `h-12`；下拉 `min-h-11 py-1.5`(47) → `h-11`(44)；复选框 16→20px；说明文字 `leading-none` → `leading-snug`（12px 字配 12px 行高会粘） |
| `StatsPanel.tsx` | 9/10/11px → 12px（29 处）；「应用到当前网格」28px → 44px；色号搜索框 35px → 44px |
| `MobileFeatureSheet.tsx` | 11px → 12px（26 处） |
| `CommunityView.tsx` | 10/11px → 12px；主按钮 13 → 14px |
| `HomeView.tsx` | 11px → 12px；hero 四个 CTA `text-[12.5px]` → `text-sm`（15 档 → 14 档） |
| `CompletionSummary.tsx` | 10/11px → 12px |
| `MobileWorkspace.tsx` | 11px → 12px；工具按钮 13 → 14px |

底栏标签保留 11px：那是图标下的短标签，放大后会挤压五项宽度，且不属于「正文」。

## 21.4 验证

| 页面 | 改后字号 | 改后高度 |
|---|---|---|
| 转图 | 12 / 14 / 16 | 44 ×26、48 ×1、checkbox 20 ×3 → **非 44/48 只剩复选框，且在整行 label 内** |
| 首页 | 12 / 14 / 16 | 44、78（双行卡）、86（示例缩略图） |
| 豆社 | — | **非 44/48 项 0** |
| 用量 | 12 / 16 | 44 |
| 工具箱 | 12 / 16 | 44、54（形状选择）、58（双行卡） |

`tsc` 通过；`vitest --no-file-parallelism` **1484 passed / 3 skipped**。

## 21.5 工具坑：批量替换别顺手合并空格

第一版脚本里带了 `s.replace('  ', ' ')` 想清理多余空格，结果把**全文件缩进砍半**——
`CompletionSummary` 一次 diff 240 行、`MobileWorkspace` 1346 行，功能没坏但可读性全毁。

恢复方式：逐行匹配行首空格、数量 ×2（4→2→4，2→1→2 是可逆的）。恢复后 diff 回到 18 / 56 行，只剩字号改动。

**规矩**：批量改 class 就用精确字符串替换，不要附加任何「顺手清理格式」的正则。

---

# 第十四轮：原生下拉换成底部选择面板

## 22.1 为什么原生 `<select>` 修不了

`<select>` 的**选项列表由操作系统/浏览器绘制**，页面 CSS 管不到。于是两个问题都是硬伤：

| 现象 | 原因 |
|---|---|
| 弹层位置偏离输入框，压住上方内容 | iOS/Android 自己决定弹出位置，`position`、`transform` 一律无效 |
| 选项文字特别大 | 上一轮为了防 iOS 自动缩放，把 `select` 强制成 16px；这个字号会传导到系统绘制的选项列表 |

所以不是「调一下样式」，是必须换成自绘组件。

## 22.2 新组件 `ui/MobileSelect.tsx`

```
[ MARD · 当前图纸快照                    ⌄ ]   ← 44px 按钮，14px
        ↓ 点击
┌────────────────────────────────┐
│ 最大使用颜色数量限制        取消 │   ← 贴底面板，满宽
│ ✓ 不限制 (智能全配卡)            │   ← 当前项紫色 + 勾，48px
│   12 色套组                      │
│   24 色套组                      │
└────────────────────────────────┘
```

- **位置由自己决定**：`fixed inset-0` + `items-end`，永远贴视口底部，不存在「飘到别处」。
- **字号自己定**：选项 14px（不是 16），行高 48px，符合上一轮的 44/48 规范。
- **三种关闭**：点遮罩、点「取消」、按 Esc。
- 无障碍：触发器 `aria-haspopup="listbox"` / `aria-expanded` / `aria-controls`，面板 `role="listbox"`，选项 `role="option"` + `aria-selected`，打开后焦点进面板。

## 22.3 只在手机换，桌面不动

桌面侧栏的原生下拉是系统级体验（可键盘输入首字母跳转、可用滚轮），没有理由替换。
所以 `SettingsPanel` 按 `variant` 分支：

```tsx
variant === 'sheet' ? <MobileSelect … /> : <select …>…</select>
```

两个下拉（选用拼豆色卡 / 最大使用颜色数量限制）各一份 options 数组，两种控件共用同一份 label，
避免手机和桌面文案不一致。

## 22.4 验证（390×844）

| 项 | 结果 |
|---|---|
| 自定义触发器数量 | 2（品牌 / 颜色数量） |
| 面板底边 | **844 = 视口底**（`anchoredToBottom: true`） |
| 面板宽度 | 390（满宽） |
| 选项数 / 高度 / 字号 | 6 / **48px** / **14px** |
| 点「24 色套组」 | 按钮文案变「24 色套组」，面板自动关闭 |
| Esc / 遮罩 / 取消 | 均可关闭 |
| 1280×900 桌面 | 原生 `select` 2 个，自定义触发器 **0** |

> 本地品牌目录接口 404（顶部「色卡读取失败」横幅），品牌下拉因此处于 disabled 状态，这是既有保护逻辑，不是本次改动引入。

## 22.5 后续若再加下拉

直接用 `MobileSelect`，不要再写 `<select>`：

```tsx
<MobileSelect
  value={String(v)}
  options={[{ value: '0', label: '不限制' }, …]}
  onChange={next => setV(Number(next))}
  ariaLabel="面板标题，同时作为无障碍名称"
  isEn={isEn}
/>
```

`ariaLabel` 会同时用于触发器与面板标题——写「选用拼豆色卡」这种名词短语，不要写成动词。

---

# 第十五轮：把 PC 端从移动端改动里摘出来

## 23.1 结论先说：确实没有隔离

前面几轮改的是共享组件（`HomeView` / `SettingsPanel` / `StatsPanel` / `CommunityView`），
字号和尺寸是直接写在 class 上的，**没有加 `lg:` 或 `max-lg:` 分界**。于是手机端的规范原样落到了 PC。

## 23.2 三个具体病灶（用 HEAD 版本对照出来的）

为了不靠肉眼争，`git worktree add ../pindou-compare HEAD` 拉出改动前的基线，软链接 `node_modules`，
在 3001 起了第二个 dev server，两个端口并排量。结果：

| 项 | 基线（HEAD） | 改坏后 | 原因 |
|---|---|---|---|
| PC 首页主标题 | **48px** | **16px** | `<h1>` 上同时写了 `lg:text-[16px]` 和 `lg:text-5xl`，任意值那条赢了 |
| PC 首页 hero 高度 | 507 | 536 | 示例区标题从浮层改成块级，多占一行 |
| 「示例卡」top | 176 | 218 | 同上 + 提示条变高 |
| 画板侧栏可视高度 | 743 | 723 | 提示条按钮 `h-11`(44) 把横条从 38 撑到 57 |
| 侧栏控件标签 | 11px | 13px | 移动端统一字号，没有桌面覆盖 |
| 侧栏说明文字 | 10px | 12px | 同上 |

主标题那一条是最刺眼的：PC 用户打开首页，看到的是 16px 的「一粒一粒 织出像素星格」。

## 23.3 修法

**1. 删掉冲突类**
```diff
- <h1 className="text-[22px] lg:text-[16px] sm:text-3xl md:text-4xl lg:text-5xl …">
+ <h1 className="text-[22px] sm:text-3xl md:text-4xl lg:text-5xl …">
```
`text-[22px]` 负责手机，`sm:/md:/lg:` 负责桌面，一个轴只留一条规则。

**2. 桌面字号逐处回填 `lg:` 覆盖**

用脚本把 `git diff` 的「旧行 → 新行」配对（`difflib.SequenceMatcher`，按去掉字号后的行做对齐），
再把每处新字号补上桌面原值：

```
text-xs   → text-xs lg:text-[10px]
text-[13px] → text-[13px] lg:text-[11px]
text-sm   → text-sm lg:text-[11px]
```

| 文件 | 回填处数 |
|---|---|
| `SettingsPanel.tsx` | 24 |
| `StatsPanel.tsx` | 20 |
| `CompletionSummary.tsx` | 9 |
| `CommunityView.tsx` | 6 |
| `HomeView.tsx` | 1 |

**3. 提示条按钮：手机 44，桌面 28**
```diff
- className="h-11 shrink-0 rounded-xl border border-amber-300 bg-white px-3 …"
+ className="h-11 shrink-0 rounded-xl border border-amber-300 bg-white px-3 … lg:h-7 lg:rounded-lg lg:px-2"
```
44px 是触控下限，桌面用鼠标不需要它把整条横幅撑高 19px。

**4. 示例区标题：手机块级，桌面浮层**
```diff
- <div className="bg-white/10 …">
-   <span className="mb-1.5 block text-xs font-bold text-purple-100">官方起始示例</span>
+ <div className="relative bg-white/10 …">
+   <span className="mb-1.5 block text-xs font-bold text-purple-100 lg:absolute lg:left-3 lg:top-2 lg:mb-0 lg:text-[10px]">官方起始示例</span>
```

## 23.4 验证（1440×900，与 HEAD 并排）

| 项 | 基线 | 修复后 |
|---|---|---|
| 主标题字号 | 48px | **48px** |
| hero 高度 | 507 | **514** |
| 示例卡 top | 176 | **180** |
| 工作台卡 top | 704 | **708** |
| 侧栏 clientHeight | 743 | **739** |
| 侧栏 scrollHeight | 1150 | **1156** |
| 侧栏标签字号 | 11px | **11px** |
| 提示条高度 | 38 | **39** |
| PC 豆社字号分布 | 14×6 / 12×11 / 10×2 / 11×1 / 16×1 | **完全一致** |
| 移动端 390 主标题 | — | **22px（未受影响）** |

残留的 4–6px 差异来自提示条文案本身变长（不再暴露 `Unexpected token '<'` 这类原始错误），属于有意保留。

## 23.5 加了防回归的契约

`src/components/desktopIsolation.test.ts`：

1. `<h1>` 必须同时有 `text-[22px]` 和 `lg:text-5xl`，且**不得**再出现第二个 `lg:text-[..px]`；
2. `SettingsPanel` 的桌面覆盖 ≥20 处、`StatsPanel` ≥15 处（少了说明有人又把 `lg:` 抹掉）；
3. 品牌目录提示条的按钮必须 `h-11` + `lg:h-7`（手机可点、桌面不撑高）。

## 23.6 以后的规矩

- 动共享组件时，**移动端专用尺寸一律加 `lg:` 反向覆盖，或写成 `max-lg:` 限定**。
- 一个元素上不要同时出现两个同断点的字号（`lg:text-[16px]` + `lg:text-5xl`）——CSS 输出顺序不可依赖。
- 改完必须用 1440 宽复看一次，不能只在 390 下验收。

## 23.7 附：并排对照的做法（会重复用到）

```bash
git worktree add ../pindou-compare HEAD          # 拉出基线
# Windows 下给基线目录建 junction，避免重装依赖
# New-Item -ItemType Junction -Path …\pindou-compare\node_modules -Target …\pindouwangge\node_modules
cd ../pindou-compare && ./node_modules/.bin/vite --host 127.0.0.1 --port 3001
# 两个端口跑同一个探针脚本，比数值而不是比印象
git worktree remove ../pindou-compare --force
```

---

# 24. 侧栏面板尺寸、桌面契约与风险防控（第 16–19 轮）

## 24.1 症状：一屏里九种高度、五种字号

用户截了 1080×768 的图（= 1440 CSS 宽 @0.75），一句话点出问题：
「有的按钮大，有的小，有的字体大，有的字体小。很明显就这个下拉框都变形了，没有体积了。」

在 1440×1024 下把左栏每个 `button/select/input` 的真实 `getBoundingClientRect().height` 打出来：

| 控件 | 改前 | 改后 |
|---|---|---|
| 重置 | **16** | 32 |
| 下拉框 ×2 | **20** | 32 |
| 数字输入（宽/高） | 30 | 32 |
| 保持比例按钮 | 32 | 32 |
| 转换模式 ×4 | 30 | 32 |
| 抖动算法 ×2 | **34 / fs 14px** | 32 / fs 11px |
| 板型预设 ×8 | **48** | 40（两行卡片） |
| 滑块 | 16 / 20 | 24 |
| 复选框 | 20 | 16 |
| 右栏：复制用量 | 25 | 32 |
| 右栏：轻度/标准/强力 | 23 | 32 |
| 右栏：应用到当前网格 | 44 | 32 |
| 右栏：搜索框 | 44 | 32 |

## 24.2 根因只有三条，但每条都很隐蔽

1. **`sm:h-auto sm:min-h-0` + `py-0` 把 `<select>` 压成 20px。**
   select 没有内容撑高，`sm:` 断点（640px）一过就 `height:auto; min-height:0; padding-block:0`，
   只剩 12px 行高。这就是"没有体积"。
2. **同一个元素上两种单位打架。** 有的用 `sm:`（640），有的用 `lg:`（1024），
   在 1080 这种"刚过 lg"的宽度上两套规则同时命中，谁赢取决于 Tailwind 的输出顺序。
3. **`text-sm` 没有配 `lg:` 覆盖。** 抖动两个按钮是唯一写死 `text-sm` 的控件，于是 14px
   夹在一排 11px 里，比旁边的模式按钮大三号。

## 24.3 新契约：`src/components/ui/panelScale.ts`

一个函数，两套值，按 `variant` 二选一，**不再用断点互相覆盖**：

| token | sidebar（桌面） | sheet（移动） |
|---|---|---|
| `control`（按钮/下拉/输入） | `h-8 text-[11px]` = 32 | `h-11 text-sm` = 44 |
| `chip`（两行预设卡） | `h-10` = 40 | `h-12` = 48 |
| `sectionTitle` / `panelTitle` | 12 / 13 | 14 / 15 |
| `cardTitle` / `body` / `micro` | 11 / 10 / 10 | 13 / 12 / 12 |
| `iconBtn` / `headerBtn` / `primary` | 32 / 32 / 36 | 44 / 44 / 48 |
| `card` / `row` | `p-2` / `p-1.5` | `p-3` / `p-2.5` |

`StatsPanel` 之前没有 `variant`（`w-full lg:w-80` 一套代码两端用），这轮补了
`variant?: 'sidebar' | 'sheet'`，`MobileWorkspace` 传 `sheet`，`DesktopWorkspace` 默认 `sidebar`。
移动端抽屉里外层已经有 `p-3`，所以 sheet 的容器 padding 归零，不再双重留白。

## 24.4 顺带收掉的两处

- **Header 右上角一排胶囊**：会员 26 / 登录 26 / 使用指南 28 / 智能省豆 30 / EN 30 / 签到 32，
  六种高度。统一成 `h-8` + `rounded-full` + `text-xs`（签到里的 `min-h-8` 也改成 `h-8`，
  因为 `min-h` 会被内容高度覆盖，`h` 才是确定的）。
- **原图参考浮窗**：上传/重置/收起三个按钮 28px、文字 10px，和全局 32/11 差一档；
  改成 `h-8` + `text-[11px]`。浮窗表头本来就是 `sm:min-h-10`（40），
  4+32+4 正好填满，高度没有位移。
- **导航与工具条不再被压成竖排字**：1280 下「首页」是 `50×52`——两个字各占一行；
  工具条的「形状 / 视图 / 辅助 / 对称：无对称」同样折成两行。根因是这些按钮既没有
  `shrink-0` 也没有 `whitespace-nowrap`，横向不够时先被压窄、再折行。
  两处都补上 `shrink-0 whitespace-nowrap`，并把工具条文字标签的显示阈值从
  `min-[1180px]` / `min-[1100px]` 提到 `min-[1300px]`——带全标签整条需要 1278px，
  低于这个宽度就只留图标，宁可不显示也不要折行。
  搜索框同时让一档：`w-48 xl:w-56` → `w-40 xl:w-56 2xl:w-64`。

## 24.5 验证

桌面 1440×1024 全页按钮高度分布，改前 → 改后：

```
改前  26×2 | 28×6 | 30×2 | 32×38 | 40×7 | 44×1 | 112×1
改后  28×2 | 32×46 | 40×7 | 44×1 | 112×1
```

- 32 是唯一的主体高度（所有按钮/下拉/输入）；
- 40 是板型预设（两行，天生要高）；
- 28 只剩顶部黄色故障提示条里的「重试 / 关闭」——那是一条独立的通知条，故意紧凑；
- 44 是公告铃铛（只有图标，无底色，视觉上不显大）；112 是上传原图的大投放区。

移动端 390×844 复测：sheet 内所有控件 44，字号 14（搜索框 16 防 iOS 聚焦缩放），
外层 `p-3` 生效、面板 `padding: 0px`。

横向溢出复测（`scrollWidth / clientWidth`，全部相等即无溢出）：
1024 / 1180 / 1240 / 1280 / 1300 / 1440 六个宽度下，toolbar 与 header 均相等，`body.scrollWidth == innerWidth`。

## 24.6 防回归

`src/components/ui/panelScale.test.ts`（5 条）：

1. 桌面 `control / numberInput / headerBtn` 三种 token 解析出的高度必须**完全相同**（32）；
2. `control` 必须带 `h-` 且不得含 `h-auto`（就是那条把下拉压扁的写法）；
3. 移动端四种控件 token ≥ 40；
4. 每端字号 ≤ 4 档，且桌面不得出现 9px；
5. 桌面任何一档都不得大于移动端，`chip` 只能比 `control` 高 12px 以内。

`desktopIsolation.test.ts` 新增第 4 条：导航四个 tab 必须带 `shrink-0 + whitespace-nowrap`，
`Toolbar` 的 `buttonBase` 同样——折行是宽度的症状，不能用"挤一挤"解决。

`desktopIsolation.test.ts` 里原来"`lg:text-[..]` 出现 ≥20 次"的计数型断言删掉了
——它只能证明"有覆盖"，证明不了"覆盖得一致"，而且会把这种打架的写法当成正确。
换成：两个面板必须 `createPanelScale`，且不得出现 `sm:h-auto` / `sm:min-h-0` / `min-h-11`。

## 24.7 教训

- **"加个断点覆盖"是这轮所有错乱的共同来源。** 移动端要 44、桌面要 32，正确做法是
  按形态（variant）取一套值，而不是在同一串 class 里塞两组数字让 CSS 去猜。
- 计数型断言（"至少 20 处覆盖"）会奖励坏写法。要断言就断言**关系**（都等于 32、都不大于移动端）。
- 排查这类问题不要靠看图猜，直接把每个控件的 `height` / `fontSize` 打出来，
  排序一眼就能看出哪几个是离群值。

## 24.8 补记：主按钮被 flex 压成 16px

用户第二次指出「这个按钮还是有问题」。这次量的是**加载图片之后**的底部主按钮：

```
w=287  h=16  fs=12  mt=0
同一 flex 列里的兄弟：43, 17, 265, 107, 367, 158, 113, 16
```

16px 正好是 `w-4 h-4` 图标的高度，也就是**内容高度**——`h-9` 根本没有生效。

根因不是选择器，是 flex 收缩：侧栏是 `flex flex-col h-full overflow-y-auto`，
内容 1269px 塞进 863px，所有子元素默认 `flex-shrink: 1`，于是**整列一起被压短**。
上一轮把按钮从 `py-2.5`（内边距撑高、压不下去）改成固定 `h-9`（可压），
等于亲手把这个坑挖开——同样的「没有体积」，从下拉框转移到了主按钮。

修法：

1. 容器加 `[&>*]:shrink-0`，溢出交给 `overflow-y-auto` 滚动，不许压短任何一块；
2. 两个主按钮（工作坊入口、重新计算）显式 `shrink-0`，不依赖父级选择器；
3. 三个复选框顺带从原生 `accent-*` 换成 `peer + sr-only + span` 自绘：
   16px 方框、2px 描边（`*-400`）、选中实心（`*-600`）+ 白色对勾，
   `peer-focus-visible:ring-2` 保留键盘焦点。原生复选框在浅色卡片上只有一圈发丝线，
   和「下拉框没有体积」是同一类问题。

修后同一组数字：`h=36`，兄弟 `43, 36, 265, 107, 367, 158, 113, 36`。

契约补一条：`SettingsPanel` 的容器 class 必须包含 `[&>*]:shrink-0`。

> 教训：`flex-shrink` 是「看起来被切掉一半」的常见真凶。
> 一个 flex 列里的固定高度控件，只要父容器会溢出，就必须显式 `shrink-0`；
> 想用 `overflow-y-auto` 滚动，就得同时禁止子项收缩，否则滚动条永远不会出现，只会看到压扁的控件。

## 24.9 把「桌面不被移动端改动带崩」变成可执行的契约

### 先回答一个问题：到底隔离了没有

| 层 | 结论 | 依据 |
|---|---|---|
| 页面骨架 | **是** | `useIsDesktop()`（matchMedia ≥1024）配三元，同一时刻只挂载一个 |
| 顶部导航 | **是** | `Header` / `MobileHeaderNav` 两个组件 |
| 底部 Tab | **是** | 仅 `!isDesktop` 渲染 |
| 参数/统计面板 | **是** | 同一组件，`variant` 决定全部尺寸 |
| GridCanvas / HomeView / CommunityView | **否** | 一套 DOM，靠 `sm:` / `lg:` 变形 |

前两次事故全出在最后一行。所以这轮不加新架构，先给这一层装一个**会响的警报**。

### 测试怎么跑（`src/components/desktopLayout.browser.test.ts`）

不是数 class 名，是真开浏览器量 `getBoundingClientRect()`：

1. `createServer({ configFile: false, plugins: [react(), tailwindcss()], server: { port: 0 } })` 起一个随机端口；
2. Chrome `--headless=new --remote-debugging-port=0`，从 `<user-data-dir>/DevToolsActivePort` 读端口；
3. CDP `Emulation.setDeviceMetricsOverride` 设 1440×1024 / 390×844，`Network.setBlockedURLs` 掐掉 `/api/*`；
4. 用 canvas → `File` → `DataTransfer` 喂给隐藏的 file input，**把 hasImage 变成 true**
   （没有图时主按钮根本不渲染，正好绕过上一轮那个坑）；
5. 量两个面板里每个 `button/select/input` 的高度。

断言：

- 桌面：控件高度必须落在 `{16, 24, 32, 36, 40}`；
- 桌面：「重新计算拼豆图纸」必须正好 36（被 flex 压扁时等于 16）；
- 桌面：导航项、工具条按钮高度 ≤ 40（折成竖排时是 52）；
- 桌面/移动：`body.scrollWidth <= innerWidth`；
- 移动：参数面板里除复选框/滑块外，控件高度 ≥ 40，且面板 `padding === '0px'`（不双留白）。

### 变异验证：它真的会响

| 故意改坏 | 测试输出 |
|---|---|
| 删掉容器上的 `[&>*]:shrink-0` | `expected 16 to be 36` |
| 给两个 select 加回 `sm:h-auto sm:min-h-0` | `桌面端出现了不在 16/24/32/36/40 里的控件高度：[{…"MARD · 当前图",h:19},{…"不限制 (智能全配卡",h:19}]` |

两次都精确命中，且报错直接写出是哪个控件、多高。

### 顺带

`StatsPanel` 色卡行里的四颗图标按钮原来是 `p-1.5`（26px，不属于任何设计值），
统一成 `h-6 w-6`（桌面 24）/ `h-8 w-8`（移动 32）。

### 已知噪声

全量并发跑时，浏览器类用例会互相抢端口/进程（`Server.httpServer.listen` 失败），
一次跑出 3–5 个红。**成组重跑必绿**（10 文件 / 40 条）。判读顺序：
先看是不是 `listen` 失败，是就重跑那一组，不要当成回归。

## 24.10 风险防控：审计 + 已落地的四项

### 审计（都是可复现的证据，不是感觉）

| 风险 | 证据 | 状态 |
|---|---|---|
| 41 个文件改动未提交 | `git status --short` 41 项；`git log` 最后一条不在今天 | 待你决定 |
| 没有 CI | 仓库无 `.github/` | 待你决定 |
| 根级无错误边界 | `main.tsx` 直接渲染 `<App/>` | **已修** |
| 原 ErrorBoundary 抓不到渲染错误 | 只 `window.addEventListener('error')`，没有 `getDerivedStateFromError` | **已修** |
| 上传图片无体积/像素上限 | `handleImageUpload` 只判断能否读取；3D 流程才有 15MB 限制 | **已修** |
| 提示条在首页看不见 | `saveMessage` / `imageLoadMessage` 渲染在 studio 分支内部 | **已修** |
| `tsc` 非 strict，且**没装 @types/react** | tsconfig 无 `strict`；`node_modules/@types` 只有 node | 待你决定 |
| 主包 1.03MB（gzip 302KB） | `vite build` 的 chunk 警告 | 待你决定 |

> 其中「没装 @types/react」比 strict 更值得说：`.tsx` 里的 props 实际上**完全没被检查**，
> 组件接口写错只有跑起来才知道。这也解释了为什么这个项目对浏览器级测试依赖这么重。

### 已修 1：根级 ErrorBoundary

`main.tsx` 现在：

```tsx
<ErrorBoundary fallbackTitle="豆织星格加载遇到错误" reloadOnReset>
  <AuthProvider><LanguageProvider><App /></LanguageProvider></AuthProvider>
</ErrorBoundary>
```

放在 Provider 外面，连 Provider 初始化失败也能接住。

**现场验证**：临时在 `HomeView` 里 `throw new Error('boundary probe')`，1440 下截图——
页面显示「豆织星格加载遇到错误 + 具体报错 + 刷新页面」，不是白屏。验证完已还原（`grep -c "boundary probe"` = 0）。

### 已修 2：ErrorBoundary 换成真正的 class 边界

旧实现的两个问题：

1. React 的渲染错误走 `getDerivedStateFromError`，不会冒泡成普通 `window` 事件——
   所以它**从来没接住过任何渲染崩溃**，只在无关异步错误时报错；
2. 任意一个和它无关的报错都会把整个子树换成错误卡片。

现在 `getDerivedStateFromError` + `componentDidCatch`（堆栈进 console），
「重新载入此界面」只清 state；根级传 `reloadOnReset` 时改为 `location.reload()`。

> 坑：本项目没有 `@types/react`，`Component` 被解析成 `any`，继承不到 `props/setState` 的类型。
> 用 `declare props: Props` / `declare setState: ...` 显式声明，运行时仍由 React 赋值。
>
> 连带坑：`UserProfileModal.publish.test.ts` 手写了一个只含 hooks 的 react mock，
> class 组件在模块求值阶段就 `extends undefined`。已给该 mock 补一个最小 `Component`。

### 已修 3：上传门槛（`utils/uploadGuards.ts`）

| 门槛 | 值 | 为什么 |
|---|---|---|
| 单文件 | 30 MB | 手机原图 3–8MB，超过基本是 RAW |
| 解码像素 | 4000 万 | 8000×6000 = 4800 万，画到 canvas 再逐像素匹配会卡死移动端 |

体积在 `FileReader` **之前**判断；像素在 `img.onload` 里判断并 `finishImageRequest`。
纯函数 + 单测 5 条（含「宽高读不出来时放行，交给 onerror」）。
门槛值与文案都在一个文件里，改一处即可。

### 已修 4：提示条移出 studio 分支

`saveMessage` / `imageLoadMessage` 原来是 `{(currentTab === 'studio' || 'largeCanvas') && (...)}` 的子节点，
在首页上传一张超限图片时提示根本不会渲染。现在提到 tab 分支外面，任何页面都能看见。

### 一键验证

`package.json` 新增：

```bash
npm run test:serial   # vitest run --no-file-parallelism（绕开并发抢端口的噪声）
npm run verify        # tsc --noEmit && vite build && vitest run --no-file-parallelism
```

**当前基线**：非浏览器 **1445 passed / 1 skipped（117 文件）**；浏览器类成组 **10 文件 / 40 条**；
`vite build` 6.8s 通过（仅 chunk 体积警告）。

---

# 25. 三处空间压缩（第二十轮，2026-10-30）

用户给了三张截图：移动端用量页空白太多、PC 首页社区作品区卡片过大、PC 豆社页要省空间。

## 25.1 移动端用量页：统计卡从上下堆叠改成横排

原来每张卡是「标签一行 + 数值一行 + p-3」，实测约 76px；三张卡加起来 230px+。
改成横排（标签左、数值右）后约 44px，三张共省约 96px，整页内容（含空态）一屏放下。

> **第 21 轮又改了一次**：用户指出「前两张各占半行、需拼豆板独占一行」的排布浪费横向空间，要求三张占一行。
> 1/3 宽度里放不下横排（桌面 320 侧栏每格内容只剩 74px），所以三格改成 label 上、数值下的竖排 68px。
> 详见第 28 节。

## 25.2 PC 豆社卡片与页头（CommunityPostCard / CommunityView）

| 项 | 改前 | 改后 |
|---|---|---|
| 标题按钮 | `min-h-11`（44px，两行文字也要撑 44） | 移动保持 44，桌面自然高度（22px） |
| 查看图纸 | `min-h-11`（44） | 移动 44，桌面 36 |
| 点赞/收藏 | `min-h-11 min-w-11`（44） | 移动 44，桌面 36 |
| 卡片内边距 | p-4 / pt-4 / mt-3 | p-3 / pt-2 / mt-2 |
| 单卡高度（240 宽、带 1 个标签） | ~462px | ~415px |
| 页头 | 搜索框 mt-8、chip/排序 44、栅格 my-6 | mt-5、36px、my-4 |

原则不变：**移动端触控 44 硬线不动**，只把桌面降到 36/自然高度（`sm:min-h-9` / `sm:min-h-0`）。

## 25.3 PC 首页社区作品区（HomeView）

- 作品图 `aspect-square` → `aspect-4/3`（215 宽的卡省 54px）；
- 区块 p-5 → p-4、卡间 gap-4 → gap-3、外层 gap-6 → gap-4。

## 25.4 验证工具

本地没起后端、workers API 也没数据（用户确认属正常），所以截图工具
`.workbuddy/tools/cdp.mjs` 加了 `--mock-community`：CDP Fetch 拦截
`*community/posts*`，回 4 条示例作品（带 CORS 头，否则页面读不到 mock 响应）。
移动端用量页与桌面头部高度均已实测；社区卡片单卡 415px 为离线渲染实测。

---

# 26. 一个 Hook 位置错了，整页崩成错误卡片（2026-10-30）

## 26.1 现象

打开「颜色识别」后整页变成 `豆织星格加载遇到错误 / 页面暂时遇到问题，请点击下方按钮重试。`
——这是根级 `ErrorBoundary` 接住了崩溃（说明边界本身工作正常），但卡片里只有通用文案，
截图看不出任何线索。

## 26.2 真因

在校准面板里加了「按豆距自动估算格数」，顺手把处理函数写成了 `useCallback`：

```tsx
if (!isOpen) return null;          // 第 580 行：向导关闭时提前返回
...
const applyEstimatedPitch = useCallback(() => { ... }, [...]);   // 第 593 行
```

关闭时这条路径执行 41 个 Hook，打开时 42 个。React 抛
`Rendered more hooks than during the previous render`，整棵树被卸载，边界接管。

**Hook 只是个普通函数调用，tsc 完全查不出来**，而且只有"先关闭、再打开"这种交互后才爆，
所以本地看首屏是正常的。

## 26.3 修法

1. 那个函数不需要 memo（只是按钮的 onClick），改成普通函数，写在提前返回之后是安全的；
2. 新增静态契约 `ImportBlueprintWizard.hooks.test.ts`：按顶层声明做花括号配对，
   只在**组件函数体**内检查"提前 return 之后是否还有 Hook"。变异验证：插一行
   `const probeRef = useRef(0);` → 立刻报
   `{"component":"ImportBlueprintWizard","hook":"const probeRef = useRef(0);"}`；
3. 错误卡片加了一个「复制错误信息」按钮（只在点击时把 message + stack 写进剪贴板，
   **不在卡片里渲染原始报错**，守住"不泄露内部细节"的既有契约）——
   下次崩了直接把文本发过来，不用再靠一张只有通用文案的截图猜。

## 26.4 教训

- 组件里 `if (!x) return ...` 之后是禁区：Hook、`useMemo` 依赖、任何有状态的东西都不能写在那儿；
- 静态契约要**限定作用域**再断言，否则误报会淹没真问题（第一版 62 条误报）；
- 错误边界要能"把话带出来"，但方式可以是复制而不是展示。

---

# 27. 首页四个入口按钮重做色阶（第二十一轮，2026-10-31）

## 27.1 现象

用户截了 hero 区那排按钮：白实心、白 15% 玻璃、白 5% 幽灵、琥珀 15% 描边。
四个填充是四种语言，看不出谁是主操作；琥珀压在紫色上发土，像没调完的占位色。

## 27.2 诊断（三个独立问题，被同一张截图暴露）

1. **色相数量** = 4。白 / 白玻璃 / 白幽灵 / 琥珀。按钮组超过两档明度 + 一个色相，就会读成随机。
2. **桌面端那次「幽灵化」**：`sm:bg-transparent sm:border-transparent`，
   后两个按钮在桌面直接没有底和边，跟前面两颗不是一套控件，整排看起来是歪的。
3. **层级错位**：`照片一键转拼豆` 是产品核心卖点，视觉权重却跟 `探索社区作品` 一样弱。

## 27.3 改法（唯一一套，见第 4 节第 9 条）

| 层级 | 按钮 | 填充 | 描边 | 文字 |
|---|---|---|---|---|
| 1 主 | 进入画板创作 | `bg-white` | `border-transparent` | `purple-950`（900 字重） |
| 2 次主 | 照片一键转拼豆 | `white/24` + 顶边内高光 | `white/45` | `white` |
| 3 次级 ×2 | 探索社区作品 / 颜色识别 | `white/[0.06]` | `white/[0.16]` | `purple-100` |

- 暖色收敛成一处：只有转图按钮的闪电是琥珀（`fill-amber-300` + `drop-shadow` 微光）。
- 三档都补 `focus-visible:ring-2 ring-white ring-offset-2 ring-offset-purple-800`，
  深紫底上原来没有可见的键盘焦点环。
- 全部 `transition-all duration-200` + `active:scale-98`，hover 只提亮一档，不换色相。

## 27.4 顺带修的两处排版

| 问题 | 事实 | 修法 |
|---|---|---|
| 主按钮比兄弟矮 2px | 无边框 52px vs 有边框 54px | 主按钮加 `border border-transparent` |
| 1280 折成 3+1 | `lg` 起右栏示例图占位，左栏只剩 ~660px，四颗胶囊总宽 722px | `lg:grid-cols-2`（等宽 249px）→ `xl:flex` 单排；配 `xl:col-span-8 / 4` 把左栏拉到 757px |

断点验证（真 Chrome，量 `getBoundingClientRect`）：

| 视口 | 结果 |
|---|---|
| 1024 | 2×2 等宽，每格 249px，两行 top 差 64 |
| 1280 | 单排 174 / 190 / 158 / 126，全部 top 一致 |
| 1440 | 单排，同上 |

四颗按钮高度统一 54px、顶边对齐；`tsc` 通过，`HomeView.heroExamples` + `LandingView` 7 条、
`desktopLayout.browser` 7 条全绿。改动**只在 `HomeView.tsx`**，无新增测试契约（纯视觉，靠上面的实测数据兜底）。

## 27.5 备选方案（没采用，但可一键切回）

把两个次级按钮从「白 6% 雾」换成「深紫凹槽」`bg-purple-950/20 + border-white/18`，
体积感更实、白字对比更高，但底色贴近渐变背景，边界全靠描边。
当前选白雾是因为它在深浅两端都不会被误读成「禁用」。

---

# 28. 用量页三张 KPI 卡改成一行三格（第二十一轮，2026-10-31）

## 28.1 现象

用户截图：`总用豆数` 和 `颜色种类` 各占半行，`需拼豆板` 独占一整行。
三张卡信息量完全相同（都是「标签 + 一个数字」），却用了 1/2 + 1/1 两种宽度，
纵向吃掉 112px，第三张卡右边空着一大片。

## 28.2 为什么不是简单的 `grid-cols-3`

三格并排后每格只剩 1/3：手机 sheet 117px、桌面 320 侧栏 90px（减掉 `p-2` 只剩 74px 内容）。
原来的「标签左 + 数值右」横排在 74px 里放不下 `需拼豆板` + `6 板`，必然换行。

所以三格内部改成**竖排**：标签一行（`sz.micro`）、数值一行（`text-base` / `text-[15px]`），
**只有两格时**（`hasDetails === false`，只剩总豆数与颜色数）仍用横排——
两格各占一半时横排更省高度，硬套竖排会得到两张大空卡。

## 28.3 顺带统一的两处

- `需拼豆板` 的数值原来是 `text-indigo-700`，三卡并排后是全组唯一的异色；改成和兄弟一致的 `purple-900`，单位「板」降级成 `rowMeta` + `purple-500` 小字。
- 数字统一 `font-mono font-black`，三格基线对齐。

## 28.4 实测

| 端 | 单卡尺寸 | 标签行高 | 溢出 |
|---|---|---|---|
| 手机 390（sheet） | 117 × 68 | 16（单行） | 无 |
| 桌面 1440（320 侧栏） | 90 × 53 | 13（单行） | 无 |

KPI 条下沿到「制作进度」卡的间距 12px，与「制作进度」→「整合散豆」一致。
`tsc` 通过；`panelScale` / `desktopIsolation` / `CompletionSummary.visibility` 22 条全绿。
改动只在 `StatsPanel.tsx`，无新增契约。

---

# 29. 手机端豆社改三列缩略图（第二十一轮，2026-10-31）

## 29.1 现象

用户的两张截图：左边是手机上的豆社，一列大卡（封面 4:3 约 358×268）＋作者 / 标题 / 日期 / 标签 / 点赞收藏 / 查看图纸按钮，
单卡接近 600px 高，一屏只放得下一张；右边是他画的示意，三个黑框并排铺满宽度。

## 29.2 改法：一套 DOM，两副形态

没有拆成两个组件，靠断点切：

| 元素 | 手机（<640） | sm 起 |
|---|---|---|
| 栅格 | `grid-cols-3`，`gap-2.5` | `sm:grid-cols-2` → md 3 → lg 4 → xl 5，`sm:gap-4` |
| 封面 | `aspect-square` | `sm:aspect-4/3` |
| 卡片圆角 / 内边距 | `rounded-xl` / `p-2` | `sm:rounded-3xl` / `sm:p-4` |
| 作者行（头像+名字） | 隐藏 | `sm:flex` |
| 标题 | `text-xs` + `line-clamp-2` | `sm:text-base`、不截断 |
| 发布日期 | 隐藏 | `sm:block` |
| 标签 chip | 隐藏 | `sm:flex` |
| 点赞 / 收藏 / 查看图纸 | 隐藏 | `sm:block` |
| 手机专属 meta 行 | 作者名 + ♥ 数（只读） | 隐藏 |

单卡从 358×约 600 变成 113×183，一屏能看到 2 行共 6 张，滚一屏等于原来四屏。

保留 `object-contain`（不是 cover）：拼豆作品的边缘就是内容，缩略图裁掉一圈会让人误判构图。
代价是 4:3 作品在方形格子里上下各留一点浅紫底，成排看起来仍然整齐。

## 29.3 取舍：手机上不再直接点赞

三列每格 113px，放不下 44px 的点赞/收藏按钮，硬塞就是违反触控红线。
所以手机卡片只显示 **只读** 的 ♥ 数，点赞/收藏/查看图纸都进详情弹窗（点封面或标题）。
标题按钮取消 `min-h-11`（否则两行标题也被撑到 44px）；主要触控入口是 111×111 的封面按钮。

## 29.4 实测

| 端 | 栅格 | 单卡 | 封面 |
|---|---|---|---|
| 390 | 3 列 | 113 × 183 | 111 × 111 |
| 1440 | 5 列（262px 轨道） | 262 × 432 | 桌面形态完整：日期 / 查看图纸 / 作者都在 |

`tsc` 通过；`CommunityView.ui.test.ts` 8 条全绿（该用例断言的是组件树与筛选逻辑，不锁 class）。

**本地截图注意**：`--mock-community` 造的 post 只有 `assetId`，`communityApi` 会用 `publicAssetUrl(assetId)` 重写 `imageUrl`，
所以本地没有后端时封面是空的——这不是布局问题。验证时用 `--js` 把 `article img` 的 `src` 换成内联 SVG 占位即可。

---

# 30. 作品详情：删「框选区域副本」、去掉重复日期、获赞 / 收藏改可点（第二十一轮，2026-10-31）

## 30.1 三件事

1. 删掉详情弹窗底部的「框选区域副本」按钮（`setWorkspaceMode('crop')` 的入口），超限提示里的
   「编辑可框选区域副本，或升级会员」同步改成「超过这个尺寸需要升级会员后才能编辑」。`workspaceMode` 收窄为 `'practice' | null`。
2. 手机端「获赞 / 收藏」原来只是两个只读数字，现在整格就是按钮。
3. 同一张弹窗里日期出现了三次（封面左下角黑药丸 / 作者行「发布于 …」/ 互动条第一格「发布时间 …」），现在只留作者行那一处。

## 30.2 日期去重

「谁发布 + 什么时候发」本来就是一组信息，合并到作者行下面即可。
封面角标和互动条里的日期格都删掉——顺带让互动条从三格变两格，两个按钮各拿到半行宽，比原来挤在 1/3 里好点。

## 30.3 互动条长什么样

两格：`获赞` / `收藏`，`grid-cols-2 gap-2`，每格 `min-h-12`，整格可点。

| 状态 | 点赞 | 收藏 |
|---|---|---|
| 未激活 | `bg-purple-50` + `border-purple-200/80`，标签 `purple-600`，数字 `purple-900`，图标空心 `purple-500` | 同左 |
| 已激活 | `bg-rose-50` + `border-rose-200`，标签 `rose-600`，数字 `rose-700` | `bg-indigo-50` + `border-indigo-200`，标签 `indigo-600`，数字 `indigo-700` |
| 图标 | `fill-rose-600` 实心 + `scale-110` + 5px 同色 `drop-shadow` | `fill-indigo-600` 实心 + 同上 |
| 标签文案 | 获赞 → 已赞 | 收藏 → 已收藏 |

颜色沿用桌面卡片上的既有语义（点赞 rose / 收藏 indigo），不再引入第三套色。

**点亮动画**：`index.css` 里加了 `@keyframes reaction-pop`（0.8 → 1.28 → 1.1，0.34s ease-out），
只在 class 从未激活变已激活时播放一次，停在 1.1 倍实心态。整格另有 `active:scale-[0.97]` 作为按下反馈。

不做的事：未激活一律中性紫。两格如果常驻彩色，会跟下面「查看与实操」的紫色主按钮抢注意力。

## 30.4 弹窗结构：先分区，再往里放东西

```
┌──────────────────────────── 弹窗 ────────────────────────────┐
│                                            ×   ← 浮层，距边 12px    │
├────────────────────────┬───────────────────────────────────────┤
│  封面（1:1，contain）    │  作者 + 发布日期                        │
│                        │  标题 / 标签 / 说明 / 尺寸               │
│  ── 12px ──            │  获赞 / 收藏（两格按钮）                 │
│  编辑上限提示（仅桌面）   │  ── 手机：提示块放这里 ──                │
│                        │  查看与实操 / 载入完整图纸                │
└────────────────────────┴───────────────────────────────────────┘
```

- **关闭键**：`absolute top-3 right-3` 浮在弹窗右上角，**不占文档流**——中间试过用 `sticky` 顶栏放它，
  白吃 56px 高度，被否。40px 圆角方形、无描边、`bg-white/70 + backdrop-blur`：平时只有一枚浅色 X，
  hover 才浮出 `purple-100` 底、按下变 `purple-200` 并缩到 0.95；`after:-inset-1` 把热区撑到 48px。
  桌面上它落在右栏顶部，所以作者行加了 `pr-12` 让位。
- **左栏** = 封面 + （桌面）编辑上限提示。提示原来在右栏，结果左边图片下方空一大块、右边挤成一列。
- **右栏** = 三件事：这是谁的作品（作者 / 标题 / 说明 / 尺寸）、能不能互动（获赞 / 收藏）、怎么用（两个主按钮）。
- 提示块在左栏和右栏各渲染一次（`hidden sm:block` / `sm:hidden`）：手机留在按钮上方，桌面补左栏空白。
  `editLimitNotice` 是一个变量，两处引用同一个元素，隐藏的一端 `display:none` 不进无障碍树。

## 30.5 保留了什么

进入「查看与实操」后，右侧栏仍有「区域副本」标签页（`CommunityPatternWorkspace` 的 crop 模式）与配套框选工具。
本轮只删了详情弹窗里的入口。**要连功能一起去掉**，需要同时删：那个 tab、`community-workspace__selection-tools`、
crop 面板整段、以及 `cropCommunityPattern` 调用与相关 CSS —— 这是一次产品决策，动之前先确认。

## 30.6 验证

`tsc` 通过；`CommunityView.ui.test.ts` 8 条全绿（用例不锁日期文案与 class）。
本地没有后端，`reactToCommunityPost` 必然失败，所以「已赞」态是 dev 下注入 class 截的图；
真实点击走的是既有 `handleReaction` → `updatePattern`（第 197 行，同时刷新列表与弹窗）。
桌面端「提示块落在图片下方」这一态也是靠注入同结构 DOM 验证的（本地 `selectedProject` 为 null 时该块不渲染）。
