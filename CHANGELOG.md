# Changelog

## 0.4.5 - 2026-09-26

- 修复项目侧栏操作的短悬浮提示：`New session` 与 `Create from...` 现在会跟随固定操作翻译。
- 补齐 `Create project from pull requests, branches, or issues in <repo>` 的动态 aria-label，只翻译固定外壳并保留仓库名。
- 对这组 tooltip 使用明确的 `data-testid` 归属，不依赖 Base UI 是否在触发器上暴露 `data-popup-open`。
- 新增回归测试，确保仓库身份与未知项目说明不会被翻译。

## 0.4.4 - 2026-09-26

首个公开发布版本。

- 扩展新版 Base UI roleless tooltip 的归属识别，覆盖消息操作等悬浮提示。
- 增加模型推理强度菜单与动态模型 aria-label 的固定外壳翻译，同时保护模型身份。
- 为受保护的 Lexical 聊天编辑器增加安全的 placeholder 翻译，仅处理固定 UI，不扫描草稿正文。
- 增加 GitHub Actions Windows / Node.js 22 CI、MIT License、发布检查清单与公开仓库匿名化处理。
- 发布候选回归测试：86/86 通过。

更早的实现与实机验证记录见 `VERIFICATION.md`。
