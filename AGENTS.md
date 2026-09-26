# 项目维护约定

适用于整个仓库。面向用户的说明使用中文；代码沿用所在文件的风格。先读相关源码和测试，不根据旧验证日志推断当前实现。

## 项目与入口

这是 Windows 上 GitHub Copilot App 的非官方、可撤销运行时汉化，不是原版应用的分支。运行时只依赖 Node.js 22+ 内置模块；jsdom 仅用于测试。Windows PowerShell 编译 .NET Framework GUI 入口。

- 用户入口：`install.cmd` 安装/修复，桌面中文快捷方式启动，`uninstall.cmd` 卸载；不要要求用户依次执行多份脚本。
- `src/app-discovery.mjs`：安装和启动共用的路径发现、GitHub 签名校验。
- `src/install-support.ps1` / `src/uninstall-support.ps1`：运行时发现、安装标识、快捷方式归属与安全清理。
- `src/bootstrap.cs` / `src/launcher*.mjs` / `src/windows.mjs` / `src/cdp.mjs`：无控制台入口、生命周期、Windows 检查与 CDP。
- `src/overlay/*.mjs`：model / catalog / classifier / translator / runtime；`src/overlay-source.mjs` 在内存中组合注入脚本，无需构建产物。
- `src/machine-*.mjs` / `src/edge-*.mjs`：候选校验、缓存和独立 Edge 后端；`locales/zh-CN.json` 保存人工词典。

## 不可破坏的边界

1. 不修改 Copilot EXE、安装目录、原版快捷方式或永久系统环境；不削弱签名、回环监听、进程归属和页面来源校验。不用 `ExecutionPolicy Bypass` 绕过限制。
2. 不强制退出 Copilot，不刷新有任务或草稿的页面，不代用户发送消息、修改设置、安装插件或确认授权。实机验证优先只读；重启伴随进程不等于允许重启原版应用。
3. 所有翻译、诊断、异步回复和恢复都经过 `classifier.resolve()`。未知区域默认保留，不使用整页英文替换、`innerHTML` 覆盖或内部业务 IPC。
4. 聊天、代码、输入值、项目/模型/账户身份保持原样，即使命中词典。动态标签只翻译固定外壳；迟到回复重新核验节点、原文、归属和页面实例。恢复时不得覆盖宿主的新值。
5. 模型下载只发生在显式安装/准备阶段；日常 Edge 使用项目独立配置并阻断外网。不读取个人浏览器配置，不结束普通 Edge / WebView2 进程。
6. 安装先预检全部快捷方式；卸载先确认停用成功，再仅删除归属本安装的入口。保留用户配置、模型与 Copilot 数据；不要用真实桌面入口做破坏性测试。

## 修改与测试

```powershell
npm ci
npm test
git diff --check
```

命令从仓库根目录执行。远程 shell 不一定是 PowerShell；需要 PowerShell 语法时显式调用 `powershell.exe -NoProfile`，不要将管道命令直接交给 cmd。

新增 UI 结构必须覆盖：未知文案入队、同名数据不变、归属变化恢复、迟到回复拒绝和停用恢复。修改部署逻辑需覆盖重复操作、中文/空格/特殊字符路径、旧路径回退、快捷方式冲突、缺失运行时/状态和停止失败。Windows / COM / GUI 用例在非 Windows 会跳过，不能把该结果称为完整部署验证。

测试使用临时目录、模拟引擎与隔离伴随进程。实机工具的前置条件见 [CONTRIBUTING.md](CONTRIBUTING.md)；工具失败、超时或跳过必须如实记录，测试数不代表汉化覆盖率。

## 文档与隐私

README 只保留使用说明与限制；模块职责放 [架构](docs/ARCHITECTURE.md)，翻译边界放 [翻译规则](docs/TRANSLATION-POLICY.md)，离线引擎放 [本地翻译](docs/LOCAL-TRANSLATION.md)。避免每次改动都复制整段历史说明。

`config.json`、`.local/`、`node_modules/`、缓存、截图和原始诊断报告不得提交或打包。夹具只用虚构身份和路径；`--include-text` 报告可能含私人资料，不作为发布附件。验证记录只写环境、操作边界、结果与未测项。

## 提交与发布

仅在用户要求时提交、推送或发布；保留与任务无关的工作区改动，不使用 `reset --hard`、强推或覆盖已有标签。暂存前逐项检查差异和未跟踪文件，不盲目 `git add .`。

发布同步 `package.json`、`package-lock.json`（顶层和根 package）、`locales/zh-CN.json` 的版本及 CHANGELOG。先完成本地测试和隐私检查，推送主分支并确认该提交的 Windows CI 成功，再创建唯一的 `v<version>` 标签及 GitHub Release。沿用源码发布，不打包个人配置或模型；具体步骤见 [发布检查](docs/RELEASE-CHECKLIST.md)。
