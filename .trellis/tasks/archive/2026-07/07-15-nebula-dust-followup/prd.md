# PRD：补齐「星云尘埃 / Nebula Dust」主题

## 背景

提交 `f84b8c1` 已完成主题注册、国际化、设置入口和基础样式，但实现只将 `ui/ui-nebula-dust/styles/` 的旧原型 CSS 直接作用域化，并使用了 Mossline 的大体量 `app-overrides.css`。

用户指出应对照提交 `afef4487`（新增墨纸界面主题）。该提交展示了同一代静态原型正确接入真实 React 应用的完整映射方式。

## 已确认缺口

- 当前 Nebula 主题目录覆盖 352 个 CSS 类，完整 Inkpaper 主题覆盖 377 个。
- 当前实现缺少设置页真实布局骨架：`settings-page`、`settings-nav-panel`、`settings-nav-search`、`settings-content-panel`、`settings-section`、`settings-row__*` 等。
- 当前实现缺少 SFTP 实际功能样式，包括 mkdir editor、path tools、transfer drawer 等完整状态。
- 当前实现缺少终端选区操作层 `terminal-selection-actions`。
- 当前实现缺少 Monitor 会话选择和分段控件适配类。
- `afef4487` 的正确结构是：完整映射后的 base/components/layout/pages 文件 + 较小的主题应用覆盖层，而不是旧原型直出 + 整份 Mossline 覆盖层。

## 目标

以 `afef4487` 中 `app/src/styles/inkpaper/` 的成品文件为结构权威，重建 `app/src/styles/nebula-dust/` 非 token 样式文件：

- 保留 Nebula Dust 的主题 ID、暗亮 tokens 和深空黑紫/粉橙/雾紫配色。
- 补齐真实 React DOM、交互状态和当前页面功能所需的全部样式映射。
- 将 `app-overrides.css` 调整为 `afef4487` 同等职责和规模，避免与页面文件重复覆盖。
- 不改变已经正确的主题注册、i18n、设置卡片和入口。

## 验收标准

- Nebula 与 Inkpaper 成品结构的类覆盖差异只剩主题本身有意不同的视觉类。
- 设置页导航、搜索、内容面板、Section、SettingRow 和状态展示完整。
- SFTP 文件面板、建目录编辑器、路径工具、传输抽屉完整。
- Terminal 选区操作层和真实分屏适配完整。
- Monitor 会话选择控件具有主题样式。
- 暗色、亮色 tokens 保持 Nebula Dust 配色。
- TypeScript、Vite 构建和现有测试通过。

## 非目标

- 不新增设计稿中的业务功能。
- 不更改其他主题。
- 不更改主题持久化协议。
