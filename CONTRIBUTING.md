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

## 提交前

请确认：

1. `npm test` 全部通过；
2. 新 UI 结构有对应回归测试；
3. 没有把真实账户、项目、本机路径或密钥写进测试夹具；
4. `package.json` 与 `locales/zh-CN.json` 的版本在发布提交中保持一致。
