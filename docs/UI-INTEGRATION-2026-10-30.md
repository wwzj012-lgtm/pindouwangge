# 移动端 UI 版本整合记录

日期：2026-10-30。主项目：`D:/Build_Apps/pindouwangge`。来源：`C:/Users/Plout/Desktop/pindouwangge-移动端ui重置版`。

## 版本与范围

两个目录的共同基准为 `ec85286f0d24a2e61a949f92d01f42aabc2d0062`。本次将外部版本的已完成 UI/交互迁入主项目，不更新后端、不提交或部署。原目录不改动。

原始 `MOBILE-UI-HANDOFF.md` 保存了外部版本的历次设计与实现；`GEMINI-UI-HANDOFF.md` 描述 UI 修改边界。它们作为输入参考，其历史测试数字、维护要求和后续 TODO 不是本次授权或当前验证结论。当前整合事实以本记录及实际源码为准。

初始迁移44路径（35个已有文件、8个新增src文件、1份新增移动端文档）。未复制 `.git`、依赖、缓存、`.workbuddy`、环境文件、生产配置及外部实验产物。主项目原有 `.ai-memory` 和 `scripts/quality-benchmark` 内容保留。

## 已整合的页面与交互

- 手机画布优先：按板编辑/全图切换、停靠分板导航、画布/转图/用量/工具箱/保存分层。
- 转图参数集中在一个页面，无图时主按钮直接选择图片，有图时生成；保留转换参数的原有语义。
- 手机触控与文本尺度、动态视口、安全区留白、底栏占位；桌面参数与统计面板保持紧凑的32px控件、36px主按钮。
- 手机品牌/色数选择采用底部面板，桌面保留原生下拉；导航及工具栏避免换行和压缩。
- 导入版本有意删除 JSON 工程导入/导出入口和对应链路，移动首页不再重复加载社区feed；图片/图纸导出、图库、发布和社区页面保留。
- 30MiB/4000万像素上传校验、全局用户提示和真正的 React 错误边界。

## 整合后额外修复

1. `GridCanvas`：手机/平板参考窗断点与工作区1024px保持一致，避免横屏参考面板拦截缩放按钮；低缩放提示移出绘制区域。
2. 分板定位按当前板及真实可用高度约束，不再被全图居中规则覆盖；两轴标尺最后绘制，避免被相邻板背景遮盖。验证第2/4/6板首尾格绘制与undo、全图恢复及桌面缩放。
3. `MobileSelect`：四种关闭方式恢复触发器焦点；打开定位当前项；键盘箭头/Home/End/Enter/Space、Tab约束、背景与滚动隔离、卸载清理；取消热区44px。
4. `App`：文件和像素/解码校验成功后才提交新图身份。超限/读取失败/解码失败保留旧图、保存身份、计费标记、完成状态、镜像轴、裁剪来源和实操状态；过期请求不能覆盖新请求。
5. `ErrorBoundary`：用户正文使用稳定友好提示，技术异常只记录到诊断日志；保留界面重试和根级刷新恢复。
6. 测试可移植性：品牌测试探针兼容CRLF；桌面布局测试使用 `fileURLToPath`，兼容中文路径。未削弱原断言。

## 验证证据

- 最终全量串行测试：137文件，136通过/1跳过；1559项通过/2项跳过，无失败。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/vite/bin/vite.js build`：通过；仍有入口chunk超过500kB的警告。
- `git diff --check`：通过。
- 分板/桌面真实Chrome回归7/7、MobileSelect专项37/37、真实工作台选择关闭焦点32/32；App上传及错误边界真实Chrome6项通过。各组口径重叠，不累计为总测试数。
- 独立最终复审：原6项问题全部通过，无未解决P1/P2。五视口最终真实Chrome矩阵：229/229通过，0页面异常、0非预期console异常；2条console错误来自故意抛错fixture并已明确分类。覆盖390×844、360×800、844×390、1440×1024、768×1024。

本地完整证据：`artifacts/ui-integration-20261030/`，包括清点、原始失败、修复后日志、备份、截图和保护哈希。备份使用 `.bak` 避免被tsconfig当源码扫描，不通过更改tsconfig掩盖错误。

## 保护边界与限制

转换核心 `imagePipeline/pipelineAuxiliaries/colorUtils`、色卡、`src/types.ts`、锁文件、TypeScript/Vite/Cloudflare配置均已逐文件SHA256核对未变化。`canvasViewport.ts`迁入等价边界表达式；`exportUtils.ts`仅删除工程JSON下载函数，不能把本次全部变化概括为纯CSS。

真机刘海/Home Indicator安全区未验证；无头Chrome只能验证布局与触摸模拟。未实现深色模式、strict类型升级、CI或额外分包。当前代码仅本地整合，Git提交和生产部署须另行处理。

## 当前文档入口

整合说明：本文件。完整验证报告：`artifacts/ui-integration-20261030/browser/after-final-verified-report.json`。独立复审：`artifacts/ui-integration-20261030/final-review.md`。主源码迁移与恢复：`artifacts/ui-integration-20261030/import-result.md`、`artifacts/ui-integration-20261030/backup-restore.md`。

原始handoff历史数字不代表本次通过总数；最终统计以full-serial-final.log与after-final-verified-report.json为准。
