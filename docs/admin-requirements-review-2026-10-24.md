# 后台功能与中文优化交接（2026-10-24）

## 最终整合验收

- 后台不是所有用户可使用：匿名、游客、普通会员的敏感接口拒绝访问；可打开/admin校验页不等于取得管理权限。
- 个人中心和手机入口按服务端canAccessAdmin显示，纯角色授权管理员不再遗漏；会员权益与后台能力独立。Cookie/Header恢复一致，冲突、失效、撤销、跨账号拒绝，Bearer、来源和逐接口权限校验保留；独立复核通过。
- 中文交互复核发现的旧配置可写、重开确认绕过不确定写保护、日志兑换码越界误空三项已修复并独立复核。无关/失败GET不可解除写屏障，相关新成功读取后才能明确重试。
- 负责人最终实跑：前端类型检查、构建与108文件1248测试通过；后端类型检查与347测试通过。浏览器验证隔离模拟API，不等同生产用户写入验收。
- 本轮尚未提交部署；下文需求矩阵明确的后端业务闭环缺口仍保留，不声明全功能完善。

## 范围与验收口径

仅修改 `src/components/admin/**`、必要的后台测试及本文件；不改 App/Auth、后端、数据库、权限策略，不提交、不部署、不写 secret。每次源码阅读不超过两个文件。保留当前后台及现有密码重置流程，不恢复旧页面。

“已实现”指当前前端已有真实接口调用及操作流程，不代表本轮已在生产验证。接口路径均相对于 `/api/admin/`；本轮只做离线浏览器验证，不触达生产。

## 按实际模块建立的软件管理需求矩阵（改动前盘点）

| 管理域 | 实际已有能力 / 接口 | 缺口与验收边界 | 不可擅自新增的业务 |
| --- | --- | --- | --- |
| 用户 | `users` 查询分页、`users/detail`、账号限制、标签、内部备注、密码重置 | 列表不提供逐用户标签和最近活动；详情读取后才补充；保留 reset 安全流程 | 批量删除账号、推断活动时间、改变账号限制规则 |
| 核心图纸 | 仪表盘作品统计、用户详情图纸数量、社区图纸摘要查询 | **缺完整图纸运维详情/归属与完成权益联查、故障定位证据**；本轮不把社区摘要冒充原图纸数据管理 | 改图纸算法、直接修改旧图纸、补扣费/补权益、伪造预览 |
| 会员 | `update-user` 修改既有付费级别/到期值，提交前差异确认 | 角色权益与付费字段必须区分；未改变不提交；不是订单/营收系统 | 改会员价格、资格、续期算法或管理员角色权益 |
| 积分 | 前台 API 已有 `/api/credits/summary`、`quote`、`checkin`、`completion/quote`、`completion/complete`、`completion/legacy-import` | **后台当前没有积分余额/流水/图纸完成扣费联查模块，也没有已接入的管理员补偿/调账契约**；不能复用普通用户接口冒充跨用户管理 | 积分充值/调账/退款、修改签到奖励、单价、扣费及幂等规则 |
| 兑换码 | `codes`、`generate-codes`、`update-code`、`code-redemptions`；筛选、冻结批次、复制、发售标记、三天删除等待 | 复制不等于售出；网络异常写入结果不确定，禁止自动重试 | 新增收款/库存结算、缩短删除等待期、改变兑换规则 |
| 作品社区 | `community-content` 摘要、`reports`、`content-moderation` 独立审核记录 | **缺正文/图片完整证据接口；缺实际上下线闭环保证**；不能伪造预览/声称已下线 | 直接改旧作品/帖子/评论表、创设审核自动惩罚 |
| 色卡 | `color-cards`、`color-swatches` 元数据维护及删除确认、品牌排序约束、HEX/RGB | 不等于修改已生成图纸；保留现有校验及排序 | 修改转换算法、品牌优先级及旧表字段 |
| 资源 | `storage-assets` 索引 CRUD、所属用户/类型/状态筛选 | **没有实际文件上传/读取/删除能力**；仅资源索引，不冒充 R2 对象操作 | 添加实际对象删除、存储生命周期或公开访问策略 |
| 公告 | `announcements` 草稿/定时/受众/预览及独立发布撤回、删除复核 | 中文状态/受众；失败保留旧列表但明确标记；时间规则仍由服务端决定 | 新增推送渠道、改变定时/受众业务 |
| 配置 | `feature-flags`、`system-settings` JSON 校验及前后差异 | 当前各取最多 100 条，本地搜索不是全库；**完整分页检索未覆盖** | 创造没有实际消费者的新功能或权限 |
| 审计监控 | `logs` 分类/日期/操作者/分页、`dashboard` 指标/趋势/错误遥测 | 仅已采集样本；未知值显示 —，不是完整请求追踪、SLA 或营收 | 补造统计、扩大埋点采集或添加日志删除 |
| 角色权限 | `roles`、`permissions`、`roles/permissions`、`admin-user-roles`，授予/撤销/差异确认 | 目录不是当前操作者授权；每次以服务端校验为准；入口权限另审查代理负责 | 修改 RBAC、系统最低权限、App/Auth 入口或旧 role 字段 |

## 本轮方案

保持现有语义配色、44px 点击区、响应式侧栏与抽屉。布局不重建：

```text
分组导航 | 页头（模块名称 / 刷新 / 会话）
         | 筛选与状态 → 结果列表/卡片 → 分页
         | 编辑抽屉 → 冻结差异确认（默认聚焦取消）
```

优先中文状态/动作/受众、失败提示、旧结果标识、分页边界、重复提交防护、未保存输入保护与无障碍名称。沿用现有轻量动效及 reduced-motion，不引入图片/字体/CDN 或依赖。

## 验证与交接

### 本轮实际改动

- `adminPresentation.ts`：状态/审核动作/内容类型/受众、既有角色及权限名称的显示层中文映射；未知值明确标注，不改原值。必要的代码标识、UID、JSON、HEX/RGB、品牌保留。
- `AdminAnnouncementsConfig.tsx`：中文受众/配置标识、按钮选中状态；公告使用成功快照页码、失败保留旧列表并明确提示、禁用旧结果写操作/翻页；总数缩减时回到有效末页。
- `AdminContentResources.tsx`：中文状态/动作/选项；筛选控件无障碍名称和选中状态；校验列表结构，失败不冒充空数据，旧结果只读；请求过期失效、成功快照分页及越界收敛；保留资源 JSON null。
- `AdminContentFlow.tsx`：网络中断/超时写入结果不确定时阻止在该确认窗重复提交，保留输入、要求先刷新核对；成功后刷新异常提醒不再因关闭确认窗被隐藏。原 ref 写锁及冻结快照保留。
- `AdminUsers.tsx`：按返回页大小计算页数、越界收敛；查询加载时禁止重复提交；中文输入法组合输入时 Enter 不误触查询；保留密码重置入口和全部流程。
- `AdminRoles.tsx`、`AdminLogsCodes.tsx`：可见角色名、权限名、日志类别中文；保留原角色 code、权限标识及原值提交，未修改最低授权或权限逻辑。
- `AdminPrimitives.tsx`、`admin.css`：纯英文服务端错误以中文提示为主，原错误放“技术详情”；长错误换行、移动端详情单列/确认按钮布局。保留取消默认焦点、键盘焦点约束、请求中禁止关闭及低动态效果设置。
- **未修改** `AdminConsole.tsx`、`AdminPage.tsx`、`AdminPasswordReset*`、App/Auth/Profile/AuthContext、后端及其他代理文件。

### 真实 DOM 验证口径

新增 `AdminManagement.browser.fixture.tsx` + `.test.ts`：当前真实组件 + 本地模拟 API，esbuild 内存打包；真实 Tailwind 工具样式和后台 CSS；Chrome 无头浏览器分别以 1280/390px 内嵌视口执行。CSP 禁止连接、系统代理黑洞及 DNS 屏蔽、fetch 白名单，无生产访问。截图来自该离线场景，390px 采用固定宽 iframe，外层 Chrome 仍可能大于 390px。

覆盖未登录/普通账号无权状态、有效后台会话、移动菜单/Escape、重置入口保留、公告查询翻页/失败/越界/编辑保留/确认取消/重复点击、兑换码冻结批次生成/复制不发售/删除取消、色卡危险删除取消、资源中文可见性及 JSON null 原值、社区证据缺口提示/审核动作和举报状态原值、角色中文、配置非法 JSON/写入不确定拦截、旧结果只读和恢复、初始失败不伪造空态、各主要页面水平溢出及筛选可访问名称。

### 尚未满足及后续最小安全工作

1. 图纸/积分跨用户运维联查是核心实际缺口，需后端提供并确认**只读**契约及授权范围后再接 UI；不先造余额/流水、调账按钮。
2. 社区完整正文/图片证据与实际下线效果仍需独立接口闭环；当前只追加审核记录/处理举报。
3. 资源真实文件操作未实现，不添加上传/删除对象按钮；配置全量分页检索仍未覆盖（明确各取前 100 条）。
4. 入口权限及 cookie/header 恢复另代理负责。本轮只验证前端对模拟 401/403 的呈现，不声称验证后端拒绝策略；当前 `AdminConsole` 未接新 capability，待主代理通知后最小对接。
5. 未做生产写操作/部署；模拟浏览器验证不是生产 API 端到端验收，也不是所有业务模块完整验收。

### 检查命令与结果

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/components/admin --maxWorkers=2
git diff --check -- src/components/admin src/pages/AdminPage.tsx docs/admin-requirements-review-2026-10-24.md
```

- TypeScript 全项目检查通过（退出码 0）。
- 后台相关 8 个测试文件、108 个测试通过，包含原密码重置真实浏览器回归；未出现跳过的浏览器测试。
- 新增管理流程浏览器：桌面 91 / 手机 93 项 DOM 断言；每个场景 58 次本地模拟请求、6 次模拟写入，React/运行时错误均为 0。原密码重置回归同时保留并通过。
- 范围内 `git diff --check` 通过；Git 仅提示既有 Windows LF/CRLF 转换警告。
- 最初 `pnpm exec` 触发本机依赖检查，因 esbuild build-script 审批未通过而退出；改用已有安装的 Node 入口完成检查，没有批准构建脚本、添加依赖或修改包配置/锁文件。

复现带证据的离线场景：

```powershell
$env:ADMIN_MANAGEMENT_EVIDENCE_DIR='D:\Build_Apps\pindouwangge\src\components\admin\__evidence__'
node node_modules/vitest/vitest.mjs run src/components/admin/AdminManagement.browser.test.ts --maxWorkers=1
```

证据位于 `src/components/admin/__evidence__/`：

- `admin-management-1280.json` / `admin-management-390.json`：逐项断言、请求路径/方法、运行时错误、选中状态与计算背景色；不含真实数据或凭据。
- `admin-management-1280.png` / `admin-management-390.png`：当前社区举报模块的真实 DOM 截图。已人工打开核对桌面/手机中文、布局、按钮及分页；测试采用系统 reduced-motion 模式，使虚拟时间截图不会停在颜色过渡中间帧。

本轮交接结论：**现有功能内的中文与交互优化通过；上述能力缺口继续保留，不声称全后台业务完整。** 未提交、未部署、未生产写入；所有本轮写文件均在独占后台目录或指定交接文档内。

## Helmholtz 独立复核：3 个 P2 修复交接

此前 108 项通过没有覆盖以下三个反例；本节修正前述验收覆盖边界，不将旧结果作为这三个问题已修的依据。

### 精确修复范围

1. **配置成功写入后刷新 403，旧列表仍可写**：`AdminAnnouncementsConfig.tsx` 按功能开关/系统参数分别维护 `unread/loading/ready/stale`。旧快照可以查看，但 loading、未确认或失败作用域不能新建、打开编辑、复核或确认提交；只有该集合通过结构校验的当前成功读取恢复 ready。独立参数集合成功不解锁失败的开关集合。刷新中的已打开编辑器也只读；写入处理器和确认层均做门禁，不仅禁用按钮。
2. **uncertain 取消重开确认即可重复非幂等 POST**：新增 `adminWriteRecovery.ts`，内存恢复屏障按操作者 UID + API 集合隔离，供 `AdminContentFlow.tsx` 的原写锁外再做恢复门禁。取消、重开确认、模块重挂载不清锁。读取前领取带序号的票据；只在相关列表成功、结构有效且版本仍为当前结果时确认票据。不确定写之前已发出的 GET、失败 GET、过期 GET、社区摘要 GET 或其他集合 GET 都不解除相关锁。`AdminContentResources.tsx`、公告和配置读取流程接入票据，无新增网络接口或业务规则。审核锁只由 `content-moderation` 读取解除，资源锁只由 `storage-assets` 读取解除；与发布同集合的公告映射仅在显示层恢复屏障内归一。
3. **兑换码/日志页 2，总数 21→1 后停在空页并隐藏分页**：`AdminLogsCodes.tsx` 在当前有效读取返回后检查末页，越界时保留旧成功快照，更新已提交查询的页码并重新 GET 有效末页。兑换码、兑换记录、日志均覆盖；保留原查询筛选及技术值，不采用修改后的草稿筛选。已有 epoch 防过期响应与查询对象/页码条件更新共同防止旧响应重置新查询。

本次实际源码变更仅 `AdminAnnouncementsConfig.tsx`、`AdminContentFlow.tsx`、`AdminContentResources.tsx`、`AdminLogsCodes.tsx`、新增 `adminWriteRecovery.ts`。新增 `adminWriteRecovery.test.ts`、`AdminReviewRegression.browser.fixture.tsx`、`AdminReviewRegression.browser.test.ts` 和本节证据；未动入口代理 App/Auth/backend，也未覆盖并发代理对 `adminRequest*` 的修改。

### 红→绿真实证据

新增三类独立测试 × 两视口（1280、390）。**先新增测试、未修源码时执行，6/6 在预期 P2 断言处失败**。红测 JSON/PNG 已保留，不由最终绿测覆盖：

| 场景 | 修复前失败点（两视口一致） | 修复后两视口各自断言数 / 写请求数 |
| --- | --- | --- |
| config | 成功 PUT 后的 403 旧配置行仍可编辑 | 11 / 1（仅原成功 PUT） |
| uncertain | 无任何 GET，取消后重开复核使资源 POST 确认可用 | 17 / 4（资源和审核各 1 次原不确定写 + 1 次相关成功 GET 后明确重试；没有提前重复 POST） |
| pagination | 页 2 总数收缩，没有重新 GET 页 1 | 11 / 0 |

- 精确文件前缀：`src/components/admin/__evidence__/admin-review-{red|green}-{config|uncertain|pagination}-{1280|390}.{json|png}`。JSON 保留各次路径、方法、模拟请求体、通过断言、错误信息及真实视口；生产凭据/生产请求为零。红测包含预期断言失败，但浏览器/React 错误为零；绿测六份 `passed: true`、浏览器/React 错误也均为零。
- 额外覆盖：配置反复 403/读取中禁写/成功读取恢复；无 GET 重开确认、失败刷新、无关成功 GET、不确定状态跨组件实例保留、审核记录相关 GET 后明确重试；兑换记录分页收缩、日志原筛选保留、旧 page2 延迟响应不能覆盖新筛选。
- 恢复屏障单元测试额外验证：不确定前已在途 GET 不解锁、较新的不确定写不能被较早核对票据解锁、集合及操作者隔离、订阅清理。
- 桌面测试曾误点同名“社区内容”侧栏而非主区标签；已限定主内容区查找，并**增加选中标签断言**，未放松原失败断言。

### 最终命令及结果

```powershell
node node_modules/typescript/bin/tsc --noEmit
$env:ADMIN_MANAGEMENT_EVIDENCE_DIR='D:\Build_Apps\pindouwangge\src\components\admin\__evidence__'
$env:ADMIN_REVIEW_EVIDENCE_STAGE='green'
node node_modules/vitest/vitest.mjs run src/components/admin --maxWorkers=2
git diff --check -- src/components/admin docs/admin-requirements-review-2026-10-24.md
```

最终后台 **11 文件、124 测试全过**（包含入口代理最新 `adminRequest*` 测试、原 reset 和管理浏览器测试）；tsc 通过，diff-check 通过（仅 LF/CRLF 提示）。新增六项真实浏览器回归已独立通过一次，并在后台全套再次通过。父代理较早全项目结果是红测开发中快照，本交接不将它表述为最终全项目测试结果；全项目回归由父代理最终重跑。

恢复保护是前端当前运行期的操作防误触屏障，不是后端幂等机制；完整页面重载会重新读取 API，仍须运营人员核对实际结果后明确操作。不声称某个分页/筛选 GET 能在业务上自动证明原写入未生效。未新增接口、后端权限、退款/调账/文件删除业务；未提交或部署。
