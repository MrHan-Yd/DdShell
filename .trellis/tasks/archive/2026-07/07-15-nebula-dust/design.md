# 技术设计：Nebula Dust 主题接入

## 接入方式

以提交 `707e88bb` 中 Mossline 的成品结构为模板，仅替换主题 ID、文案、预览配色和主题 CSS 内容。

应用通过 Zustand 保存 `UiTheme`，并由 `App.tsx` 将值写入 `data-ui-theme`。因此本次只需注册 `nebula-dust`，无需新增运行时主题逻辑。

## CSS 架构

原型来源：`ui/ui-nebula-dust/styles/`。

应用目标：`app/src/styles/nebula-dust/`。

转换规则：

- 普通选择器增加 `[data-ui-theme="nebula-dust"]` 作用域。
- 暗色根令牌映射到主题作用域和 `body.theme-dark` 兼容作用域。
- 亮色根令牌映射到 `[data-theme="light"][data-ui-theme="nebula-dust"]` 及 body 类兼容作用域。
- `@keyframes` 保持原样；`@media` 内部选择器继续作用域化。
- 在 tokens 中添加现有 React/Tailwind token 桥接变量。
- `app-overrides.css` 复用 Mossline 的组件覆盖范围，并将色彩材质调整为 Nebula Dust。

## 兼容性

- 终端在亮色主题下继续使用设计稿提供的深色终端 token。
- 所有新增样式均以主题属性作用域隔离。
- 主题 ID 使用 `nebula-dust`，名称使用“星云尘埃 / Nebula Dust”。

## 回滚边界

接入层集中在 5 个现有文件；主题视觉集中在新增的 `nebula-dust-index.css` 和 `nebula-dust/` 目录，可独立撤回，不改变数据结构。
