# 双主题（Classic / Aurora）+ ui 布局迁移 M1：settings + 样本页

## Goal

建立 DdShell 的统一布局基线（按 `ui/` 设计稿）+ **Classic / Aurora 两套主题** × **Dark / Light / System 三种色调** 的正交切换体系。本期（M1）只在 `settings` 页 + 1–2 个样本页验证机制可行，机制 OK 后 M2 再扩到剩余页面。

## Background

- 现有 store 已支持 `uiTheme: "classic" | "aurora"` 与 `theme: "dark" | "light" | "system"`，并通过 `api.settingGet/settingSet` 持久化到后端。
- `SettingsPage.tsx` 已有主题切换 UI（line 525-869，含 theme-option-card 预览）。
- `app/src/styles.css`（2518 行）是当前 classic 主题的视觉来源，已包含 `[data-ui-theme="aurora"]` 选择器对部分组件做覆盖（line 1354+），但是**零散的局部覆盖**，不成体系。
- `ui/` 目录下已经有完整的 Aurora 视觉系统：`tokens.css`（紫青双色调） + `base/components/layout.css` + 8 页 HTML 设计稿。
- 当前 React 页面布局**不是按 `ui/` 设计稿走**，需要重做布局结构后两套主题才有统一的载体。

## Requirements

### 范围（M1）
- **样式系统**：把 `ui/styles/{tokens, base, components, layout}.css` 引入 `app/`，作为 Aurora 主题完整源；保留 `app/src/styles.css` 作为 Classic 主题源；通过 `[data-ui-theme]` 顶层选择器隔离作用域。
- **布局迁移**（按 `ui/` 设计稿重做）：
  1. `settings` 页（参考 `ui/settings.html` + `ui/styles/pages/settings.css`）
  2. 样本页 ×2：**connections**（参考 `ui/connections.html`）+ **terminal**（参考 `ui/terminal.html`）
- **通用框架**：Titlebar / Sidebar / StatusBar 三个布局壳按 `ui/styles/layout.css` 重做，作为所有页面共享的外框。
- **Logo**：Classic 用现役 `app/public/logo.svg`（v1）、Aurora 用 `ui/assets/logo-v2*.svg`（已提案产物）。需要把 v2 svg 复制到 `app/public/` 命名为 `logo-aurora.svg` / `logo-aurora-dark.svg`，并改 `Logo.tsx` 按 `uiTheme` 选择源。
- **主题切换 UI**：已存在于 `SettingsPage.tsx`，本期**不重做**，只确认 4 种组合（classic/aurora × dark/light）切换正确生效。

### 主题机制
- **顶层挂载**：`<html data-ui-theme="classic|aurora">` + `<body class="theme-dark|theme-light">`（沿用 `ui/` 已建立的 body class 方案）。
- **System 色调**：监听 `prefers-color-scheme`，映射到 `theme-dark/theme-light`（`Logo.tsx` 已有同款逻辑可参考）。
- **样式作用域**：
  - Classic 样式（styles.css）默认生效，无 `[data-ui-theme]` 前缀。
  - Aurora 样式（aurora 目录）所有 token + 组件全部包在 `[data-ui-theme="aurora"]` 选择器下。
  - 切换时 React 改 `<html>` 的 `data-ui-theme` 属性，CSS 立即响应。

### 视觉验收
- 4 种组合：`classic × dark`、`classic × light`、`aurora × dark`、`aurora × light` 在已迁移的 3 个页面（settings / connections / terminal）都能正确呈现。
- 切换主题或色调无闪烁、无错位。
- 未迁移的 5 个页面（sftp / monitor / snippets / workflows / quick-edit）在 Aurora 下 fallback 到现有局部覆盖的样式即可，不要求完美——M2 再做。

## Acceptance Criteria

- [ ] `app/src/styles/aurora/` 目录建立，包含 `tokens.css / base.css / components.css / layout.css` 四个文件，所有规则前缀 `[data-ui-theme="aurora"]`。
- [ ] `app/src/main.tsx` 或入口 CSS 同时引入 classic（styles.css）和 aurora（新目录）两套，CSS 顺序正确（aurora 在后以便覆盖默认）。
- [ ] 顶层 `<html>` 元素根据 store 的 `uiTheme` 设置 `data-ui-theme` 属性；`<body>` 根据 `theme` 设置 `theme-dark/theme-light` class。
- [ ] `Titlebar / Sidebar / StatusBar` 三个组件结构 + class 名按 `ui/styles/layout.css` 重做（Classic 主题下样式回退到 styles.css 的对应规则；Aurora 下走新引入的 layout.css）。
- [ ] `SettingsPage.tsx` 的页面骨架按 `ui/settings.html` 重布（左侧分类 nav + 右侧分组表单），保留现有的所有功能逻辑（主题切换器、表单项、保存/重置等），不丢任何已有能力。
- [ ] `connections` 页骨架按 `ui/connections.html` 重布。
- [ ] `terminal` 页骨架按 `ui/terminal.html` 重布。
- [ ] `app/public/logo-aurora.svg` + `logo-aurora-dark.svg` 落地（来自 `ui/assets/logo-v2*.svg`）；`Logo.tsx` 按 `uiTheme` 切换 logo 源。
- [ ] 4 种主题×色调组合在 settings/connections/terminal 三页都正确显示，切换无闪烁。
- [ ] 不破坏其它 5 个未迁移页面的现有能力（功能不退化）。
- [ ] 重置按钮恢复到 `classic + dark` 的现有默认行为不变。

## Technical Approach

### 目录结构（拟）
```
app/src/
  styles.css              # Classic 主题源（沿用，不大改）
  styles/
    aurora/
      tokens.css          # 来自 ui/styles/tokens.css，规则全部前缀 [data-ui-theme="aurora"]
      base.css            # 来自 ui/styles/base.css，同上
      components.css
      layout.css
      pages/
        settings.css      # 来自 ui/styles/pages/settings.css
        connections.css
        terminal.css
    aurora-index.css      # 汇总 import，被 main.tsx 引入
```

### 主题挂载（伪代码，挂在 App.tsx 顶层 effect）
```tsx
useEffect(() => {
  document.documentElement.setAttribute("data-ui-theme", uiTheme);
}, [uiTheme]);

useEffect(() => {
  const apply = (mode: "dark" | "light") => {
    document.body.classList.toggle("theme-dark", mode === "dark");
    document.body.classList.toggle("theme-light", mode === "light");
  };
  if (theme === "system") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    apply(mq.matches ? "dark" : "light");
    const handler = (e: MediaQueryListEvent) => apply(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  } else {
    apply(theme);
  }
}, [theme]);
```

### Aurora 样式 scope 处理
`ui/styles/tokens.css` 现在用 `:root, .theme-dark` 和 `.theme-light` 作为 scope。引入 app/ 后改写为：
```css
[data-ui-theme="aurora"],
[data-ui-theme="aurora"] .theme-dark { /* 暗色 token */ }
[data-ui-theme="aurora"] .theme-light { /* 亮色 token */ }
```
其它 base/components/layout 规则统一加 `[data-ui-theme="aurora"]` 前缀（用脚本批处理或手动）。

### 布局迁移策略
- 不重写 React 业务逻辑，只改 JSX 结构 + class 名 + 文件结构。
- 通用壳（Titlebar/Sidebar/StatusBar）一次改完，所有页面共享。
- 每个迁移页：先把 `ui/<page>.html` 的结构翻译成对应的 React JSX（保留 props/state/事件不变），再绑回现有的业务 hooks。

## Decision (ADR-lite)

**Context**: 用户既要保留旧风格（Classic）又要全面引入 ui/ 设计稿（Aurora），且布局要按 ui/ 重做。如果只换 token 不动布局，Aurora 的视觉根本撑不起来；如果重写 React 业务逻辑，工作量爆炸。

**Decision**:
1. **CSS 双源、scope 隔离**：Classic = styles.css 不变；Aurora = ui/ 的样式系统整体复制进 app/，加 `[data-ui-theme="aurora"]` 前缀。
2. **布局迁移分批**：M1 只做 settings + connections + terminal，验证机制；M2 再扩到剩余 5 页。
3. **业务逻辑不动**：所有 React state/hooks/事件保持原样，只改 JSX 结构 + class。
4. **主题切换 UI 不重做**：已存在于 SettingsPage，本期只验证生效。
5. **Logo 切换走 uiTheme**：v1 → Classic、v2 → Aurora；色调（dark/light）继续走原有的 `theme` 字段。

**Consequences**:
- 优点：Classic 用户视觉零侵入；Aurora 一上线就是完整的设计语言；布局统一便于后续迭代。
- 缺点：CSS 体积约翻倍（两套全集）；需要严格 scope 避免互相污染；M1 之后 5 页未迁移会有视觉割裂期。
- 风险：如果某些 Classic 组件依赖 styles.css 里的全局类名（无 `[data-ui-theme]` scope），可能被 aurora 文件意外覆盖——需要在 PR 前手工巡查 4 种组合下未迁移页面是否退化。

## Out of Scope

- sftp / monitor / snippets / workflows / quick-edit 5 个页面的布局迁移（M2）
- 主题切换 UI 本身的视觉重做（已在 SettingsPage，M1 只验证可用）
- v2 logo 的进一步打磨（已对齐 ui 视觉，本期定稿）
- 重新生成 src-tauri/icons 下的 PNG/ICNS/ICO（M2 或单独任务处理桌面 app icon 升级）
- 国际化文案的新增（沿用现有 i18n key）

## Technical Notes

- 现有主题字段：`stores/app.ts` 的 `theme` + `uiTheme`，已持久化到后端 `api.settingGet/settingSet`。
- 现有 SettingsPage：`app/src/features/settings/SettingsPage.tsx` line 524-869 涉及主题逻辑。
- ui 设计稿：`ui/{settings,connections,terminal}.html` + `ui/styles/`。
- ui 主题切换参考：`ui/index.html` line 200-225 的极简 toggle 脚本（仅参考思路，不直接拷贝）。
- v2 logo：`ui/assets/logo-v2.svg`（亮）/ `logo-v2-dark.svg`（暗），已对齐 ui 紫青系统。
- 经典 logo：`app/public/logo.svg` / `logo-dark.svg`，不动。

---

## M1.5：组件双轨化（追加）

### Context

PRD 主体把页面骨架按 ui/ 设计稿迁移到位，但 React 共用组件（Button / Input / Select / SegmentedControl）仍是 cva + Tailwind 写死的 Apple 蓝渐变 / 自拼浮层 DOM，不挂 ui/ 设计稿要求的原生 class（`.btn / .input / .select / .seg-control`），导致 aurora CSS 在 settings 页大半失效。

### Decision

三层组件结构：

- `app/src/components/ui/` —— 现有 Classic 实现，零改动
- `app/src/components/ui/aurora/` —— 新增 Aurora 实现，DOM 严格对齐 ui/ 设计稿原生 class
- `app/src/components/ui/themed/` —— 分发器，业务代码 import 这一层；内部 `useAppStore(s => s.uiTheme)` 选实现

业务代码 import 路径替换，props 完全兼容。

### 范围

- 首批（M1.5-α）：Button / Input / Select / SegmentedControl
- 次批（M1.5-β）：Toggle / Slider / InputStepper / ColorSwatch（无 Classic 实现，直接走 Aurora 原生 HTML，Classic 主题下若需独立视觉再补）

### 追加 Acceptance Criteria

- [ ] `app/src/components/ui/aurora/{Button,Input,Select,SegmentedControl}.tsx` 落地，DOM 完全对齐 ui/ 设计稿原生 class
- [ ] `app/src/components/ui/themed/{Button,Input,Select,SegmentedControl}.tsx` 分发器落地，按 `useAppStore.uiTheme` 切换实现
- [ ] SettingsPage.tsx 内对应组件 import 全部切到 themed/ 层
- [ ] Aurora × Dark / Aurora × Light 下 settings 页按钮、下拉、分段控件、输入框视觉与 `ui/settings.html` 对齐
- [ ] Classic × Dark / Classic × Light 下视觉零回归

### Variant 命名映射

| Classic `Button.variant` | Aurora class |
|---|---|
| `default` | `.btn .btn-primary` |
| `secondary` | `.btn .btn-secondary` |
| `ghost` | `.btn .btn-ghost` |
| `danger` | `.btn .btn-danger` |

业务代码继续用 Classic 命名（`default / secondary / ghost / danger`），themed 层负责映射。
