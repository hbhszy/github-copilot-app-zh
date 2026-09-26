# GitHub Copilot App 中文界面

Windows 上的非官方、可撤销运行时汉化。使用原版 GitHub Copilot App，不修改 EXE、安装目录、签名或原有快捷方式。

本项目与 GitHub, Inc. 无隶属或背书关系；“GitHub”与“GitHub Copilot”等名称仅用于说明兼容对象。

当前适配并实测：GitHub Copilot **1.1.23** / WebView2 **153.0.4234.48**。不承诺其他版本自动兼容，也不声称所有界面文案都已汉化。

## 使用

1. 如果 Copilot 已经从原版入口启动，先在应用中按 **Ctrl+Q** 正常退出。关闭窗口可能只缩到托盘。运行中的任务应先完成或自行停止。
2. 双击桌面或开始菜单的 **GitHub Copilot 中文**。
3. 原版应用启动后，词典中的固定文案立即切换为中文；批准区域内的新英文说明会在后台离线翻译并缓存。

重复打开中文入口不会重复注入：它会让已就绪的汉化进程唤起应用；若旧进程正在启动、断连或清理，则等待完成后接管。所有启动与唤起路径均携带汉化参数。桌面/开始菜单入口使用本项目的原生 GUI 启动器，创建无控制台的 Node 伴随进程后立即退出，不再依赖 PowerShell 的 `-WindowStyle Hidden`。源码在 `src/bootstrap.cs`，安装时编译到 `.local/CopilotZh.exe`，不修改原版 Copilot EXE。

如果已有 Copilot 实例没有汉化参数，中文入口会进入 `waiting-for-app-exit`，等待你保存工作并按 Ctrl+Q 正常退出，再自动启动中文版；不会强制关闭现有任务。可用停用入口取消等待。`--status` 的 `phase: ready` 表示已检查到汉化层就绪，`active` 单独只表示伴随进程在运行。

开始菜单的 **停用汉化 - GitHub Copilot** 会恢复英文并停止伴随进程。若还需要关闭调试端口，请正常退出 Copilot，然后使用原版入口启动。单纯关闭翻译层不会关闭 WebView2 的调试端口。

升级后若应用自行重启且中文消失，正常退出后重新打开中文入口。不要为保持汉化关闭官方自动更新。

## 安装与卸载

需要 Windows 和 **Node.js 22+**。自动翻译另需本机 Microsoft Edge（本机实测 153）。核心运行时只使用 Node 内置模块；图形入口使用 Windows 的 .NET Framework，安装脚本通过 Windows PowerShell 编译本项目源码。不需要 npm install、Python、API Key 或在线翻译服务。首次准备需联网下载微软翻译组件，之后日常翻译阻断外网。

```powershell
.\install.ps1 -AppPath 'D:\Program Files (x86)\GitHub Copilot\github.exe' -PrepareTranslator
```

安装脚本会记住当前 Node 路径，生成本项目的本地配置，并添加桌面/开始菜单快捷方式。它不会覆盖同名但属于其他工具的快捷方式。

本机模型已准备好。其他电脑可使用 `-PrepareTranslator`，或先停用汉化再运行 `npm run setup:translator` 单独下载/更新组件；缺少模型时仍可使用词典。重装入口保留已有自动翻译设置。

保持本项目目录的位置不变；移动后重新运行安装脚本。Node 升级或路径变化后也可重新安装入口。

```powershell
.\uninstall.ps1
```

卸载仅停止汉化并删除属于本项目的快捷方式，保留项目文件和 Copilot 数据。确认不再需要后，可自行移除项目目录。

快捷方式直接启动本项目 GUI 入口，不修改系统执行策略。受组织策略限制时，不应绕过组织限制；可以在允许的 Node 终端中运行下方命令。`start.ps1 -Console` 是保留终端输出的开发入口，日常使用不需要。

## 命令行

```powershell
node src/launcher.mjs          # 启动，或重新接入本工具之前创建的有效端点
node src/launcher.mjs --status # 查看版本、端口、签名、运行状态
node src/launcher.mjs --stop   # 停用并还原可恢复的文字
```

`--attach PORT` 是开发诊断入口，连接前仍会核验端口监听地址、所属 WebView2 进程及其 Copilot 父进程。普通使用不需要指定端口。

`config.json` 中可设置 `appPath`，格式参见 `config.example.json`。启动器也会尝试从运行进程、常见安装目录及卸载注册信息发现程序。

`machineTranslation.enabled: false` 可关闭机器翻译、保留人工词典；`idleSeconds` 默认 180（范围 30–600），较长驻留减少频繁打开菜单时重复冷启动，代价是多占用一段时间的内存。`warmup: true` 默认在启动时并行预热本地引擎，关闭后仅遇到未缓存文案才启动引擎。修改配置后停用并重开中文入口。

`--status` 的 `timings` 分开记录应用校验、端点就绪和汉化层就绪耗时；`machineTranslation` 中的 `initMs`、`warmupMs`、`engineTimings` 和 `lastTranslationMs` 记录引擎初始化/模型加载/翻译耗时。固定词典不等待引擎；已加载缓存直接返回，不排在引擎预热或其他新文案后面。新候选通过无正文的 CDP 通知触发处理，1.5 秒健康检查仅作为补偿入口，不再每批人为等待一次。

## 范围与限制

已支持的范围包括侧栏和常见操作按钮、设置页导航、常规/会话/主题/辅助功能/模型提供商/实验功能中的大量固定说明，以及首页、“我的工作”、自动化和自定义页的部分固定文案。

翻译先判断“是不是应用自带的界面文案”，再按“人工词典 → 本地缓存 → 离线引擎”处理。人工词典负责术语、常用短标签和译文纠正，不是自动翻译白名单；在已支持区域新增文案，不需要先添加词条。词典中将原文映射为原文可明确要求保留该文案。

自动范围包括设置页固定导航，常规、会话、主题、辅助功能、实验功能中带固定 section 标记的标题、说明、说明内链接文字和操作标签，反馈窗口，以及已识别的模式/添加上下文/新建会话菜单、自动优化选项、自动化内置模板和首页内置示例卡片。通过可访问性关系关联到固定控件的提示也可自动翻译；弹窗支持 `aria-labelledby` 多个 ID 与 `aria-controls`，对话框支持引用标题命名。单个新单词在这些已确认区域同样可以自动翻译，链接地址不改动。

为减少“每个漏翻位置单独打补丁”，当前还按**结构化界面族**识别固定 UI：键盘快捷键窗口通过标题/快捷键键帽结构确认后，整窗的页签、分组和命令文案可自动进入翻译；设置中的通用表单通过 label / help / action 与输入控件的关系确认后，提供商、模型等编辑表单新增的固定标签和说明也无需逐条加白名单；命令面板按分组语义区分固定操作与最近会话数据；会话运行位置、会话列表配置及其子菜单按 popup owner 关系自动归类。输入值、下拉当前值、项目名、会话名、提供商名、模型名仍按数据处理；`Edit <name>`、`Remove <name>`、`New session in <project>`、连接状态和计数一类动态文案只翻译固定外壳，保留其中的名称/数字。URL、JSON 示例、快捷键和技术字面量在机器翻译前遮蔽、返回后校验。人工词典主要用于术语纠正和消除首次显示闪烁，而不是覆盖率白名单。

另外有一个受保护的“通用 UI 控件兜底”：不属于已知数据选择器、项目树、模型/工作区选择器或用户内容的普通按钮/标签，新出现的英文短文案可直接进入离线翻译。因此像诊断页新增的工具栏按钮，不需要先为每个按钮写单独 selector。这个兜底不会放开标题、正文、项目/会话名称等任意文本；新的页面正文结构仍需先确认归属。

自定义页的精选、MCP、插件、技能、扩展、画布、已安装七个 TAB 支持搜索提示、分类、目录说明、空状态和操作标签；公共精选卡片和可用目录的介绍可自动翻译，包括动态加载的插件列表行。名称、星数、市场选中值与已安装项目的本地说明单独保留。分类术语与模型菜单等其他范围隔离，不共用歧义译法。

账户、提供商、模型和主题名称、自定义说明、用户工作流/技能正文、无法确认用途的弹出菜单和普通页面正文不会自动提交给模型。目录介绍中的路径、网址、文件名和行内代码片段原样保护，仅翻译周围说明；其他界面沿用保守过滤。新的界面**文案**通常无需维护；全新的界面**结构类型**仍需要增加范围识别与回归测试，不能仅凭“看起来像英文”就翻译。详细边界和维护规则见 `docs/TRANSLATION-POLICY.md`，v0.4.0 后的模块职责和扩展方式见 `docs/ARCHITECTURE.md`。

为减少误伤，以下内容保留原样：对话正文、代码与差异、终端、编辑器内容、用户输入、项目和会话名称、文件标签、未知下拉选项。原生菜单、系统对话框、Canvas 内部内容与外部网页不在适配范围内。未识别的详情结构、超过限制的文案或校验失败的机器译文仍可能显示英文。

词典只改变显示文案，不替换程序内部搜索索引。因此设置和命令搜索仍主要使用英文关键词。

汉化按节点增量执行，并使用微任务批处理，避免后台窗口的定时器节流导致明显延迟。候选队列上限为 128，积压下降后会补扫，不会因为首屏文案较多而永久漏掉后续内容。请求丢失后有有限重试；节点变成用户内容时，仅恢复仍属于汉化层的显示值。保护区内的流式文本与纯动画类名变化不会触发界面重扫。应用首次加载时仍可能短暂显示英文。UI 出现异常时可立即停用。即使本地翻译，也无法完全消除应用结构变化造成的兼容问题。

## 如何工作

中文入口仅给其启动的 Copilot 子进程设置 WebView2 调试参数。连接前检查：

- EXE 的 Authenticode 签名有效且签名者是 GitHub。
- 调试端口仅监听回环地址。
- 端口所属进程是指定 Copilot 进程的 WebView2 子进程。
- 页面类型、标题、来源以及主界面的根节点/侧栏标记符合预期。

翻译脚本只修改批准范围内的文本节点与固定提示属性，不替换整块 HTML，不调用 Copilot 内部 React 状态或业务 IPC。浏览器侧源码按 model / catalog / classifier / translator / runtime 分层，启动时由 `src/overlay-source.mjs` 在内存中组合成注入脚本，没有生成文件。扫描、诊断、异步结果和节点恢复统一经过同一个 `classifier.resolve()` 归属判定。原文记录在内存中；停止时只恢复仍等于译文的节点，避免覆盖应用后续更新。

人工词典始终优先；批准范围内的未知文案按“机器缓存 → 本地 Edge”处理。可在 `locales/zh-CN.json` 中纠正译文，停用后重开生效。范围之外或翻译失败的未知内容保持英文。

后台 Edge 使用 `.local/edge-translator` 独立配置，可启动预热、默认空闲 180 秒退出；停用汉化也会关闭它。仅开放回环端口并核对进程归属，不开放翻译 HTTP 接口。缓存 `.local/machine-cache.json` 上限 5000 项，按区域、原文、Edge/模型/规则版本区分，不随 Copilot 升级清空。缓存含候选界面原文，已纳入 Git 忽略。

调试端口可控制应用页面，即使仅回环监听，也不能隔离同一台机器上的其他本地进程。Microsoft 不承诺调试 flags 的长期稳定性；本工具不把它们当作官方插件接口。[WebView2 官方说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)

## 维护与验证

```powershell
npm ci
npm test
```

jsdom 仅用于开发测试，不是运行时依赖。测试覆盖范围隔离、输入保护、动态渲染、流式内容排除、停用恢复、重复安装和未知文本回退。

开发诊断工具：

- `tools/smoke.mjs`：在空闲应用中切换设置页，检查异常、观察器空闲行为并保存截图。
- `tools/verify-reload.mjs`：刷新页面验证注入；仅应在无活动任务、无未发送输入时运行。`--english` 验证停用后刷新仍为英文。
- `tools/inspect.mjs`：通过 CDP 求值，供维护者检查 DOM，不是日常使用入口。
- `tools/verify-responsiveness.mjs`：检查启动阶段耗时、引擎耗时和当前页面空闲状态；显式加 `--restart-companion` 时仅重启汉化伴随进程，不结束或刷新 Copilot。
- `tools/verify-theme-menu.mjs`：打开用户菜单及主题子菜单，检查四个固定选项、保留的选中属性，并保存本地截图；不选择主题，不关闭已有对话框。
- `tools/survey-customize.mjs` / `tools/verify-customize.mjs`：搜索为空且没有对话框时切换自定义页七个 TAB，采集结构或验证翻译、名称、输入和开关状态；不安装/启停项目，结束后恢复原 TAB。本机报告在 `.local/`；加 `--screenshots` 可尝试截图，失败会单独记录。
- `tools/verify-policy-live.mjs`：只读检查当前页面版本、就绪状态、两秒观察器采样与运行时异常计数；不切页、不刷新、不读取聊天或输入内容，报告保存到 `.local/policy-verification.json`。
- `tools/discover-untranslated.mjs`：盘点当前可见页面中被分类为 `unclassified` / `text-filter` 的候选，不导航、不点击、不刷新。默认只写结构位置、分类和计数，不记录原文；仅在明确加 `--include-text` 时写入候选文案。报告位于 `.local/untranslated-discovery.json`，分享前需人工检查。
- `tools/verify-settings-navigation.mjs`：设置页保持打开时只读验证八个固定导航项。更新前以 `--baseline` 保存基线，更新后默认模式检查译文及选中状态、项目标签和输入值是否保持不变；项目标签与输入值仅保存哈希。成功后生成 `.local/settings-navigation-verification.json` 和仅含固定导航的截图。
- `tools/probe-copilot-translator.mjs` / `tools/probe-edge-translator.mjs`：对照测试宿主 Translator 能力。独立 Edge 探测前先停用汉化，避免争用配置；支持 `--headless --offline --text "English text"`。详见 `docs/LOCAL-TRANSLATION.md`。
- `tools/inventory.mjs`：停用翻译后，在设置对话框已打开时收集设置页文案，仅保存在 `.local`；可能包含本机名称和路径，不应发布原始文件。

日志、状态和验证产物在 `.local/`，已被 Git 忽略。运行日志不收集聊天或代码正文。提交前不要把 `.local`、本机配置或截图里的个人资料放入版本库。

验证记录见 `VERIFICATION.md`。当前实现架构见 `docs/ARCHITECTURE.md`；翻译边界见 `docs/TRANSLATION-POLICY.md`；研究依据与早期架构取舍见 `RESEARCH.md`；离线翻译方案见 `docs/LOCAL-TRANSLATION.md`。

欢迎提交兼容性问题和改进。开发、测试与隐私注意事项见 `CONTRIBUTING.md`；版本变化见 `CHANGELOG.md`。

## 许可证

本项目采用 MIT License，详见 `LICENSE`。
