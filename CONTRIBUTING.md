# Contributing

感谢参与维护。这个项目通过运行时 DOM 覆盖实现中文界面，因此兼容性问题通常来自 GitHub Copilot App 的界面结构变化，而不只是缺少某个词条。

## 开发与测试

需要 Node.js 22+。

```powershell
npm ci
npm test
```

提交翻译相关改动时，请优先扩展“已确认的界面结构”，并添加回归测试；不要用全页面字符串替换来追求覆盖率。项目名、会话名、模型名、输入内容、代码、diff、终端、URL 和其他用户数据应继续保持受保护状态。更完整的边界说明见 `docs/TRANSLATION-POLICY.md`。

## 报告兼容性问题

请尽量提供：

- GitHub Copilot App 版本和 WebView2 版本；
- 出现问题的界面位置；
- 仍显示英文的固定 UI 文案；
- 可复现步骤；
- 如有截图，请先遮盖账户名、项目/仓库名、路径、会话正文、代码、令牌和其他私人信息。

不要上传 `config.json`、`.local/` 中的原始文件、机器翻译缓存或未经检查的诊断输出。`tools/discover-untranslated.mjs --include-text` 会显式包含当前页面可见字符串，分享前必须人工检查。

## 诊断工具

先使用只读工具；报告默认写入被忽略的 `.local/`。没有执行、失败、超时或跳过的检查不能标为通过，也不能根据英文候选数量计算汉化覆盖率。

| 目的 | 工具与操作边界 |
| --- | --- |
| 就绪、异常、空闲观察器 | `node tools/verify-policy-live.mjs`；只读，不切页、不刷新、不读取聊天和草稿。 |
| 启动与引擎耗时 | `node tools/verify-responsiveness.mjs`；默认只读，`--restart-companion` 仅重启汉化伴随进程。 |
| 当前页面漏翻 | `node tools/discover-untranslated.mjs` 或 `node tools/audit-interactions.mjs --current-only`；不导航、不点击，默认只保存元数据。 |
| 设置导航回归 | `tools/verify-settings-navigation.mjs`；先手动打开设置，更新前 `--baseline`、更新后默认模式，只读比较选中状态和受保护值。 |
| 菜单与提示 | `tools/verify-theme-menu.mjs`、`tools/verify-message-tooltips.mjs`；会打开菜单/悬停，不选择菜单值或读取消息正文。 |
| 自定义页七个 TAB | `tools/survey-customize.mjs`、`tools/verify-customize.mjs`；要求搜索为空且无对话框，会切换并恢复原 TAB，不安装/启停项目。 |
| 交互盘点 | `node tools/audit-interactions.mjs --interact`；要求无弹窗/草稿、设置搜索为空，打开导航/菜单及悬停，不修改设置或提交表单；无法关闭自建浮层时停止。 |
| 加载与恢复 | `tools/smoke.mjs` 会切设置页；`tools/verify-reload.mjs` 会刷新页面，仅在确认无任务、无草稿后执行，`--english` 检查停用后的英文。 |
| 翻译后端 | `tools/probe-copilot-translator.mjs`、`tools/probe-edge-translator.mjs`；独立 Edge 探测前先停用汉化，参数见 [本地翻译](docs/LOCAL-TRANSLATION.md)。 |

`tools/inspect.mjs` 可执行 CDP 表达式；`tools/inventory.mjs` 在停用翻译、已打开设置时采集文案。它们不是日常使用入口，输出可能含身份信息。`--include-text` 会额外保存候选原文；截图失败必须单独记录，不视为视觉检查通过。

## 提交与发布

请确认：

1. `npm test` 全部通过；
2. 新 UI 结构有对应回归测试；
3. 没有把真实账户、项目、本机路径或密钥写进测试夹具；
4. `git diff --check` 通过；发布时同步 package、lockfile 和词典版本，按 [发布检查](docs/RELEASE-CHECKLIST.md) 完成 CI、标签和 Release。

AI 辅助维护还应遵守 [AGENTS.md](AGENTS.md)。
