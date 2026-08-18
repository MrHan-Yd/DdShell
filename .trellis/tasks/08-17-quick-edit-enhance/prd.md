# 文件管理快速编辑优化：可编辑类型过滤 + 语法高亮

## Goal

优化 SFTP 文件管理的快速编辑体验：
1. 右键菜单"快速编辑"只对可编辑的文本类文件出现（当前所有文件都显示）
2. 编辑器加语法高亮（当前纯白文字，无 token 着色），达到类 IDE 的阅读体验

## What I already know

- 快速编辑器：`app/src/features/sftp/components/QuickEditor.tsx`（CodeMirror 6）
- 语言解析器已配置 17 种（`resolveLanguage()` L415-462：JSON/YAML/MD/TOML/Dockerfile/ENV/Nginx/systemd/Shell/JS-TS/CSS/XML-HTML/Python/Rust/SQL/Config），JSON/YAML/MD 用现代 lang 包，其余用 legacy-modes StreamLanguage
- **高亮缺失根因**：extensions（L674+）没有 `syntaxHighlighting(HighlightStyle)`，解析产生的语法树没有颜色映射 → 全白
- 也没有 `bracketMatching()`，无括号配对高亮
- **右键过滤根因**：`SftpPage.tsx` L1068-1076 只判断 `fileType === "file"` 即显示"快速编辑"；已有 `isLikelyQuickEditFile()`（L123-134，扩展名白名单 + ≤1MB）但右键菜单没用它
- 行为不一致：`TerminalFileManagerDrawer.tsx` L767-768 用了 `disabled: !isLikelyQuickEditFile(entry)`（置灰不隐藏）
- 代码重复：`QUICK_EDIT_TEXT_EXTENSIONS`/`QUICK_EDIT_TEXT_FILENAMES`/`isLikelyQuickEditFile` 在 SftpPage.tsx 和 TerminalFileManagerDrawer.tsx 各有一份
- 编辑器主题：背景 transparent，颜色走 CSS 变量（`--color-text-primary` 等）；项目有 15 套 ui 主题，最近刚做过"主题 CSS layer 化"迁移
- 依赖已齐：`@codemirror/language` ^6.12.3（含 syntaxHighlighting/HighlightStyle/bracketMatching），无需新增依赖
- 双入口窗口：`QuickEditTabContent.tsx`（独立编辑窗口）与 SFTP 页内都用同一个 QuickEditor 组件 → 高亮改一处全生效

## Decision (ADR-lite)

**Context**: 三个 UX/视觉决策需用户（UI 设计师）拍板。
**Decision**:
1. 不可编辑文件右键菜单**直接隐藏**"快速编辑"（两入口统一为隐藏，终端抽屉从置灰改为隐藏）
2. 高亮配色用 **CSS 变量跟随主题**：新增 `--color-syntax-*` 变量组，亮/暗各一套默认值，主题可覆盖
3. 括号做**彩虹括号（按嵌套深度循环着色）+ 配对高亮**，自写轻量插件 + 官方 bracketMatching

**Consequences**: 语法色板成为主题体系一部分，15 套主题初期共用亮/暗默认值，后续可逐主题微调；彩虹括号插件需自行维护。

**补充决策（check 阶段发现后用户拍板）**：配对不上的括号**不做常驻标红**，仅光标停靠时由 bracketMatching 红底提示。原因：shell `case x)` 单边括号是合法语法，常驻标红对 SSH 工具的高频场景（编辑 .sh/.bashrc）是大面积误报。按语言白名单启用常驻标红列为可选后续项。

## Requirements

- 右键菜单"快速编辑"按 `isLikelyQuickEditFile` 过滤，不满足则隐藏（SftpPage + TerminalFileManagerDrawer 统一）
- `isLikelyQuickEditFile` 及白名单常量去重（两文件各一份 → 提取共享）
- QuickEditor 增加 syntaxHighlighting：关键字/字符串/注释/类型/变量名/数字/属性名等分色，颜色取 `--color-syntax-*` CSS 变量
- 亮/暗模式各一套语法色默认值（`[data-theme="light"]` / `[data-theme="dark"]` 层）
- 彩虹括号：`()` `[]` `{}` 按深度循环着色（3-4 色循环）
- bracketMatching 配对高亮

## Acceptance Criteria

- [ ] 图片/压缩包/超 1MB 文件右键菜单不出现"快速编辑"
- [ ] `.js`/`.json`/`.md`/`.sh` 等白名单文件右键有"快速编辑"
- [ ] 打开 JSON/Shell/Python 等文件，关键字/字符串/注释/数字有区分色
- [ ] 嵌套括号按深度着色，光标停在括号处有配对高亮
- [ ] 亮暗模式下高亮均可读
- [ ] SFTP 页与独立编辑窗口两个入口效果一致

## Definition of Done

- Lint / typecheck 通过
- 双入口（SFTP 页、独立编辑窗口）手动验证
- 多主题下高亮可读性验证（至少亮/暗代表主题各一）

## Technical Approach

1. **共享判定**：`isLikelyQuickEditFile` + 白名单常量提取到 `features/quick-edit/utils.ts`（QUICK_EDIT_MAX_BYTES 已在此），SftpPage / TerminalFileManagerDrawer 改为引用
2. **菜单过滤**：SftpPage L1068 条件从 `fileType === "file"` 改为 `isLikelyQuickEditFile(entry)`；TerminalFileManagerDrawer L767 从 `disabled` 改为条件渲染
3. **语法高亮**：QuickEditor 加 `syntaxHighlighting(HighlightStyle.define([...]))`，tag 颜色引用 `var(--color-syntax-*)`；app.css 在 `[data-theme]` 层加亮暗两套默认值
4. **括号**：`bracketMatching()` + 自写 rainbow bracket ViewPlugin（扫可视区域括号深度，装饰着色，颜色用 `--color-syntax-bracket-1..N`）

## Implementation Plan

- Step 1: 提取共享 `isLikelyQuickEditFile` → 两入口菜单过滤统一（可独立验证）
- Step 2: HighlightStyle + CSS 变量 + 亮暗默认色板 → token 着色生效
- Step 3: bracketMatching + 彩虹括号插件
- Step 4: 双入口 + 亮暗主题手动验证

## Out of Scope (explicit)

- 不新增语言解析器（沿用现有 17 种）
- 不做编辑器功能扩展（补全、折叠、minimap 等）

## Technical Notes

- `QuickEditor.tsx` L130-: `quickEditorTheme = EditorView.theme({...})` 现有主题定义处
- legacy StreamLanguage 同样支持 highlight tags（stream token 名映射到 @lezer/highlight tags），加 HighlightStyle 后全部语言可着色
- `RemoteFilePicker.tsx` 是快速编辑窗口内的文件选择器，选文件时已用 recents 逻辑，无右键菜单问题
