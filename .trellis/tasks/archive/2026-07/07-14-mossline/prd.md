# PRD：新增「竹影 / Mossline」主题

## 背景

设计稿位于 `ui/ui-mossline/`（DESIGN.md + 完整 HTML/CSS 原型）。主题定位：深墨绿底色 + 竹叶绿交互色的自然绿色系工具主题，补足现有主题中缺少的绿色系。支持暗色（默认）与亮色双模式（设计稿 tokens.css 已含 `.theme-light`）。

## 目标

将设计稿落地为应用内可选主题 `mossline`，接入方式完全对齐上一个主题「珊光 (lumenreef)」（commit `7b940d8`）。

## 改动清单

### 接入层（改 5 个已有文件）

1. `app/src/stores/app.ts` — `UI_THEMES` 加 `"mossline"`；`usesDesignSystemTheme()` 加判断
2. `app/src/lib/i18n.ts` — 加 `settings.uiThemeMossline`（zh: 竹影 / en: Mossline）与 `settings.uiThemeMosslineDesc`（中英描述，参考 DESIGN.md 色彩结构）
3. `app/src/features/settings/SettingsPage.tsx` — `currentUiThemeLabel` 三元链加一层；主题选项数组加一项（previewClassName: `theme-preview theme-preview--mossline`）
4. `app/src/styles.css` — 加 `.theme-preview--mossline` 及 `__sidebar` / `__panel` 预览样式（深墨绿底 + 竹叶绿高光）
5. `app/src/main.tsx` — `import "./styles/mossline-index.css"`

### 样式层（新建文件，基于设计稿 CSS 移植）

```
app/src/styles/mossline-index.css
app/src/styles/mossline/
├── tokens.css            ← 移植 ui/ui-mossline/styles/tokens.css（暗+亮双模式）
├── base.css
├── components.css
├── layout.css
├── pages/settings.css
├── pages/connections.css
├── pages/terminal.css
├── pages/sftp.css
└── app-overrides.css     ← 参考 lumenreef/app-overrides.css 的覆盖点，换成竹影配色
```

移植方法：以 lumenreef 同名文件为结构模板（选择器作用域 `body.ui-theme-mossline` 之类，与 lumenreef 的作用域方式保持一致），配色/材质取自设计稿 tokens 与页面 CSS。

## 验收标准

- 设置页主题列表出现「竹影」，预览卡片呈现深墨绿 + 竹叶绿风格
- 切换后连接、终端、SFTP、设置四个页面均正确套用竹影皮肤，暗/亮模式都正常
- 其他主题不受影响（diff 限于上述文件）
- `npm run build`（或项目 lint/type-check）通过

## 非目标

- 不移植设计稿中的 monitor / snippets / workflows / quick-edit 页面样式（应用当前主题体系只覆盖 settings/connections/terminal/sftp 四页，与 lumenreef 一致）
- 不改 Logo / 品牌资源
