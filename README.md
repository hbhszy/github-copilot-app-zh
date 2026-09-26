# GitHub Copilot App 中文界面

Windows 上的非官方、可撤销运行时汉化。使用原版 GitHub Copilot App，不修改 EXE、安装目录、签名或原有快捷方式。

本项目与 GitHub, Inc. 无隶属或背书关系；“GitHub”与“GitHub Copilot”等名称仅用于说明兼容对象。

当前适配并实测：GitHub Copilot **1.1.23** / WebView2 **153.0.4234.48**。不承诺其他版本自动兼容，也不声称所有界面文案都已汉化。

## 使用

1. 如果 Copilot 已经从原版入口启动，先在应用中按 **Ctrl+Q** 正常退出。关闭窗口可能只缩到托盘。运行中的任务应先完成或自行停止。
2. 双击桌面或开始菜单的 **GitHub Copilot 中文**。
3. 原版应用启动后，词典中的固定文案立即切换为中文；批准区域内的新英文说明会在后台离线翻译并缓存。

中文快捷方式无控制台窗口，重复打开不会重复注入。已有原版实例未带汉化参数时，入口会等待你正常退出后接续启动，不强制关闭任务；停用入口可以取消等待。

开始菜单的 **停用汉化 - GitHub Copilot** 会恢复英文并停止伴随进程。若还需要关闭调试端口，请正常退出 Copilot，然后使用原版入口启动。单纯关闭翻译层不会关闭 WebView2 的调试端口。

升级后若应用自行重启且中文消失，正常退出后重新打开中文入口。不要为保持汉化关闭官方自动更新。

## 安装与卸载

### 新电脑：双击一个安装入口

先安装原版 **GitHub Copilot App** 和 **Node.js 22+**，将本项目解压或克隆到准备长期保留的可写目录，然后双击根目录的 **`install.cmd`**。新电脑建议使用干净的源码目录，不复制旧电脑的 `.local` 运行状态。自动翻译另需本机 Microsoft Edge（本机实测 153）。

**不需要手填应用路径、运行 `start.ps1` 或单独准备翻译组件。** 安装会自动发现并校验 Copilot，保存 Node 路径，编译 GUI 入口，创建桌面/开始菜单的中文快捷方式和开始菜单停用入口，最后准备缺失的翻译组件。已有模型和翻译设置保留；同名的其他安装或工具入口不会被覆盖。

完成后直接使用 **GitHub Copilot 中文** 快捷方式。安装本身不会启动、强制退出 Copilot 或停止现有任务。

核心运行时只使用 Node 内置模块；图形入口使用 Windows 的 .NET Framework，安装时通过 Windows PowerShell 编译本项目源码。不需要 npm install、Python、API Key 或在线翻译服务。首次准备翻译组件需要联网，可能下载数百 MB，之后日常翻译阻断外网。Node 缺失或版本过低会给出提示；安装入口不会静默安装系统软件。

缺少 Edge、网络不可用或翻译配置正在使用时，会明确提示自动翻译准备未完成，但已安装的快捷方式和人工词典仍可使用。按提示使用开始菜单的停用入口后，**再次双击同一个 `install.cmd` 即可重试**，无需换用另一份脚本。安装结果保存在 `.local/install-result.json`。

### 可选命令行参数

```powershell
.\install.ps1                       # 与双击入口相同，自动识别并准备组件
.\install.ps1 -SkipTranslator       # 仅安装/修复入口，跳过组件准备
.\install.ps1 -PrepareTranslator    # 强制重新检查/更新组件，需先停用汉化

# 仅在自动发现失败或需选择另一份安装时使用；也可传入 EXE 所在目录
.\install.ps1 -AppPath 'D:\Apps\GitHub Copilot\github.exe'
```

`install.cmd` 同样接受这些参数。`npm run setup:translator` 仅用于单独维护组件，不是必需步骤。快捷方式冲突时，需自行确认并重命名或移除冲突入口后重试。

建议保持项目目录位置不变。需要移动时，先停用汉化，保留 `.local/installation-id`，移动后双击 `install.cmd` 即可按安装标识修复旧快捷方式；没有原安装标识时不会擅自接管另一份目录的入口。Node 升级或路径变化后也可用同一入口修复。

### 卸载

双击根目录的 **`uninstall.cmd`**，不需要再打开 PowerShell 或单独运行另一份脚本。窗口会显示结果并等待按键，失败时保留错误提示。

卸载先正常停用汉化，再仅删除本安装的快捷方式；停用失败则不继续删除。支持重复卸载、失效 Node 路径恢复和保留安装标识后的目录迁移。不会强制退出 Copilot，项目文件、翻译模型、原版快捷方式及 Copilot 数据均保留。正常退出并从原版入口重开可关闭调试端口；确认不再需要后自行移除项目目录。命令行仍可运行 `.\uninstall.ps1`。

日常快捷方式直接启动本项目 GUI 入口，不依赖 PowerShell。`install.cmd` 和 `uninstall.cmd` 使用 Windows PowerShell，仅为当前进程指定 `RemoteSigned`，不修改系统或用户的永久执行策略，也不覆盖组织组策略。下载文件的来源标记或组织策略仍可能阻止运行，请按管理员允许的流程处理，不应绕过组织限制；可以在允许的 Node 终端中运行下方命令。`start.ps1 -Console` 是保留终端输出的兼容/开发入口，安装和日常使用都不需要单独运行它。

## 命令行

```powershell
node src/launcher.mjs          # 启动，或重新接入本工具之前创建的有效端点
node src/launcher.mjs --status # 查看版本、端口、签名、运行状态
node src/launcher.mjs --stop   # 停用并还原可恢复的文字
```

`--status` 中 `phase: ready` 才表示汉化已就绪，`active` 只表示伴随进程运行；`waiting-for-app-exit` 表示等待原版正常退出。`--attach PORT` 仅供诊断，普通使用无需指定端口。

配置示例见 [config.example.json](config.example.json)。`appPath` 可省略，安装时自动填写；旧路径失效时会重新发现应用。

`machineTranslation.enabled: false` 可关闭机器翻译、保留人工词典；`idleSeconds` 默认 180（范围 30–600），较长驻留减少频繁打开菜单时重复冷启动，代价是多占用一段时间的内存。`warmup: true` 默认在启动时并行预热本地引擎，关闭后仅遇到未缓存文案才启动引擎。修改配置后停用并重开中文入口。

耗时、缓存与离线引擎说明见 [本地翻译](docs/LOCAL-TRANSLATION.md)。

## 范围与限制

已支持的范围包括侧栏和常见操作按钮、设置页导航、常规/会话/主题/辅助功能/模型提供商/实验功能中的大量固定说明，以及首页、“我的工作”、自动化和自定义页的部分固定文案。

翻译先判断“是不是应用自带的界面文案”，再按“人工词典 → 本地缓存 → 离线引擎”处理。人工词典负责术语、常用短标签和译文纠正，不是自动翻译白名单；在已支持区域新增文案，不需要先添加词条。词典中将原文映射为原文可明确要求保留该文案。

对话、代码、终端、输入值、账户/项目/模型/主题名称及用户工作流正文保持原样。动态标签只翻译固定外壳；目录介绍中的路径、网址和代码字面量受到保护。新 UI 文案通常无需逐条补词典，但全新的界面结构仍需适配。详细范围见 [翻译规则](docs/TRANSLATION-POLICY.md)。

原生菜单、系统对话框、Canvas 内部内容和外部网页不在适配范围内。主题变体/排序、快捷键筛选和模型选择器的部分说明仍有覆盖缺口；未识别或校验失败的内容保留英文。

词典只改变显示文案，不替换程序内部搜索索引。因此设置和命令搜索仍主要使用英文关键词。

首次加载或离线翻译未完成时可能短暂显示英文。UI 异常时可立即停用；测试通过不代表所有机器译文准确，也不代表其他 Copilot 版本自动兼容。

## 如何工作

中文入口只为其启动的 Copilot 设置调试参数，核验 GitHub 签名、回环监听、WebView2 进程归属和主界面来源后连接。翻译仅改批准的文本节点与提示属性；停用时恢复仍由汉化层持有的译文，不覆盖宿主后续更新。模块与安全边界见 [架构](docs/ARCHITECTURE.md)。

调试端口可控制应用页面，即使仅回环监听，也不能隔离同一台机器上的其他本地进程。Microsoft 不承诺调试 flags 的长期稳定性；本工具不把它们当作官方插件接口。[WebView2 官方说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)

## 维护文档

[开发与诊断](CONTRIBUTING.md) · [Agent 约定](AGENTS.md) · [架构](docs/ARCHITECTURE.md) · [翻译规则](docs/TRANSLATION-POLICY.md) · [本地翻译](docs/LOCAL-TRANSLATION.md) · [验证记录](VERIFICATION.md) · [发布检查](docs/RELEASE-CHECKLIST.md) · [更新日志](CHANGELOG.md)

日志、模型、缓存和诊断产物只保存在被忽略的 `.local/`。报告和截图可能含私人资料，请勿未经检查就分享。

## 许可证

本项目采用 MIT License，详见 `LICENSE`。
