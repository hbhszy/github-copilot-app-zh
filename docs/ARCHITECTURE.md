# 汉化层架构

从 v0.4.0 起，浏览器侧汉化层不再维护一个巨大的 `src/overlay.js`。源码按职责拆分为可独立阅读和测试的模块，启动时在内存中组合成一段注入脚本；不会生成或修改 Copilot 安装目录中的前端文件。

## 数据流

```text
Copilot DOM mutation
        │
        ▼
runtime.mjs ── 批处理 / 增量扫描 / 恢复
        │
        ▼
classifier.mjs ── 唯一的 DOM 归属判定入口 resolve()
        │
        ├── protected / data ── 保留原文
        │
        └── UI
             │
             ├── translator.mjs ── 人工词典 / 动态模板
             │
             └── machine context ── 本地缓存 / Edge 离线翻译
                                      │
                                      ▼
                               返回前再次 resolve()
```

目录职责：

- `src/overlay/model.mjs`：共享状态、词典视图、保护 selector、原文记录和统计；不做具体页面判断。
- `src/overlay/catalog.mjs`：自定义/目录页的字段级分类，单独隔离名称、描述、徽章和操作。
- `src/overlay/classifier.mjs`：设置、菜单、弹窗、快捷键浏览器、命令面板、提示和通用控件的结构识别；所有调用方最终都经过 `resolve(element, field)`。
- `src/overlay/translator.mjs`：确定性的词典和模板翻译、写入记录与安全恢复；不负责异步机器队列。
- `src/overlay/runtime.mjs`：MutationObserver、扫描调度、机器翻译队列、过期/重试、公共 `window.__copilotChinese` API。
- `src/overlay-source.mjs`：把上述自包含工厂函数序列化为浏览器脚本。无需 bundler，也没有需要提交的生成文件。

## 核心不变量

### 一个归属判定入口

扫描、`explain()`、异步翻译返回、React 节点复用后的恢复都调用同一个 `classifier.resolve()`。不再维护一套“词典范围”和另一套“机器翻译范围”而让二者逐渐分叉。

解析结果先区分 **protected / data / UI**。只有 UI 才能继续走词典或机器翻译。即使字符串恰好命中词典，只要当前位置属于项目名、模型名、会话正文等数据区域，也不会翻译。

### 原文是记录，不是重新猜测

汉化写入时记录 `{ original, translated, context, dict }`。宿主重新渲染、节点换用途或移动到保护区时，只在当前显示值仍等于本工具写入值时恢复 `original`，避免覆盖 Copilot 后来的更新。

### 异步结果落地前重新分类

机器请求保存当时的原文和 context。回复到达后重新检查：节点仍连接、原文未变、`resolve()` 仍给出相同 context、人工词典没有新增覆盖、机器结果通过字面量/数字/占位符校验。任一条件变化即丢弃结果。

## 如何扩展

优先级从高到低：

1. **已有界面族**：扩展该族的结构判断，不加页面坐标或生成类名。
2. **新界面族**：在 classifier 中增加一个可证明 UI 归属的结构规则，并同时给出数据排除规则。
3. **动态模板**：`Edit <name>`、`New session in <project>` 等只翻译固定外壳，不把 `<name>` 交给引擎。
4. **词典**：用于稳定术语、常见短标签和语义纠正；不应成为覆盖率白名单。

每次新增范围至少需要回归：未知新文案能自动进入队列；同名用户/项目/模型数据不变；节点换用途后会恢复；迟到回复不能落地；停用后原文可恢复。

## 诊断与遗漏发现

`window.__copilotChinese.explain(element, field)` 返回分类路径和 context，不返回页面正文。`tools/discover-untranslated.mjs` 基于同一个 API 盘点当前可见页的未分类候选，默认只写结构元数据。只有显式 `--include-text` 才保存候选原文到 `.local`。

这使“找漏翻”与“实际翻译”共用一套归属逻辑：发现工具不会靠另一份 selector 清单得出与运行时不同的结论。
