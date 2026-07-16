# 主题接入研究

## 结构基线

提交 `afef4487` 新增墨纸时修改了主题注册、设置页、i18n、入口导入、预览样式，并新增完整的主题 CSS 目录。提交 `e48adba` 的月蚀主题沿用同一结构，当前可作为最新完整模板。

完整文件集：

- `<theme>-index.css`
- `<theme>/tokens.css`
- `<theme>/base.css`
- `<theme>/components.css`
- `<theme>/layout.css`
- `<theme>/pages/settings.css`
- `<theme>/pages/connections.css`
- `<theme>/pages/terminal.css`
- `<theme>/pages/sftp.css`
- `<theme>/app-overrides.css`

## 应用注册点

- `app/src/stores/app.ts`：`UI_THEMES` 与 `isSpecialUiTheme`。
- `app/src/main.tsx`：主题 CSS 入口导入。
- `app/src/lib/i18n.ts`：名称和描述。
- `app/src/features/settings/SettingsPage.tsx`：当前主题名称与主题卡片。
- `app/src/styles.css`：主题预览卡片。

## 视觉来源

`ui/ui-celadon/DESIGN.md` 与 `styles/tokens.css` 已确认名称、色板、双模式和材质原则。静态目录还提供 settings、connections、terminal、sftp 等页面级 CSS，可用于校准真实页面的视觉语义。
