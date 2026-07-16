# 青瓷主题技术设计

## 架构与边界

主题继续使用现有数据流：`UITheme` 联合类型负责合法值，设置页编辑 `uiTheme` 草稿并持久化到 `ui.theme`，应用根节点通过 `data-ui-theme` 激活对应 CSS。颜色模式继续由现有 `theme` 状态解析为 dark/light/system。

青瓷样式放在 `app/src/styles/celadon/`，由 `app/src/styles/celadon-index.css` 聚合，再从 `app/src/main.tsx` 导入。所有规则以 `[data-ui-theme="celadon"]` 为作用域。

## 视觉映射

- `ui/ui-celadon/styles/tokens.css` 提供双模式颜色、状态色、终端 ANSI、阴影和尺寸令牌。
- 原型的 base/components/layout 映射到应用对应文件，使用现有完整主题的选择器集合兼容真实 React DOM。
- settings/connections/terminal/sftp 页面文件以现有完整主题的应用选择器为骨架，使用青瓷令牌和装饰语义。
- app overrides 处理原型类名与应用实际组件类名的差异。
- 应用背景仅使用稀疏开片线、釉面高光和低对比渐层；浅色比暗色更明显，但不覆盖内容面板。

## 兼容性

- 不更改存储键与设置 API。
- 新值加入 `UI_THEMES` 和校验函数，旧配置完全兼容。
- 终端在浅色青瓷下仍使用窑夜深色终端底，符合原型设计并保持 ANSI 对比度。

## 风险与控制

- 风险：从旧主题复制页面 CSS时遗留旧主题选择器或专属配色。控制：全文搜索旧主题名、十六进制残留，并做选择器集合比对。
- 风险：仅静态 HTML 好看，真实应用状态遗漏。控制：以 `umbra` 的完整文件集和关键页面选择器为基线。
- 风险：全局 CSS 污染其他主题。控制：检查每个顶层选择器均受 celadon 作用域限制。

## 回滚

改动集中在新增 CSS 目录与四个注册/设置文件中，可按文件撤回；不涉及数据迁移。
