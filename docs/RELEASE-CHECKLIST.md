# 发布检查

用于公开发布前的最小检查。项目的运行时兼容性仍以 README 中明确写出的 GitHub Copilot / WebView2 版本为准。

- [ ] 查看工作区、远端主分支和现有 Release；确认待发布改动，不覆盖无关修改或已有标签。
- [ ] 同步 `package.json`、`package-lock.json`（顶层及根 package）和 `locales/zh-CN.json` 的版本，更新 CHANGELOG。
- [ ] `npm ci` 成功。
- [ ] `npm test` 全部通过。
- [ ] 在 README 声明的版本上验证入口和汉化就绪。已有应用正在运行时只重启伴随进程并确认原版 PID 不变，不强退或刷新用户应用；完整冷启动、模型首下载未测时明确记录。
- [ ] 检查 `git status --ignored`，确认 `config.json`、`.local/`、`node_modules/` 和日志未进入版本控制。
- [ ] 搜索并移除真实账户名、项目名、本机路径、令牌、密钥与私有 URL。
- [ ] 确认安装、停用和卸载路径均不会修改原版 Copilot EXE 或安装目录。
- [ ] `git diff --check` 通过，文档链接有效；安装/卸载测试仅使用临时目录，不实际卸载用户环境。
- [ ] 逐项暂存并检查提交，推送 `main`；确认**该提交**的 Windows / Node.js 22 CI 成功后再创建标签。
- [ ] 创建并推送唯一的注释标签，发布非草稿 GitHub Release；核验标签指向、发布状态和主分支同步情况。

## 操作顺序

以下 `X.Y.Z` 须替换为本次版本。`release-notes.md` 指预先写入被忽略的 `.local/` 中、经隐私审查的发布说明。

```powershell
git push origin main
gh run list --workflow ci.yml --commit <commit-sha>
gh run watch <run-id> --exit-status
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file .local/release-notes.md
gh release view vX.Y.Z
git status --short --branch
```

沿用源码发布，用户下载 Release 自动提供的源码包后双击 `install.cmd`。不上传整个工作目录、`.local/`、配置、模型、截图或诊断原始输出；不把既有机器的模型复用表述为全新电脑联网首装成功。发布说明包含安装/升级步骤、测试结果、兼容版本和未验证边界。CI 或发布失败时报告实际进度，不伪称已完成。
