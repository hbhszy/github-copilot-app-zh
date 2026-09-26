# Release checklist

用于公开发布前的最小检查。项目的运行时兼容性仍以 README 中明确写出的 GitHub Copilot / WebView2 版本为准。

- [ ] `package.json` 与 `locales/zh-CN.json` 的版本一致。
- [ ] `npm ci` 成功。
- [ ] `npm test` 全部通过。
- [ ] 在 README 声明的受支持 Copilot 版本上完成一次实际启动验证。
- [ ] 检查 `git status --ignored`，确认 `config.json`、`.local/`、`node_modules/` 和日志未进入版本控制。
- [ ] 搜索并移除真实账户名、项目名、本机路径、令牌、密钥与私有 URL。
- [ ] 确认安装、停用和卸载路径均不会修改原版 Copilot EXE 或安装目录。
- [ ] 创建版本标签前再次运行 CI，并检查 README 的安装说明与已知限制。
