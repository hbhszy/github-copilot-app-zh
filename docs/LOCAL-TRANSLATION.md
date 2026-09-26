# 本地翻译引擎

当前实现按“人工词典 → 已校验缓存 → 独立无窗口 Edge”处理已确认的 UI 文案。安装入口 `install.cmd` 默认联网准备缺失组件；日常运行启用页面断网和浏览器外网代理阻断，不使用在线翻译服务。内容边界以 [翻译规则](TRANSLATION-POLICY.md) 为准。

## 为什么使用独立 Edge

2026-09-26 在 Copilot 1.1.23 / WebView2 153.0.4234.48 上，Translator 对所测语言对返回 `unavailable`，提供用户激活后 `create()` 仍失败；同机同版本独立 Edge 下载组件后可用。具体宿主限制尚未查明，不能据此断言所有 WebView2 永久不支持。[Translator API 官方文档](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/translator-api)

后端使用系统 Edge 和 `.local/edge-translator` 独立配置，不读取个人浏览器配置。已记录的本机结果如下，不是新电脑兼容保证：

| 环境 | 结果 |
| --- | --- |
| Copilot WebView2 153.0.4234.48 | 所测语言对 unavailable；create 失败 |
| 同版本 Edge，默认特性，首次调用 | downloadable；create 下载组件后成功翻译 |
| Edge `--headless=new`，重启后复用组件 | 无窗口运行成功 |
| 无窗口 Edge，测试页模拟断网，外网代理指向关闭端口 | 创建 translator 与翻译均成功，测试外网 fetch 失败 |

离线检查使用 CDP `Network.emulateNetworkConditions(offline: true)`，并以 `--proxy-server=http://127.0.0.1:9 --disable-quic` 启动该隔离 Edge。它是页面断网与浏览器代理阻断测试，**不是整台电脑拔网线测试**。官方文档也明确此 API 的推理在设备上进行，首次下载后支持离线。

## 准备与诊断

正常安装无需单独执行下列命令。维护或复测时先停用汉化，每次只运行一个 Edge 探测实例，避免争用同一配置锁：

```powershell
npm run setup:translator # 联网检查/更新组件；install.cmd 默认仅补充缺失组件
node tools/probe-edge-translator.mjs --headless --offline --text "New sessions will use the selected workspace."
```

不带 `--text` 时运行基准样本；文本也会写入本地报告，勿输入私人内容。检查 Copilot 宿主能力可在中文入口运行期间执行 `node tools/probe-copilot-translator.mjs`。报告均写入 `.local/`，不得直接发布。

新测试页面采用不同 localhost 端口；即使模型已经下载，初始 `availability()` 仍可能显示 `downloadable`，随后 `create()` 直接使用本地组件。不要把该状态简单等同于每次都要重新联网下载。记录创建后的 availability 和实际调用结果更可靠。

## 生命周期、缓存与失败处理

现有 Node 启动器管理独立无窗口 Edge，在本地页面调用 Translator，结果经 CDP 通道返回 Node；不对外开放翻译 HTTP 服务。Copilot 侧只负责候选文案选择与可撤销文本更新。

启动器默认并行预热，空闲 **180 秒**后退出引擎；`idleSeconds` 可设为 30–600，`warmup: false` 改为按需启动，`enabled: false` 仅用人工词典。配置变更后停用并重开中文入口。固定词典和缓存命中不等待预热；停用汉化会关闭独立 Edge。

`.local/machine-cache.json` 最多 5000 项，按区域、原文及 Edge/模型/规则版本区分；不因 Copilot 版本号改变而清空。重复请求合并，失败退避，模型不可用时保留英文而非阻塞应用。进程管理核验 Microsoft 签名、回环监听、独立配置与所属进程，只清理本工具创建的 Edge。

`--status` 的 `timings` 记录应用校验、端点和汉化就绪耗时；`machineTranslation` 提供初始化、预热、引擎和末次翻译耗时。性能因硬件、组件和文本而异，不将少量短句测试当作普遍保证。

开发术语优先用词典纠正；数字、占位符、快捷键及代码字面量需校验，不能都遮蔽成可互换的通用标记。格式校验仍不能证明语义正确。当前未集成自带模型后端，也不承诺其他应用零适配。
