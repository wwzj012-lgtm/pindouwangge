# 可达旧界面有界审计（2026-10-24）

## 收敛实施与最终本地验收

以下正文为修复前静态审计快照，历史行号和“尚未执行”表述不代表当前实现状态。

- 图库当前入口统一新版个人中心，发布直接打开轻量表单，不再挂载旧整页图库；重命名、同步重试、本机副本与云端删除保留。真实App在390/1280px分别127/110检查通过。
- 会员入口收敛为登录或兑换表单，兑换、退出、管理员入口保留；资料编辑保留头像/昵称，移除无效改密承诺。独立导出保留，无入口旧后台与失效分支不盲删。
- 账户复核发现的迟到兑换与401污染新会话、登出关闭、手机标签问题已修复并独立复核，覆盖真实Provider与真实API客户端，仅拦截fetch。
- 图库复核发现的cloud-only守卫、同步权益、私密缓存、最新工程锁、Quota失败恢复已修复；真实存储15/15、store10/10和原故障探针通过，跨账号隔离保留。
- 负责人最终实跑：tsc、Vite构建通过；103文件1203测试通过。保留既有大bundle警告。
- 未提交或部署；生产用户写入未验。隔离DOM测试不等同生产验收；后端运行时文件未改。

审计对象：`D:/Build_Apps/pindouwangge` 当前工作树；结论来自源码入口、事件回调、状态与渲染条件的静态追踪。未访问线上、未建立后台会话、未调用业务 API，**不代表已在浏览器或生产复现**。颜色仅作样式线索，不作为删页依据。

本轮唯一写入为本报告。未修改源码、业务规则、算法、D1 字段或后端 runtime；未提交、部署或写入 secret。已有 `HomeView.tsx` 未提交修复与 `.ai-memory/` 保留。后端工作树的 `package.json`、runtime 验证报告与 `scripts/` 改动均未触碰。

## 先交接的结论

- **新增高置信可达重叠**：已登录用户 → VIP 权益页 → 底部“了解 VIP / 商用会员” → `AuthModal` 已登录账户总览。该总览与新版个人中心部分重叠，但仍承载激活码兑换、退出登录、管理员跳转等能力，不能整体删除。已在审计过程中通过进度消息提前同步。当前会话未提供父代理通信工具，未声称已通过工具送达父代理。
- **可达旧图库旁路**：手机顶栏“更多 → 我的图纸”、画板工具箱“我的图纸”、`AuthModal` 的图纸记录按钮仍打开 `UserPatternsModal`。纳入 Kuhn 的 App / UserProfile / UserPatterns 统一线验收，不在本轮另做实现或深挖该模块。
- **旧管理后台不是可达重复**：`AdminPanelModal` 仅发现自身定义；当前 `/admin` 使用 `AdminPage → AdminConsole`。应标记为 dead code 候选，不能报作用户仍会跳入的旧后台。
- **账户管理与导出不能因旧样式删除**：前者仍是头像、昵称编辑与退出的实际界面；后者是工作台与社区共用的当前导出实现。

## 旧界面 → 当前入口 → 替代 → 保留能力 → 建议 / 验收

| 对象及分类 | 当前入口与可达条件 | 新版替代 | 独立能力是否保留 | 建议与验收 |
| --- | --- | --- | --- | --- |
| `AuthModal` 已登录账户总览；**可达、部分重复，高置信** | 桌面 / 手机 VIP 按钮 → VIP 弹窗底部 CTA → 打开 Auth；`currentUser && userProfile` 时显示账户总览。证据 E1。 | 新版 `UserProfileModal` 可承接身份、会员信息和图库入口；当前没有等价兑换界面。 | **保留**注册 / 登录、兑换码、退出、管理员后台入口；总览重复信息可后续收敛。 | 先迁移兑换及角色入口，再调整 VIP CTA。普通已登录用户从会员页进入明确的权益 / 兑换界面；管理员仍可到新版 `/admin`；未登录者仍可登录 / 注册。不能直接把所有 Auth 调用改成个人中心。 |
| `UserPatternsModal` 旧整页图库；**已知可达重复，Kuhn 所有** | 除用户已报告的个人中心发布跳转外，手机顶栏菜单、画板工具箱及 Auth 图纸记录按钮可到同一旧 modal。正式登录门槛与挂载条件见 E2。 | 新版个人中心 `library` / `works`；发布编辑交互由 Kuhn 统一。 | 保存记录、继续编辑、发布等应由 Kuhn 保留；本轮不判断旧模块整体是否可删。 | 把三个旁路列入 Kuhn 验收。所有图库入口及发布操作留在统一体验，正式登录约束、记录状态与取消返回正确。**不分叉实现该线。** |
| `AccountManagementModal`；**可达旧外观，功能独立** | 桌面 / 手机头像进入新版个人中心，再点击头像或昵称 → 账户管理状态置真并挂载。证据 E3。 | 个人中心目前只调用账户管理；尚无独立新版资料编辑替代。 | **保留**头像预设 / 上传、昵称提交、退出登录。密码输入当前没有真正修改密码的路径。 | 保留组件能力；如另开统一样式任务，可内嵌账户设置。验收头像 / 昵称成功及失败反馈、退出和取消；密码输入不得误称已完成改密。不能只删除深色弹窗或清空两个入口。 |
| `ExportModal`；**可达、共用当前实现，并非双套旧页** | 桌面工具栏与手机画板导出 → `openExportModal`；完成解锁、正式登录后打开。社区只读工作台也实例化同一个组件。证据 E4。 | 当前 `ExportModal` 自身即共用实现，没有发现另一个新版导出组件。 | **保留**整图 / 分板、批量输出、预览、水印 / 会员约束、归档及微信下载处理。社区 `archiveOnExport=false` 有明确差异。 | 不删、不把 JSON 工程保存等同 PNG 输出。验收桌面 / 手机 / 社区导出都进入同一实现；工作台保持完成与登录门槛，社区不误归档别人的工程；普通 / VIP 约束保留。 |
| `AdminPanelModal`；**当前入口图 dead code 候选** | 查到自身导出，未查到消费者；Auth 的管理员按钮实际导航 `/admin`。证据 E5。 | `/admin` → `AdminPage` → `AdminConsole`，已有用户 / 角色、日志 / 卡密、公告 / 配置、内容 / 资源模块分发。 | 管理能力应保留在新后台；未做旧后台所有操作与新版的逐项等价审计。 | 可另列小型清理任务；先确认旧模块是否有遗漏能力及打包引用，再删文件。验收 `/admin` 和子路径仍进新版、无旧组件导入、拒绝访问与会话错误仍正确处理。**本轮不删除。** |
| `Header` 内旧手机抽屉；**断点条件不可达残留** | `Header` 仅在 `isDesktop=true` 挂载（默认 ≥1024）；抽屉触发器为 `md:hidden`，抽屉为 `lg:hidden`。正常默认断点不存在用户可点开的宽度交集。证据 E6。 | `<1024` 使用 `MobileHeaderNav`；画板更多工具使用 `MobileFeatureSheet`。 | 实际工具能力需保留在对应新入口；不能把抽屉 JSX 存在当成用户可达。 | 可在独立清理任务移除失效分支 / 冗余 props。验收 375 / 768 / 1023 / 1024 / 1440px 导航、上传、JSON、图库、会员与指南入口；断点结论仍需浏览器确认。 |
| `Header.onOpenExportModal`、`Header.onImportPattern`、`DesktopWorkspace.onOpenPatternsModal`；**只传参 / 解构，不能作为可达证据** | 对所列文件检索仅见 props 声明与解构，无实际调用；App 传入回调不等于按钮存在。证据 E6。 | 实际导出入口为工具栏；实际个人中心为头像；手机图库有明确菜单按钮。 | 不据此删除回调最终承载的能力。 | 清理时区分无效参数与有效入口；不能把 `handleImportPattern` 内能打开图库推断成桌面 UI 可达。 |
| `LandingView` 与工作区 `HomeView`；**不同路由职责，未判重复** | `/` 等非工作区路径返回 Landing；`/workspace`、`/app`、`/assembly`、`/large-canvas` 进入工作区；工作区 `home` 挂载 Home。证据 E7。 | 无需互相替代；公共入口与工作区首页职责不同。 | 保留公共入口和工作区快捷入口。 | 不涉及 `HomeView` 源码或现有修复。验收公共页进入工作区、社区入口、浏览器前进 / 后退；不能以“两个首页”直接删除其中之一。 |

## 可复核证据（审计时行号）

下列路径均基于当前工作树；若 Kuhn 并发修改入口文件，复核时以符号名重新定位。范围只表示相邻证据区段，不表示逐行完整阅读。

### E1：VIP CTA 仍打开旧账户总览

- 桌面入口：[Header.tsx:353](D:/Build_Apps/pindouwangge/src/components/Header.tsx:353) 使用 `onOpenVipModal`；手机入口：[MobileHeaderNav.tsx:164](D:/Build_Apps/pindouwangge/src/components/mobile/MobileHeaderNav.tsx:164)。App 对两者分别在 2076、2097 行接到 `setIsVipModalOpen(true)`。
- VIP 顶部 CTA 在非 VIP / Pro 时可见：[VipPrivilegesModal.tsx:236](D:/Build_Apps/pindouwangge/src/components/VipPrivilegesModal.tsx:236)；底部 CTA 无此会员条件，467–469 行关闭 VIP 后调用 `onOpenAuthModal`。
- [App.tsx:2545](D:/Build_Apps/pindouwangge/src/App.tsx:2545) 将 VIP 的 Auth 回调接到 `setIsAuthModalOpen(true)`；[AuthModal.tsx:234](D:/Build_Apps/pindouwangge/src/components/AuthModal.tsx:234) 为打开门槛，266 行根据 `currentUser && userProfile` 切换到已登录总览。
- Auth 独立能力：215–226 行 `redeemVipCode`，230–231 行退出，370–408 行兑换表单，411–422 行旧图库按钮，428–438 行管理员按钮。`rg -l 'redeemVipCode|兑换 VIP 激活码|handleRedeem' src -g '!*.test.*'` 仅返回 AuthModal 与 AuthContext；当前检索未发现新版个人中心兑换 UI。
- 新个人中心身份 / 会员显示及入口在 [UserProfileModal.tsx:394](D:/Build_Apps/pindouwangge/src/components/UserProfileModal.tsx:394)，图库导航在 459 行。因此结论为**部分重复、关键能力尚未替代**；也说明仅按深色搜索会漏掉这类功能重复。

### E2：交给 Kuhn 的旧图库旁路

- 手机顶栏：[MobileHeaderNav.tsx:183](D:/Build_Apps/pindouwangge/src/components/mobile/MobileHeaderNav.tsx:183) 打开更多菜单，204 行调用 `onOpenPatternsModal`；[App.tsx:2093](D:/Build_Apps/pindouwangge/src/App.tsx:2093) 接到 `openUserPatternsModal`。
- 手机画板：[MobileWorkspace.tsx:573](D:/Build_Apps/pindouwangge/src/components/mobile/MobileWorkspace.tsx:573) 打开工具箱，649–655 行挂载并传图库回调；[MobileFeatureSheet.tsx:492](D:/Build_Apps/pindouwangge/src/components/mobile/MobileFeatureSheet.tsx:492) 点击后调用；App 2345 行传入同一旧图库打开函数。
- Auth 图纸记录：[AuthModal.tsx:415](D:/Build_Apps/pindouwangge/src/components/AuthModal.tsx:415) 关闭 Auth 后调用图库回调；App 2503 行接到同一函数。
- 汇合点：[App.tsx:753](D:/Build_Apps/pindouwangge/src/App.tsx:753) 要求正式登录后打开旧图库，2523–2539 行在打开且正式登录时挂载 `UserPatternsModal`。用户已指出的 profile 发布跳转在 App 758–762 行；这里只定位，不深入旧图库实现或改动 Kuhn 文件。
- 对照当前个人中心入口：App 2075、2096 行的头像回调设 `profileInitialTab='library'` 后打开 profile；[MobileBottomNav.tsx:93](D:/Build_Apps/pindouwangge/src/components/mobile/MobileBottomNav.tsx:93) 触发“我的”，App 2370–2375 行按登录状态打开 profile / Auth。不能将这些正常新版入口与“我的图纸”旁路混淆。

### E3：账户管理有真实消费者与独立保存路径

- [UserProfileModal.tsx:368](D:/Build_Apps/pindouwangge/src/components/UserProfileModal.tsx:368) 的头像、394 行的昵称都调用 `onOpenAccountManagement`。
- [App.tsx:2510](D:/Build_Apps/pindouwangge/src/App.tsx:2510) 置账户管理打开状态；2517–2520 行挂载 `AccountManagementModal`；[AccountManagementModal.tsx:190](D:/Build_Apps/pindouwangge/src/components/AccountManagementModal.tsx:190) 仅在关闭时返回空。
- AccountManagement 192 行起处理头像，262–267 行只生成 `displayName` / `photoURL` 变更，281 行调用 `updateUserProfile`；292–295 行可退出。不能用个人中心已有头像展示证明“头像编辑已被替代”。
- 300–316 行为深色账户管理及“修改安全登录密码”的文案，但 249–259 行在任意密码输入后返回错误，没有提交改密请求。这是**可达旧承诺 / 未完成能力**，不是应保留一个已经可用改密功能的证据；若后续整改应另定需求，不在此次审计中接入新接口。

### E4：导出是同组件多入口

- 桌面：[Toolbar.tsx:339](D:/Build_Apps/pindouwangge/src/components/Toolbar.tsx:339) 导出按钮调用 `onOpenExport`；[DesktopWorkspace.tsx:191](D:/Build_Apps/pindouwangge/src/components/desktop/DesktopWorkspace.tsx:191) 接到 `openExportModal`，App 2273 行向下传入。
- 手机：[MobileWorkspace.tsx:639](D:/Build_Apps/pindouwangge/src/components/mobile/MobileWorkspace.tsx:639) 导出按钮调用 `openExportModal`，App 2339 行向下传入。
- 工作区门槛：[App.tsx:1939](D:/Build_Apps/pindouwangge/src/App.tsx:1939) 检查完成解锁和正式登录；2391–2408 行挂载同一个 `ExportModal`。
- 社区：[CommunityPatternWorkspace.tsx:102](D:/Build_Apps/pindouwangge/src/components/CommunityPatternWorkspace.tsx:102) 打开导出，153–157 行使用相同组件，明确 `unlocked=true`、`archiveOnExport=false`。此处配置是已有独立使用场景，不因与工作台门槛不同而擅改规则。
- [ExportModal.tsx:372](D:/Build_Apps/pindouwangge/src/components/ExportModal.tsx:372) 检查打开 / 解锁；398–424 行处理可编辑工程归档；429 行起单张下载、后续批量及微信分支；545 行起为 `export-modal-*` 界面，609 行起会员画质 / 水印权益，644 行起整图 / 分板选择。没有另一个导出页被 App 或社区引用的证据。
- JSON 工程导出另由工具箱 [MobileFeatureSheet.tsx:538](D:/Build_Apps/pindouwangge/src/components/mobile/MobileFeatureSheet.tsx:538) 调用 `onExportJson`；属于可编辑工程文件保存，不能替代图纸图片导出。

### E5：旧后台定义存在，运行入口已换新版

- `rg -l 'AdminPanelModal' src scripts index.html public recovery -g '!*.map' -g '!*.lock' -g '!*.log'` 只返回 `src/components/AdminPanelModal.tsx`；该文件 78 行导出组件、824 行关闭门槛，未发现消费者。未读取 dist 来推断线上部署状态。
- [App.tsx:276](D:/Build_Apps/pindouwangge/src/App.tsx:276) 懒加载 `pages/AdminPage`；2630–2631 行将 `/admin` 及子路径送到该页。Auth 管理员入口经 App 2502 行 `window.location.assign('/admin')`，没有打开旧 modal 的状态链。
- [AdminPage.tsx:3](D:/Build_Apps/pindouwangge/src/pages/AdminPage.tsx:3) 导入 `AdminConsole`，13 行返回新控制台。
- [AdminConsole.tsx:168](D:/Build_Apps/pindouwangge/src/components/admin/AdminConsole.tsx:168) 查询后台会话，223 行起处理未就绪 / 禁止访问；234–237 行向新版模块分发。仅证明新入口与模块挂载，不声称已核实所有管理操作等价。

### E6：Header 抽屉与“只传了 prop”的假阳性

- [useIsDesktop.ts:7](D:/Build_Apps/pindouwangge/src/hooks/useIsDesktop.ts:7) 默认断点 1024；App 444 行调用默认参数，2059 行 `isDesktop ? Header : MobileHeaderNav`。
- [Header.tsx:438](D:/Build_Apps/pindouwangge/src/components/Header.tsx:438) 抽屉触发器 `md:hidden`，448 行抽屉 `lg:hidden`；默认 Tailwind 断点下，Header 挂载时触发器已隐藏，手机宽度则不挂载 Header。492 行虽有旧图库回调，也不是当前手机入口的可达证据。窗口切换会更换组件，不应凭抽屉 JSX 误报。
- Header `onOpenExportModal` 只在 39 / 114 行声明和解构；`onImportPattern` 只在 52 / 127 行声明和解构。DesktopWorkspace `onOpenPatternsModal` 只在 83 / 149 行声明和解构；没有按钮调用。
- App 1982–1988 行 `handleImportPattern` 确能切到 studio 后打开旧图库，但作为 Header 参数在 2080 行传入后未被使用，因此不能单独报成桌面可达入口。

### E7：公共页、工作区与路由配置

- [App.tsx:2597](D:/Build_Apps/pindouwangge/src/App.tsx:2597) 解析 `tab`、assembly / large-canvas 路径，未指定时返回 home；2623–2626 行区分工作区与 Landing。
- App 2113–2118 行在 `currentTab='home'` 时挂载 `HomeView`，并连接照片转图、示例图及识图导入入口；未读取或改动 `HomeView.tsx` 本体。
- `public/_redirects:1` 为 `/* /index.html 200`；`public/_routes.json:3–4` 只将 `/api`、`/api/*` 送入 Functions。与上述前端分流一致，没有配置一个旧 AdminPanelModal / 导出 / 账户页直达路由的证据；不推断当前线上配置。

## 后续范围与验收边界

建议顺序：Kuhn 完成统一图库并覆盖 E2 的旁路；另立有界任务迁移 Auth 总览里的兑换及管理员入口；账户管理按独立资料编辑保留；最后单独清理旧后台和 Header 失效分支。不得把这些建议扩成全站重构，也不得在未经能力核对时删掉深色独立工具。

本报告的验收为静态证据与分类完成，表内 UI 路径是后续实现的验收清单，**尚未执行**。本轮未跑 build / lint / tests，避免产生构建或缓存文件；没有浏览器行为、部署版本、服务端权限和数据写入的验证结论。未扩展到各类配色 / 省豆 / 图像处理工具内部、后端 runtime 或全站样式清理。

执行偏差记录：一次检索批次误合并了 `UserProfileModal.tsx`、`AccountManagementModal.tsx` 与 App 尾部路由，共 3 个源码文件，超过“每次最多 2 文件”；后续批次已收窄到不超过 2 个。不以此报告声称全过程满足该读取上限。未发生越权写源码。
