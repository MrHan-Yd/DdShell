# PRD：新增「橘子海 / Orange Tide」主题

## 背景

设计稿位于 `ui/ui-orange-sea/`，包含完整 HTML/CSS 原型和暗亮双模式 tokens。主题以深海蓝、海面青和暖白承载大面积界面，以日落橘和浅金反光作为重点。

## 目标

- 主题 ID：`orange-sea`
- 中文名：`橘子海`
- 英文名：`Orange Tide`
- 支持暗色、亮色和跟随系统
- 按提交 `afef4487` 的完整主题接入方式落地

## 接入要求

修改与现有主题一致的 5 个接入文件：

1. `app/src/stores/app.ts`
2. `app/src/lib/i18n.ts`
3. `app/src/features/settings/SettingsPage.tsx`
4. `app/src/styles.css`
5. `app/src/main.tsx`

新增：

```text
app/src/styles/orange-sea-index.css
app/src/styles/orange-sea/
├── tokens.css
├── base.css
├── components.css
├── layout.css
├── pages/settings.css
├── pages/connections.css
├── pages/terminal.css
├── pages/sftp.css
└── app-overrides.css
```

## 样式要求

- 使用 Inkpaper/`afef4487` 成品作为真实 React DOM 的结构模板。
- 使用 `ui/ui-orange-sea/styles/tokens.css` 作为配色来源。
- 完整覆盖设置页骨架、SFTP 路径工具与传输状态、Terminal 分屏/选区、Monitor 会话选择。
- 所有主题专属规则使用 `[data-ui-theme="orange-sea"]`。
- 保留模板中有意共享的设置页布局规则。
- 不污染或改变其他主题。

## 验收标准

- 设置页出现“橘子海 / Orange Tide”主题和正确预览。
- 主题可保存、恢复并在 Quick Edit 等窗口通用加载。
- 暗色、亮色和跟随系统正常。
- Orange Sea 与结构模板的完整类集合一致。
- 关键类包括 settings、SFTP path tools/transfer drawer、Terminal selection/split、Monitor session picker。
- 生产构建、现有测试和 CSS 残留检查通过。

## 非目标

- 不新增设计稿中的业务功能。
- 不单独移植 Monitor、Snippets、Workflows、Quick Edit 页面原型文件；这些页面使用完整基础组件和真实应用映射获得主题覆盖。
- 不修改 Logo 资源或品牌逻辑。
