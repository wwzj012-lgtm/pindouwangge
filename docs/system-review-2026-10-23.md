# 前后端系统审查 — 2026-10-23

## 结论与范围

**审查已收敛：R1/R2 隐私 P1 已修复并经独立复核关闭，签到/收藏最终独立复核亦已通过。** R3/R4/R7/R8 及 R9 的网关测试收集问题已修复并独立验证。父代理最终实际重跑：后端 typecheck + 338/338 测试通过；前端 typecheck/build + 97 文件 / 1169 测试通过。线上 D1、Cloudflare 配置生效状态和线上压测仍未验证；R5 分页、R6 存储预算及外部告警保留为待办，不宣称全系统安全或已完成生产验收。仅新增并更新本报告，未修改源码、业务规则、算法或 D1 字段，未执行 Git 提交、部署或生产数据库写入。未读取本地凭证文件，未向真实业务接口发送请求。原高严重发现已在审查过程中先行上报。

## 修复状态 / 剩余风险

以下修复与新增验证数字来自父代理最终交接，**本报告更新者未重新读取源码或重跑这些专项**。保留后文原始审查证据、行号和复现，供追溯修前状态；不能据此断言缺陷仍存在于当前代码。专项和全量数字对应不同验证集合，不累加为唯一测试数。报告以本次交接结果结束，不再扩大实现或扫描范围。

| 项目 | 最新修复状态及验证快照（父代理提供） | 剩余风险 / 验收待办 |
| --- | --- | --- |
| R1/R2 私密、撤回及并发关联 | Planck 原修复 35 专项；复核发现 detach work→null 后旧 A 被误判为 legacy 的新 P1，补修持久历史判定：无 post 且无 work_assets 才允许按 legacy 处理，新增 8 例红→绿。**Plato 最终独立复核 43/43 通过，原 P1 关闭。** | 顺序/排队 detach、A→B 的所有读入口均拒绝，true legacy 兼容。此为本地复核结论；线上 D1 与已部署版本未验。 |
| R3 实际字节限额 | Huygens 已改为实际字节流限额，且 IP 限流在读取正文前执行。 | Ptolemy 独立复核覆盖该组修复：32 后端 + 22 网关 + 12 额外探针通过。线上并发内存/压测仍未验证。 |
| R4 网关上传契约 | Huygens 已为专属资源上传路径设置 15 MiB 限额并重建 Content-Length。 | 已纳入上述 Ptolemy 独立复核；实际 Cloudflare 环境、存储预算及生产流量行为不由本地通过结果证明。 |
| R7 限流/quickLogin | Huygens 已做 IP 先限、quickLogin 写前 JWT 配置校验。 | 已纳入上述独立复核；存储滥用总预算见 R6，线上告警另待配置核实。 |
| R8 CORS PUT | Huygens 已补齐 PUT。 | 已纳入上述独立复核；生产 origin/路由实际部署状态仍未验证。 |
| R9 网关测试收集 | Huygens 已将网关测试纳入默认 include。 | 测试收集缺陷已修并独立验证；原 R9 另记的开发默认连接真实后端风险未收到关闭证据，继续要求显式本地环境隔离。 |
| 签到/收藏专项 | 跨用户 grant key、JSON/query 兼容，以及 Newton 后续指出的跨零点 cap 和 react 公开检查写入 TOCTOU 均已修。Dalton 原 118 专项通过；**Newton 最终独立复核完成，121 后端 + 31 前端测试通过。** | cap 原 4900 跨零点奖励 100+0=5000，过期快照零写；连续天数/周期/断签/now±1ms 到期/30 天/零奖励正确。注入 4 种 SQLite 失败，五表无部分写；8 个 TOCTOU 场景 404 且无变化，恢复公开冲突 409 可重试。线上 D1 未验证。 |
| 后台密码 reset / cache 脱离 DOM P2 | 已修；独立 79 测试 + 每尺寸 230 验证通过。 | 依据父代理交接记录，不扩大解释为所有后台功能已完整审计。 |
| 库存品牌 0 / 隔离 / practice 冲突 | 已修；独立 74 测试通过。 | 依据父代理交接记录，不重复实现或专项审查。 |
| R5 公共网格分页/资源加载 | **待处理**；未收到分页与列投影修复验收。 | 保留分页、响应字节上限、多用户规模及查询计划检查。 |
| R6 上传存储预算/孤儿清理 | **待处理**；上传传输限额修复不能替代账户/全局存储预算。 | 配额、待发布 TTL、孤儿对账、备份与恢复能力仍待设计/验收。 |
| 外部监控与线上压测 | **待处理 / 未验证**；现有仓库监控证据见后文。 | 外部告警接收人/阈值、线上生效状态、D1/KV/内存/并发压测及回滚演练未获新增证据。 |
| 统一验证 | **父代理最终实际重跑：后端 typecheck + 338/338 全通过；前端 typecheck/build + 97 文件 / 1169 测试通过。** 先前后端 330 为历史快照。 | 与专项数字不相加；通过本地门禁不等于已部署或生产 D1 验收。 |

当前明确保留项：R5 分页、R6 存储预算、外部告警、线上 D1/配置生效验证及线上压测；R10 文档矛盾、开发默认后端隔离及未决权限语义也未收到关闭证据。隐私补修和签到/收藏独立复核均已完成，不再列为待定。本次为核心路径复核加有界系统抽查，报告结束；不能宣称全系统安全。

## 原始审查范围与历史基线

- 前端：`D:/Build_Apps/pindouwangge`，基线 HEAD `ec2f88b`，Cloudflare Pages 项目 `stellabean`。
- 后端：`D:/Build_Apps/stellabean-worker`，基线 HEAD `c71a245`，Worker `stellabean-api`。
- 以共享工作区未提交代码为审查对象；期间其他代理持续修改签到、社区、admin UI、库存等文件，测试数字是运行时快照，不代表后续最终整合版本。本报告不复做这些模块实现。
- 每次按不超过两个源码文件渐进检查：Pages 网关 → Worker 路由 → 鉴权/校验 → 社区发布/可见性/撤回 → 网格/资源读取 → 定时清理 → 浏览器请求/渲染；admin 仅检查服务端权限、SQL 白名单和监控接口，未改 admin UI。
- **已确认**：静态代码明确，或本地真实函数/SQLite 验证成立；**推断**：影响依赖流量、业务语义或线上暴露条件；**未验证**：Cloudflare 控制台状态、线上路由/WAF/Access、实际绑定资源、生产数据规模、压力测试、真实浏览器平台行为。
- 这是入口驱动的抽样审查，不是全源码审计或渗透测试，不能推导“全系统绝对安全”。

## 架构与配置证据

```text
浏览器 → stellabean.pages.dev /api/* → Pages Function → BACKEND_API → stellabean-api
浏览器 → api.ts 配置/默认 Workers URL → stellabean-api（另一入口，线上可达性未验证）
stellabean-api → D1: DB；KV: COMMUNITY_ASSETS；AUTH/ASSEMBLY_AI_RATE_LIMITER
Cron 03:17 UTC（北京时间 11:17）→ 软删除作品清理
```

前端 `wrangler.jsonc:3`、`:5`、`:9`：Pages 输出目录 `dist`，service binding 指向 `stellabean-api`；兼容日期 `2026-08-11`。后端 `wrangler.jsonc:3`、`:6`、`:8`、`:13`、`:31`、`:39`、`:45`：启用 `nodejs_compat`、每日 Cron、两个限流绑定、D1、KV、`observability.enabled=true/head_sampling_rate=1`；兼容日期 `2026-08-08`。未发现配置中的 R2、Queue、Tail Worker/Logpush、显式告警、独立 staging 环境或链路追踪导出配置。

本地 Wrangler 实装版本为 `4.120.0`；脚本检查本地 `config-schema.json` 确认上述五类配置键存在，**不是完整 JSON Schema 校验，也不是远程部署验证**。线上是否部署该配置、Dashboard 是否另设告警/保护，均未验证。现有兼容日期本身不构成漏洞，不建议审查时顺便升级。

## 原始发现与历史证据（修前快照）

本节保留最初确认的根因、修前行号与验证输出；它们不是当前未修复清单。当前状态以顶部表为准，修复后源码行号可能变化。

### R1 — 高 / P1：旧状态接口绕过私密和撤回状态【已确认】

- 位置：后端 `src/routes/works.ts:97`、`:104`、`:215`；`src/index.ts:235`；`src/routes/gridPatterns.ts:484`、`:721`、`:740`、`:756`、`:804`。
- 根因：`POST /api/user-patterns/status` 允许拥有者独立把 `works.status=0` 改为 `1`，没有检查关联帖子是否私密/已撤回。匿名网格列表、open、chunk、preview 的公开判定依赖 `works.status=1`，没有以帖子可见性/撤回状态作第二道约束。
- 触发：作者设帖子私密或撤回 → 旧页面/旧客户端/延迟到达的拥有者请求提交 `{id, status:1}` → 作品重新成为匿名可读。这里不要求其他用户伪造作者身份；风险是作者此前的隐私设置被另一合法入口撤销。
- 验证：本地真实 `setCommunityPostVisibility`/`withdrawCommunityPost`/`changeWorkStatus` 加 SQLite，匿名 `listGridPatterns` 在私密后为 0 条、旧状态调用后为 1 条；撤回后同样复现。open/chunk/preview 的同源判定通过静态调用链确认，未声称线上下载已执行。
- 建议：统一服务端公开判定及状态迁移；在旧接口事务内拒绝与当前帖子私密/撤回冲突的公开请求，所有非拥有者读取入口采用一致约束。独立作品发布是否仍允许由产品确认，不应仅删除前端按钮。回归必须覆盖旧客户端、匿名及其他已登录用户。

### R2 — 高 / P1：事务前读取旧关联，撤回重发导致私密/撤回只修改旧作品【已确认】

- 位置：后端 `src/routes/communityPosts.ts:350`、`:538`、`:544`、`:552`、`:557`、`:573`、`:576`、`:582`、`:586`。
- 根因：可见性/撤回先读取 `post.work_id`，随后 batch 中更新帖子时仅核对 id/author/未撤回，没有核对预读的关联或版本。之后更新作品却使用旧 `work_id`。重发会复用帖子 id 并允许重新关联作品。batch 保证提交原子性，不能保证事务前的读取仍然新鲜；提交后检查 `meta.changes` 也不是回滚机制。
- 可执行交错：私密请求预读 P→A 后暂停 → 另一请求撤回 P → 用新图片在 A 发布 Q，释放旧图片关联 → 使用旧图片在 B 重发并复用 P → 原私密请求继续提交。
- 验证：真实发布/撤回/私密路由 + SQLite 事务、asset/work 关联唯一约束，原私密请求返回 **200**，P 的 `visibility=0`、`work_id=B`，而 B 的 `status=1`。不是直接构造一个不可能通过关联唯一约束的状态。附录提供复现。
- 撤回函数同样使用事务前旧关联，缺少 CAS；具体撤回交错未单独执行，归为**同根因推断**。普通删除先赢且帖子已撤回的交错，本地验证返回 404，未观察到复活。
- 建议：第一条 mutation 对观测到的 `work_id` 和 mutation/version 作 compare-and-set；作品更新从已成功 mutation 的当前帖子关联派生。失配应在任何修改前失败或由事务内约束使整批回滚，不能把提交后抛 409 当作原子拒绝。新增真实 SQLite 的私密/撤回与重发、删除、旧状态调用交错测试。

### R3 — 高 / P1（可用性影响取决于入口暴露）：JSON 上限只信 Content-Length【已确认缺陷，资源耗尽为推断】

- 位置：后端 `src/lib/validation.ts:5`；`src/lib/rateLimit.ts:14`；前端 `functions/api/[[path]].ts:70`、`:136`。
- 根因：`readJsonObject` 默认 64 KiB，但缺少 Content-Length 时按 0 处理，直接执行完整 `request.json()`；即使后续字段被拒绝，也已读取/解析大请求。注册/登录限流还会先 `request.clone().json()`，在执行 limiter 前读取请求体。
- 验证：直接调用真实 helper，无 Content-Length 的 **70,013 bytes** JSON 在默认 65,536 上限下成功返回。Pages 有真实流式 1 MiB 上限，但这个不同上限既不能保护独立 Worker 入口，也不能保证 helper 的 64 KiB 契约。
- 建议：Worker 的公共入口执行流式计数和取消；各路由允许更低限额；限流先做不解析正文的 IP/边缘门槛，邮箱维度在有界解析后追加。不要只扩大 Pages 上限。未做内存耗尽压测。

### R4 — 中 / P2：上传链路的大小与 Content-Length 契约不一致【部分确认】

- 位置：前端 `functions/api/[[path]].ts:1`、`:46`、`:136`、`:151`；`src/utils/api.ts:394`；后端 `src/routes/communityAssets.ts:5`、`:15`、`:99`。
- **已确认**：Pages 超过 1 MiB 返回 413，但资源上传后端允许 15 MiB；本地 1,048,577-byte 请求在到达 binding 前被拒绝。故后端允许的 1–15 MiB 文件不能经当前网关上传。
- **已确认**：网关读完 body 后去掉 Content-Length，本地 mock binding 收到该头为 null；后端要求该头，否则 411。
- **未验证**：Cloudflare 实际 service fetch 是否依据 ArrayBuffer 自动合成长度；因此不宣称所有小文件线上必然 411。
- 建议：定义网关/前端/后端一致的二进制限额，实际字节数由服务端流式验证；在 workerd/隔离预发中测 Blob、小文件、1 MiB 边界及大文件，不能依赖 Node mock 证明平台头部行为。

### R5 — 中 / P2：公开网格列表无分页且加载完整 revision 行【已确认，规模影响为推断】

- 位置：后端 `src/routes/gridPatterns.ts:721`，特别是 `:727`、`:729`、`:734`、`:736`。
- 匿名列表可遍历所有用户的公开 ACTIVE 网格；SQL 无 LIMIT/cursor，`r.*` 把 palette/settings/descriptors 等字段读入 Worker，随后仅映射元数据丢弃。每行还有两次关联子查询。公开列表不受单用户 10/20/25 件额度约束。
- 建议：数据库级游标分页、明确列投影、一次性获取关联元数据；离线 `EXPLAIN QUERY PLAN` 与多用户数据集压测后再决定索引。关联子查询不是已证实的“每条记录一次远程 N+1”，不混淆二者。
- 对照：`communityPosts.ts:7`、`:198`、`:216` 的社区 feed 已有 24/60 页上限和游标，但计数/用户头像响应体仍需规模测试；`auth.ts:164` 允许较大的 Base64 头像，社区分页不能自动保证响应字节上限。

### R6 — 中 / P2：上传缺少账户总量约束；未发布资源缺乏清理路径【已确认已查路径，滥用程度为推断】

- 位置：后端 `src/routes/communityAssets.ts:99`、`:104`、`:126`；`src/lib/rateLimit.ts:3`；`src/lib/workCleanup.ts:28`、`:67`。
- 资源上传仅 `requireAuth`，包括已登录 guest；已查上传路径无账户字节配额/上传限流/幂等复用，每次新建 KV 对象和 D1 行。当前清理仅追踪关联到过期软删除作品的帖子资源；未发布且无关联的成功上传不在该集合内。
- KV put 后 D1 insert 失败有 delete 补偿，这是已有保护；若补偿 delete 也失败仍可能留孤儿。单次 15 MiB 不能限制长期存储消耗。
- 建议：按现行业务授权定义 uid/IP 上传预算、待发布资源 TTL、可重试孤儿对账与指标；先盘点再设计垃圾回收，不能盲删私有资源或改 legacy 字段。无生产存储扫描，实际孤儿量未知。

### R7 — 中 / P2：注册限流可按邮箱换桶；quick-login 配置失败仍留下用户【已确认】

- 位置：后端 `src/lib/rateLimit.ts:14`、`:40`；`wrangler.jsonc:13`；`src/routes/auth.ts:119`。
- 同 IP 使用不同邮箱注册会产生不同限流 key，缺少先行 IP 总预算；本地 limiter spy 已确认。不是对固定邮箱暴力尝试完全无限制，也未假定 Cloudflare 限流是全球强一致总配额。
- `quickLogin` 在验证 JWT_SECRET 前先插入 guest，与 signup 的预检查不一致。实际函数 + SQLite 验证：缺少签名配置返回 503，但已留下一行 guest。
- 建议：IP 与账户两级预算；quick-login 在任何 mutation 前检查签名配置；对配置故障与用户增长异常设告警。并发注册邮箱唯一冲突可能表现为 500，未单独复现，不列为已确认漏洞。

### R8 — 中 / P2：直连 Worker 的 CORS 缺少 PUT【已确认】

- 位置：后端 `src/lib/cors.ts:3`、`:49`；`src/index.ts:255`；前端 `src/utils/communityApi.ts:178`。
- 配置允许 origin 的预检响应只列 GET/POST/DELETE/OPTIONS，未列 PUT。私密切换使用 PUT，配置为跨域 Worker URL 的本地/自托管客户端会被浏览器拦截；同源 Pages 路径不受该预检问题影响。
- 验证：真实 `corsHeaders`，允许的 Pages Origin + 请求 PUT，返回的允许方法不含 PUT。
- 建议：与路由支持方法同步、保持 origin 白名单，并增加真实浏览器跨域 PUT 预检及后续请求测试；CORS 不是鉴权，未携 Origin 的服务端请求仍需正常权限控制。

### R9 — 中 / P2：测试默认排除 Pages 网关；本地开发可能连真实后端【已确认】

- 位置：前端 `vite.config.ts:30`、`:35`、`:41`；`src/utils/api.ts:149`、`:165`。
- 默认 Vitest include 只有 `src/**/*.test.ts`，`functions/api/[[path]].test.ts` 即使命令列出也不收集。首次前端定向命令只运行了 5 文件/57 测试；单独传 `functions/api` 返回 “No test files found”。用 Vitest API 显式 include 后，网关 1 文件/6 测试通过。
- Vite dev proxy 默认指向一个真实 Pages 部署 URL；API helper 未设置环境变量时也有 production Worker fallback。默认 `dev` 不是隔离本地测试边界。
- 建议：发布门禁显式包含网关测试；本地/浏览器测试同时设置两个本地 URL，不能沿用 README 默认环境后执行写操作。预发 Pages 的 service binding 也应明确指向隔离 Worker/D1/KV，当前配置没有这种隔离声明。

### R10 — 中 / P2：运行与安全文档落后于实际架构【已确认】

- 前端 `README.md:1` 仍为 AI Studio 模板，要求 GEMINI_API_KEY，但已查 Vite 构建配置未注入该密钥；没有本项目 Pages/Worker 发布、监控和回滚步骤。
- 后端 `docs/beadgrid-spec.md:1` 仍称只有四张业务表、图像二进制不可入 D1、R2 为存储方向、额度 10/30/50；实际是扩展表 + D1 网格/预览 BLOB + 社区 KV，现行网格文档/函数为 10/20/25。这里是文档矛盾，**不授权更改业务规则或搬迁数据**。
- `docs/local-community-integration.md` 已有 legacy fixture → local migrations 的正确依赖说明，但工作目录示例过时，且与前端默认 3000 端口及当前 production proxy 不完全一致。
- 建议：以现有实现与用户认可的产品规则核对文档，补足迁移兼容、环境隔离、监控责任人、回滚版本清单。下面提供本次可执行门禁及回滚路径，不自动执行发布动作。

## 安全边界补充与未决项

| 项目 | 已查证据与结论 | 限制/后续 |
| --- | --- | --- |
| SQL 注入 | 登录/拥有者/发布/可见性等数据值使用 `.bind`。`admin.ts:585` 的动态日志表/列来自 admin/user/error 固定分支，值继续 bind。未在这些路径确认可利用 SQL 注入。 | 未逐条审计全部 admin/credits SQL，不能外推全部安全。 |
| XSS | `PublicAnnouncementModal.tsx:16` 限制 http/https；`:109`、`:111` 使用 React 文本渲染；已查社区卡片使用 JSX，上传禁止 SVG/HTML，返回 nosniff。 | 未做所有组件 DOM sink 扫描/真实浏览器恶意输入测试；现有 token 在 local/sessionStorage，若其他入口有同源 XSS 会扩大影响。未查到仓库 `public/_headers`；线上 CSP/安全响应头未知。 |
| 上传 | `communityAssets.ts:27`、`:39` 检查 MIME 白名单/魔数，`:107` 全量 ArrayBuffer 后检查长度。 | 魔数不等同完整解码或像素/解压预算；并发内存峰值未测。不能把该实现描述为流式上传。 |
| JWT/撤销 | `middleware/auth.ts:106` 校验签名/算法/iss/aud/exp，查询用户及 session version；后台有 RBAC 与 session 检查。 | `requireAuth` 每次查用户/version，入口和 handler 常重复调用；大头像可被重复 SELECT *，需测 D1/内存成本。 |
| 封禁语义 | `admin.ts:976` 写入 banned/suspended 且撤销 admin session；`auth.ts:106` 普通用户鉴权不检查 moderation。真实 helper 验证 banned 用户的有效 JWT 仍获通过。 | “封禁只限制后台，还是限制所有操作”未定义清楚；仅事实确认，不擅改规则。若预期全站封禁，则普通发布/上传应纳入发布阻断。 |
| 后台解锁 | `api.ts:437` 要求手输密钥；实际挂载的 `admin.ts:2154` 只校验管理员 JWT/身份并创建 opaque session，未调用 `requireWorkerSecret`。`middleware/access.ts:99` 的带密钥兑换函数不是该实际入口。 | 明确是否仍要求独立解锁密钥；当前测试通过不证明实际路由有此门槛。不能称普通用户可直接升为管理员。 |
| 密码/token 日志 | telemetry 上下文为 route/method/status/duration 白名单，没有正文/Authorization；密码重置审计使用描述，未在已查路径确认密码被写入审计。 | `lib/response.ts:34` 和 `workCleanup.ts:81` 会记录原始异常字符串，没有统一脱敏；是否会含上游 token/PII 为推断，未发现真实泄漏，不打印凭证验证。 |
| 私密图片 | `communityAssets.ts:175` 公共资源 SQL 同时要求 `visibility=1 AND withdrawn_at IS NULL`；私有资源按 owner uid；公共图像 no-store，网格预览亦 no-store。 | 未发现这些**单入口正常状态**的直接 ID 私密旁路；R1/R2 的跨入口状态失配仍可泄露网格。已下载副本和已在途响应不能靠撤回追回。 |
| 定时清理 | `workCleanup.ts:1`、`:67` 按七天宽限、每次最多 25 件，顺序删除 KV 后 D1 batch，可重试。 | 每日最多处理 25 件，失败老记录可能反复占批次；未发布孤儿不覆盖。KV/D1 不存在统一跨存储事务。 |

## 监控：配置启用、仅有代码、缺口分别列出

“配置启用”表示当前仓库声明，**不等于确认线上生效**；本次没有读取生产控制台或远程日志。

| 能力 | 当前实际证据 | 状态与缺口 |
| --- | --- | --- |
| Workers Logs | 后端 `wrangler.jsonc:45` enabled=true、采样 1；异常/cleanup console 输出 | **已配置**；线上 ingestion/保留期/成本/权限未验证。不能据此声称已配外部告警或 traces。 |
| API 错误 D1 落库 | `index.ts:377`、`:390`、`:407` 使用 waitUntil 写 error_events，失败降为 warn | **代码已接入请求处理**；依赖 0007 对应表及线上执行权限，未核实生产迁移。D1 故障时同库错误落库也失败，应保留独立日志/告警。 |
| 用户活动 | `index.ts:336`、`:384` 写 user_activity_logs | **代码已接入**，actor_uid/entity_id 为 NULL；成功活动上下文没有可用于用户追踪的身份，也未写 requestId。不能用于可靠的逐用户审计。 |
| 管理员审计/查询 | `lib/audit.ts:1`；`admin.ts:585`、`:1890`、`:263` | **写入/后台查看代码存在**，取决于表和角色配置；未发现审计保存期/防篡改归档/审计写失败补偿声明。 |
| Cron | `wrangler.jsonc:8` 每日任务；`index.ts:464` waitUntil | **已配置且接入**；清理结果的 scanned/deleted/failed 返回值未由 scheduled handler 输出/上报。缺最后成功时间、积压量与“无执行”告警。 |
| 健康检查 | `index.ts:223` 静态 ok；前端 `main.tsx:9` 页面启动时检查一次 | **代码存在且接入**，只证 HTTP 可响应；不查 D1/KV，不是周期合成监控。前端仅 console，无通知收件人。 |
| AI 开关与预算 | limiter binding 已配置；`assemblyAi.ts:99`、`cartoonRestyle.ts:38` 检查 enabled 与 ARK_API_KEY | **代码门槛存在，但 wrangler vars 未声明启用两个开关**；线上 secrets/变量未知，不能声称 AI 已启用或已关闭。每用户频率不等于全局花费/并发上限。 |
| 前端异常/性能 | ErrorBoundary 监听 window error；未查到已接入的远程上报初始化 | **仅本地处理证据**；缺 unhandledrejection、React 渲染错误可靠捕获、Web Vitals、release id 和采样/脱敏配置。 |
| 告警/链路追踪/备份演练 | 已查配置和运维文档未见 SLO、receiver、Logpush/OTel、恢复演练记录 | **仓库未配置/未文档化**；Dashboard 外配状态未验证。 |

发布前建议由负责人明确：5 分钟 5xx >1% 且样本≥100、关键合成检查连续失败≥2 次、P95 API 超过基线两倍、413/411/409 激增、D1 限额与 KV 存储增长、Cron 超过 26 小时未成功、清理积压持续上升、AI 花费/在途数异常的通知渠道与响应人。这里的阈值是待采用的建议，**没有自动创建告警**。应给响应加入可关联的 request id，并在日志中白名单采集，禁止记录密码、JWT、Cookie、解锁密钥、图片正文。

## 原审查者真实执行的验证命令与历史结果

全部在本机执行，未运行 deploy、remote D1/KV 写命令。未执行构建，以免在仅允许新增报告的范围外生成 dist。

| 工作目录/命令 | 实际结果 |
| --- | --- |
| 后端 `pnpm run typecheck`；前端 `pnpm run lint` | 均 exit 1，环境 pnpm 自动依赖检查触发 `ERR_PNPM_IGNORED_BUILDS`；未进入 tsc，未执行 approve-builds/改策略。 |
| 两仓库分别 `node node_modules/typescript/bin/tsc --noEmit` | 均 exit 0。 |
| 后端 `node --import tsx --test test/*.test.ts` | 首次快照 exit 1：237 tests，232 pass、5 fail。1 个社区 reaction JSON PUT 的 id 校验失败，4 个新签到 SQLite 测试涉及全局 grant_key 冲突/并发奖励断言；属于共享工作区当时结果，不归因于本报告。未复做签到/收藏修复。 |
| 后端 `node --import tsx --test --test-reporter=spec test/*.test.ts`（实际通过 PowerShell `Select-Object -Last 85` 限制输出并保留 LASTEXITCODE） | 原审查阶段末次复测 exit 0：241 tests，241 pass、0 fail。首次失败已被当时快照替代；当时的测试通过未覆盖 R1/R2 跨入口缺陷。此数字保留为历史，不是当前整合终态；后续修复/复核状态及更晚快照见顶部表。 |
| 前端 `node node_modules/vitest/vitest.mjs run functions/api/[[path]].test.ts src/utils/api.test.ts src/utils/communityApi.test.ts src/utils/communityApi.contract.test.ts src/context/AuthContext.provider.test.ts src/components/PublicAnnouncementModal.test.ts` | exit 0：实际仅 5 文件/57 测试通过；网关被默认 include 排除，不能算入该通过数。 |
| 前端 `node node_modules/vitest/vitest.mjs run functions/api --reporter=dot` | exit 1：No test files found，印证 R9。 |
| 前端 Node stdin 调用 Vitest `startVitest('test',[],{config:false,include:['functions/api/**/*.test.ts'],watch:false,reporters:['dot']})` | exit 0：1 文件/6 测试通过，显式覆盖网关。可执行命令见下。 |
| 后端 `@'…'@ \| node --import tsx --input-type=module -`，真实函数 + 内存 SQLite/spy | exit 0：R1 两个场景；R2 真实发布交错；R3 无长度大 JSON；R4 网关大小/丢长度头；R7 限流换桶/guest 残留；R8 缺 PUT；banned 用户仍通过普通鉴权。合并可复现核心脚本见附录。 |
| 从本文提取并执行附录完整 PowerShell 代码块；另提取执行网关 Vitest 代码块 | 均 exit 0；附录输出 R1 私密、R1 撤回、R2 关联竞态三项 confirmed；网关再次 6/6 通过，证明报告中的命令可直接执行。 |
| 两仓库 `git status --short` / `git diff --stat` | 已核对预存及其他代理新增改动；本任务只新增此报告。未 reset/checkout/stash/commit。 |

网关单独验证命令（在前端仓库，绕过默认 include；不会部署）：

```powershell
@'
import { startVitest } from 'vitest/node';
const ctx=await startVitest('test',[],{config:false,include:['functions/api/**/*.test.ts'],watch:false,reporters:['dot']});
if(!ctx)process.exitCode=1;
else {process.exitCode=ctx.state.getFiles().some(f=>f.result?.state==='fail')?1:0;await ctx.close();}
'@ | node --input-type=module -
```

## 发布前门禁：当前两个仓库

**本轮授权只有文档，报告本身不需要应用发布或 D1 迁移。** R1/R2 已获 Plato 最终独立复核通过，签到/收藏已获 Newton 最终独立复核通过，父代理最终整合验证亦通过。下列为后续获授权操作者的发布/运维检查；本地审查关闭不替代线上 D1、环境隔离、监控与恢复能力验收，也不授权执行部署或生产写入。

1. 冻结待发布快照，记录两个仓库的代码版本、未提交文件归属与 lockfile；本报告的初始 HEAD 不是可直接用作生产回滚的版本。只发布已获授权的具体变更，不能将共享工作区中所有未提交内容一并上传。
2. 在两仓库分别运行 `node node_modules/typescript/bin/tsc --noEmit`；后端运行 `node --import tsx --test test/*.test.ts`；前端运行 `node node_modules/vitest/vitest.mjs run` 并单独执行上述网关命令。须先消除相关失败再进入发布。
3. 对 R1/R2 已修及补修版本，在独立复核中覆盖公开→私密→公开→撤回→重发；匿名、非拥有者、拥有者；列表、详情、public asset、grid open/chunk/preview；并发的旧 status=1、撤回重发到不同 work、detach work→null 的持久历史、删除、重复请求。返回失败时同时断言**持久化状态没有局部改变**。本报告附录保留修前缺陷复现，不应再要求修后代码满足漏洞成立的断言；修后测试应断言拒绝/安全状态。
4. 在隔离预发验证实际 Pages service fetch：小 Blob、1 MiB±1、后端允许上限、无 Content-Length、伪 MIME/魔数、格式有效但大像素图片；验证 411/413、内存峰值和取消行为。跨域 Worker 模式验证 PUT OPTIONS 与后续请求，同源 Pages 模式独立验证。
5. 离线用多用户公开作品数据验证列表分页/最大响应字节、D1 rows_read、查询计划、P95/并发；检查大头像、重复鉴权、AI 13 MB 响应读入/序列化的峰值。未跑过压测不能把“用了分页/限流”写成性能验收通过。
6. 全链路隔离：后端按 `docs/local-community-integration.md` 的 legacy fixture 引导**独立临时本地 D1**后再迁移；本任务未创建该状态目录。前端开发同时显式设置以下变量，避免触达真实 Pages/Worker：

```powershell
# 前端仓库；仅后续获授权的本地验证使用
$env:VITE_WORKER_API_URL='http://127.0.0.1:8787'
$env:VITE_DEV_API_PROXY_TARGET='http://127.0.0.1:8787'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000
```

7. 在可写的隔离构建目录执行前端 `node node_modules/vite/bin/vite.js build`，核对 dist 与 `/api/*` 路由、service binding、生产 API 地址和安全头；不得把 server secret 注入 VITE_*。本任务未读取或打印 secret 值。校验生产所需 secret 的存在性应由操作者只记录 pass/fail。
8. 记录 Pages 生产 deployment id、Worker 当前/上一已验收 version id、D1 迁移版本与恢复 bookmark、KV 对象备份清单、绑定名和非敏感配置；预发的资源与生产必须不同。验证通知接收、错误采集、Cron 心跳和恢复演练。未经授权不能执行生产迁移/恢复/清理。

## 回滚路径：Pages + Worker + D1 + KV

### 仅本次报告

唯一产物是本文档，无运行时/数据库变更。若要撤销本轮交付，只由拥有者移除本文件；无需 Git reset、部署或数据库回滚，不触碰其他代理改动。

### 前端 Pages：stellabean（前端仓库）

- 发布前由操作者保存**上一成功生产 deployment id**及它使用的 Function/绑定配置。发生 UI/网关回归时，在 Cloudflare 控制台 → Workers & Pages → `stellabean` → Deployments → 目标历史生产部署 → “Rollback to this deployment”。Preview 部署不能作为生产回滚目标。
- 回滚后核验主生产域首页与 `/api/health`、静态资源、登录及网关上传；检查 `BACKEND_API` 仍绑定预期 `stellabean-api`。Pages 回滚不会同步回滚被绑定 Worker 的代码或 D1/KV 数据，当前旧网关自身的 R4 也不会因回滚自然消失。
- 若后端已有新隐私字段/行为，先保证兼容后端仍能拒绝旧客户端旁路，再切换旧前端；不要因前端回退恢复不安全服务端判定。

### 后端 Worker：stellabean-api（后端仓库）

- 控制台 → Workers & Pages → `stellabean-api` → Deployments → 事先记录且已验收的历史 version → Rollback；回滚到单一版本后确认流量为 100%。若使用 CLI，由获授权操作者在后端目录执行 `node node_modules/wrangler/bin/wrangler.js rollback <已验收的-version-id> --name stellabean-api`。**此命令会改变生产状态，本任务未执行，也未获得执行授权。**
- 不自动选择 HEAD/最新旧版本：应选兼容当前 D1/KV、仍封闭私密旁路、仍执行 session version/RBAC 的版本。旧版若不理解 visibility/withdrawn_at，回滚可能扩大隐私暴露，应先用已验收的安全版本或阻断相关入口。
- 核验服务绑定、ALLOWED_ORIGINS、Cron、限流与可观测配置，避免把未验证的新业务改动带入“回滚包”。Workers 回滚不恢复外部存储内容；配置/绑定资源改变可能限制可回滚范围。密钥按独立运维记录核对存在性，不输出值。

### D1：DB → stellabean

- 本轮没有新增迁移，也没有授权运行 down migration、drop/alter legacy 字段或整库恢复。优先采用与新表/新数据兼容的代码回滚，保留已提交的用户数据。
- 真正的数据损坏需另获生产写授权：先限制受影响写入，记录恢复点后的新业务写入范围与补偿计划，由操作者核实该库版本/套餐对应的 Time Travel 可用窗口与 bookmark，再执行经过隔离恢复验证的恢复方案。不能以代码回滚代替数据恢复，也不能直接套用全库恢复丢弃之后的正常写入。
- 数据库时间点回退会影响用户、会话版本、积分和发布状态；若回退会撤销密码重置/封禁/session version，必须同时设计重新撤销会话。不得只恢复可见性表而忽略关联作品状态。

### KV：COMMUNITY_ASSETS

- Worker/Pages/D1 回滚都不会把已删除的 KV 图片恢复。`workCleanup.ts:36` 明确先删 KV；D1 Time Travel 可能恢复元数据却留下缺图引用。
- 生产变更前需要图片对象版本/导出备份及 storage_key/sha256 清单；事故时以该清单恢复对应对象并核验长度/hash，然后核对 D1 的关联与可见性。若从未备份，已删除对象不保证可恢复，须如实报告损失，不能承诺一键回滚。
- 恢复过程中避免 Cron 继续清理待恢复对象；停用/调整 Cron 也属于另需授权的生产配置操作。私密/撤回状态应优先维持，不能为恢复图片而暂时放开公共读。

平台路径依据：[Pages 回滚](https://developers.cloudflare.com/pages/configuration/rollbacks/)、[Workers 回滚及外部资源限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)、[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[Workers Logs 配置](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)。线上资源/套餐/控制台状态未验证。

## 附录：R1/R2 修前核心复现（历史证据，纯内存，无文件/生产写入）

**此脚本的断言用于证明旧缺陷；不适合作为修后通过门禁。** Planck 修复及补修后的版本应阻断这些不安全结果，具体独立复核状态见顶部表。脚本的精简 schema 也不代表新增持久历史判定所需的全部测试结构。

从后端仓库执行下列 PowerShell 命令。使用真实路由，SQLite 为精简表结构并保留关联唯一性及事务，不模拟 Cloudflare 网络/多机调度。断言证明代码不变量缺陷；不等于测得线上发生概率。`JWT_SECRET` 仅为脚本内生成的一次性测试值，不读取真实凭证。

```powershell
@'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { issueToken } from './src/middleware/auth.ts';
import { changeWorkStatus } from './src/routes/works.ts';
import { listGridPatterns } from './src/routes/gridPatterns.ts';
import { publishCommunityPost, withdrawCommunityPost, setCommunityPostVisibility } from './src/routes/communityPosts.ts';
const db=new DatabaseSync(':memory:');
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE users(uid TEXT PRIMARY KEY,auth_provider TEXT);
CREATE TABLE user_session_versions(uid TEXT PRIMARY KEY,version INTEGER);
CREATE TABLE works(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(uid),status INTEGER,updated_at INTEGER,total_beads INTEGER,thumbnail_url TEXT,created_at INTEGER);
CREATE TABLE community_assets(id TEXT PRIMARY KEY,owner_uid TEXT REFERENCES users(uid));
CREATE TABLE work_assets(work_id TEXT PRIMARY KEY REFERENCES works(id),asset_id TEXT UNIQUE REFERENCES community_assets(id),owner_uid TEXT,created_at INTEGER,updated_at INTEGER);
CREATE TABLE community_posts(id TEXT PRIMARY KEY,asset_id TEXT UNIQUE REFERENCES community_assets(id),author_uid TEXT,title TEXT,published_at INTEGER,withdrawn_at INTEGER,work_id TEXT REFERENCES works(id),active_work_key TEXT UNIQUE,description TEXT,visibility INTEGER,mutation_token TEXT UNIQUE);
CREATE TABLE community_likes(post_id TEXT,uid TEXT);
CREATE TABLE community_favorites(post_id TEXT,uid TEXT);
CREATE TABLE community_post_tags(post_id TEXT,tag TEXT,created_at INTEGER);
CREATE TABLE work_grid_revisions(work_id TEXT,revision INTEGER,status TEXT,finalized_at INTEGER);
CREATE TABLE work_previews(work_id TEXT,revision INTEGER);
INSERT INTO users VALUES('owner','password');
INSERT INTO works VALUES('work_A','owner',0,1,10,NULL,1),('work_B','owner',0,1,10,NULL,1);
INSERT INTO work_grid_revisions VALUES('work_A',1,'ACTIVE',1),('work_B',1,'ACTIVE',1);
INSERT INTO community_assets VALUES('asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','owner'),('asset_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','owner');`);
let before=null;
const DB={prepare(q){const bind=(...v)=>({bind,first:async()=>db.prepare(q).get(...v)??null,all:async()=>({results:db.prepare(q).all(...v)}),run:async()=>({meta:{changes:Number(db.prepare(q).run(...v).changes)}}),execute:()=>({meta:{changes:Number(db.prepare(q).run(...v).changes)}})});return{bind};},async batch(s){if(before){const f=before;before=null;await f();}db.exec('BEGIN');try{const r=s.map(x=>x.execute());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
const env={DB,JWT_SECRET:crypto.randomUUID()+crypto.randomUUID()};
const token=await issueToken(env,'owner');
const req=(method,path,body)=>new Request('https://review.invalid'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
const pub=async(work,asset)=>{const r=await publishCommunityPost(req('POST','/api/community/posts',{workId:work,assetId:asset,title:'Review'}),env,new Headers());return(await r.json()).data.post;};
const visible=async()=> (await(await listGridPatterns(new Request('https://review.invalid/api/user-patterns?public=1'),env,new Headers())).json()).data.length;
const first=await pub('work_A','asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
await setCommunityPostVisibility(req('PUT','/api/community/posts/visibility',{id:first.id,visibility:'private'}),env,new Headers());
assert.equal(await visible(),0);
await changeWorkStatus(req('POST','/api/user-patterns/status',{id:'work_A',status:1}),env,new Headers());
assert.equal(await visible(),1);
assert.equal(db.prepare('SELECT visibility FROM community_posts WHERE id=?').get(first.id).visibility,0);
console.log('R1 confirmed: private post, anonymous grid visible after legacy status');
await withdrawCommunityPost(req('DELETE','/api/community/posts?id='+first.id),env,new Headers());
assert.equal(await visible(),0);
await changeWorkStatus(req('POST','/api/user-patterns/status',{id:'work_A',status:1}),env,new Headers());
assert.equal(await visible(),1);
console.log('R1 confirmed: withdrawn post, anonymous grid visible after legacy status');
await pub('work_A','asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
before=async()=>{
 await withdrawCommunityPost(req('DELETE','/api/community/posts?id='+first.id),env,new Headers());
 await pub('work_A','asset_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
 const moved=await pub('work_B','asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
 assert.equal(moved.id,first.id);
};
const response=await setCommunityPostVisibility(req('PUT','/api/community/posts/visibility',{id:first.id,visibility:'private'}),env,new Headers());
const post=db.prepare('SELECT work_id,visibility FROM community_posts WHERE id=?').get(first.id);
assert.equal(response.status,200);assert.equal(post.visibility,0);assert.equal(post.work_id,'work_B');
assert.equal(db.prepare("SELECT status FROM works WHERE id='work_B'").get().status,1);
assert.equal(await visible(),1);
console.log('R2 confirmed: real-handler interleaving returned 200; post private, associated B still public');
db.close();
'@ | node --import tsx --input-type=module -
```
