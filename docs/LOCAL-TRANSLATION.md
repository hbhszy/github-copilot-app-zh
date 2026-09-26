# 本机翻译引擎评估

2026-09-26，v0.2.0 已接入。汉化入口使用“人工词典 → 机器缓存 → 独立无窗口 Edge”的顺序，批准范围内的新文案自动离线翻译。正常运行启用页面断网与浏览器外网代理阻断；模型准备单独通过 `npm run setup:translator` 联网完成。没有把应用、聊天或代码内容送到在线翻译服务。

## Windows 与 Edge 的区别

不能假定所有 Windows 电脑都提供一个开箱即用的离线英译中服务。Windows AI 能力按 API、硬件、系统版本和地区有不同限制；Live Translation 的开发 API 在查询时仍列为未支持。Phi Silica 也不是通用免部署翻译服务，不宜作为此工具的基础依赖。

- [Windows AI APIs](https://learn.microsoft.com/en-us/windows/ai/apis/)
- [Phi Silica](https://learn.microsoft.com/en-us/windows/ai/apis/phi-silica)

Edge 的 Translator API 使用本地专用翻译模型，首次使用需要下载语言对模型，之后可以离线运行。浏览器提供 API 不等于每个 WebView2 宿主均可用。

[Translator API 官方文档](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/translator-api)

## 当前 Copilot WebView2 实测

```text
typeof globalThis.Translator = "function"
isSecureContext = true
Translator.availability({ sourceLanguage: "en", targetLanguage: "zh" }) = "unavailable"
Translator.availability({ sourceLanguage: "en", targetLanguage: "zh-Hans" }) = "unavailable"
```

进一步测试 en→zh、zh-Hans、zh-Hant、es、fr、ja、en 全部返回 `unavailable`。在 CDP 明确提供用户激活后，`navigator.userActivation.isActive = true`、`document.featurePolicy.allowsFeature('translator') = true`，但 `create()` 仍抛出 `NotSupportedError: Unable to create translator for the given source and target language.`

这排除了本次调用中“不安全来源、页面权限未开放、缺少用户激活、仅中文不支持”这些简单解释。同一电脑、同一版本 153.0.4234.48 的独立 Edge 可以使用，因此问题集中在 WebView2 宿主环境/组件配置。**尚未确认微软内部的具体拒绝原因，不能宣称所有 WebView2 永久不支持。** 没有修改 Copilot 配置、注册表或启用实验性特性。

可复测：`node tools/probe-copilot-translator.mjs`。需先通过中文入口运行 Copilot；报告保存在 `.local/copilot-translator-report.json`。

## 已打通：用独立 Edge 提供本机翻译

测试使用系统现有 Edge EXE 和项目内独立配置目录，不使用个人 Edge 配置。最初验证目录 `.local/edge-translator-probe` 已迁移为正式目录 `.local/edge-translator`，模型直接复用。测试结束关闭自己启动的浏览器。

| 环境 | 结果 |
| --- | --- |
| Copilot WebView2 153.0.4234.48 | 所测语言对 unavailable；create 失败 |
| 同版本 Edge，默认特性，首次调用 | downloadable；create 下载组件后成功翻译 |
| Edge `--headless=new`，重启后复用组件 | 无窗口运行成功 |
| 无窗口 Edge，测试页模拟断网，外网代理指向关闭端口 | 创建 translator 与翻译均成功，测试外网 fetch 失败 |

离线检查使用 CDP `Network.emulateNetworkConditions(offline: true)`，并以 `--proxy-server=http://127.0.0.1:9 --disable-quic` 启动该隔离 Edge。它是页面断网与浏览器代理阻断测试，**不是整台电脑拔网线测试**。官方文档也明确此 API 的推理在设备上进行，首次下载后支持离线。

实测模型与运行时目录合计 210,280,328 字节，约 200.5 MiB；整个隔离浏览器配置当时约 434.5 MiB，还含缓存及其他自动下载组件。这不是网络下载流量或内存用量。

在本机两轮 9 条样本测试中，重启后的 translator 创建约 2.9–4.1 秒；随后每条翻译约 12–100 毫秒。数据仅代表这组短句，非普遍性能保证。

| 原文 | 实际输出 |
| --- | --- |
| Choose where new sessions start. | 选择新会话的开始位置。 |
| Create a new worktree | 创建新的工作树 |
| Stage all changes | 暂存所有更改 |
| Commit | 提交 |
| Branch | 分公司 |
| Open {count} files | 打开 {count} 文件 |

`Branch` 的误译说明必须保留开发术语覆盖。占位符在该样本中保留，不代表任意占位符都能保留，仍需校验。

### 复现与直接调用

在项目目录运行，每次只运行一个探测实例，并先停用汉化释放翻译配置锁。首次需要联网下载微软组件：

```powershell
npm run setup:translator
```

已下载的本机现在可直接无窗口调用：

```powershell
node tools/probe-edge-translator.mjs --headless --offline --text "New sessions will use the selected workspace."
```

实际输出：`新会话将使用选定的工作空间。`

不带 `--text` 时运行基准样本。结果写入 `.local/edge-translator-report*.json`。`--text` 内容也会进入本地报告；这些文件已经被 Git 忽略。诊断工具与正式后端共用进程管理及配置锁。

新测试页面采用不同 localhost 端口；即使模型已经下载，初始 `availability()` 仍可能显示 `downloadable`，随后 `create()` 直接使用本地组件。不要把该状态简单等同于每次都要重新联网下载。记录创建后的 availability 和实际调用结果更可靠。

### 怎样接到汉化层

现有 Node 启动器管理独立无窗口 Edge，在本地页面调用 Translator，结果经 CDP 通道返回 Node；不对外开放翻译 HTTP 服务。Copilot 侧只负责候选文案选择与可撤销文本更新。

调用顺序是：人工术语/词典 → 已校验的机器缓存 → 独立 Edge Translator → 校验后缓存。引擎不可用或超时则保留原文。模型与缓存独立于 Copilot 安装目录，Copilot 升级无需重新训练或重新下载该模型。

已实现进程与配置目录锁、按需启动/默认空闲 60 秒退出、Edge 签名及连接归属校验、按版本失效的持久缓存、请求去重、失败退避、异步结果核对页面实例/节点原文/当前范围，以及未知文案筛选。模型失败不阻塞 Copilot；人工词典继续工作。

自动范围限制为设置中 general/sessions/themes/accessibility/experimental section 的固定标题、相邻说明、操作标签，以及反馈对话框固定文案。主题卡片、用户与项目名称、代码、聊天、输入值不入队。范围之外通过人工词典适配。

真实界面测试发现主题名可能被误判成按钮文案，已排除主题卡片和选中值，并加入回归测试。另一次测试发现把 `{count}` 和 `30` 都替换为通用标记，会造成模型交换数量和时间的位置。正式规则保留原始占位符、数字和快捷键，并核对输出中的完整集合；开发术语使用单独标记与固定译法，标记丢失即拒绝结果。语义准确性仍不能仅靠格式校验保证。

## 可选自带模型

OPUS-MT 的 `Helsinki-NLP/opus-mt-en-zh` 是专门的英译中模型，Apache-2.0 许可，仓库中单份 PyTorch 权重约 312 MB。仓库总大小含多框架重复权重，不能把整个仓库大小当作最小下载体积。实际部署还需分词器、推理运行时及对应模型格式；量化后的实际体积、内存和延迟需要实测。

- [模型卡](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh)
- [权重文件列表](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh/tree/main)

当前机器的 i9-13900H、40 GB 内存和 RTX 4070 Laptop 具备尝试小型本地翻译模型的条件。这不等于已测得具体性能，也不需要为了少量新界面文案长期占用 GPU。

## 推荐集成方式

1. 人工词典优先，固定 Worktree、Branch、Stage、Commit 等术语和高频按钮。
2. 仅从明确批准的固定 UI 区域提出未知文案候选；无法确认来源的文本不翻译。
3. 按需加载离线模型，在后台翻译新文案；生成过程中先保留英文，不阻塞界面。
4. 校验占位符、快捷键、路径、数字及长度，拒绝额外解释或异常输出。
5. 候选译文与人工词典分开缓存，缓存键包含区域、原文、语言、模型和术语表版本。允许人工纠正并优先覆盖机器结果。
6. 空闲后卸载模型。关闭此模块时只退回本地词典，不影响应用启动。

它可以降低“补译新文案”的工作量，但不能消除“识别哪些节点是界面”的维护，也不能保证短词和专业术语翻译准确。将整页交给模型自动翻译与当前低侵入目标不符。

最接近“万能方案”的是统一翻译后端与缓存；在当前机器上可优先用已验证的 Edge 后端，未来必要时增加自带模型后端。翻译引擎可以跨应用复用，哪些内容属于界面的规则仍需按应用适配。这能减少逐版本补译文案，不能保证任意桌面应用零适配、零误译。
