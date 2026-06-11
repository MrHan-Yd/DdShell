# 修复经典主题(classic)设置页布局缺失 — 两主题共用一套布局

## Goal

经典主题(`data-ui-theme="classic"`)下，设置页(SettingsPage)布局塌陷（左右分栏竖直叠、分类导航裸露）。
极光主题(`aurora`)布局完整。目标：让两个主题**共用同一套设置页布局骨架**，经典只替换配色，
且经典的 dark / light 两种 mode 都正确。改完后「调一处、两主题同步」，不再出现「调好极光、经典乱」。

## What I already know（根因诊断，已验证）

### 因果链
1. 设置页 React DOM 两主题共用，靠 `isAurora ? " aurora专属class" : ""` 给元素追加 class
   （如 `settings-nav` →(aurora) 追加 `settings-nav-panel`）。基础 class 两主题都渲染。
2. 设置页**布局骨架**（分栏、间距、分类项样式）只写在 `app/src/styles/aurora/pages/settings.css`，
   且每条都被 `[data-ui-theme="aurora"]` 前缀锁定 → **经典下一条不生效**。
3. 经典的 `styles.css` 对这些基础 class **零布局定义**（已逐个验证 = 0 处）。
4. → 经典下页面骨架退化为浏览器默认块级流 → 布局乱。

### 真正的塌点（经典无任何布局来源的页面骨架 class）
- `.settings-body` —— 左右分栏容器（aurora: `display:grid; grid-template-columns:260px minmax(0,1fr)`）**← 乱的主因**
- `.settings-nav` —— 左侧栏（aurora: flex-column + padding + border-right）
- `.settings-cat-list` —— 分类列表（aurora: flex-column + gap）
- `.settings-cat` —— 分类项（aurora: flex + padding + radius + hover/active）
- `.settings-pane` —— 右侧内容区（仅有 `flex-1`，缺 padding/overflow）
- `.settings-pane-head` / `.settings-pane-title` / `.settings-pane-sub` —— 标题区

### 已有兜底、不塌的部分（本次不动）
- `.settings-account`(styles.css:1219 有 grid) / `.settings-nav-empty`(1137)
- 行级 `SettingRow` / 分组 `Section`：classic 分支有 Tailwind utility 兜底（`flex justify-between py-2` / `glass-card border p-5`）

### 加重因素：两套 CSS 变量体系互不相通
- aurora 骨架用 `--bg-*` / `--fg-*` / `--space-*` / `--fs-*` / `--radius-md` / `--accent-gradient`（41 个），
  其中 38 个在 classic **无定义**；且 aurora 这套 token 锁在 `[data-ui-theme="aurora"]` 作用域内。
- classic 用 `--color-*` / `--font-size-*` / `--radius-control`（styles.css，`:root`=dark、`[data-theme=light]`=light）。
- → 不能简单把 aurora 布局「去作用域」，否则经典下变量取不到值、颜色和间距全丢。

### 范围已查明：bug 为设置页独有
- 6 个其他页面(connections/terminal/sftp/snippets/workflows/monitor) React 端 `isAurora` 追加 **0 处**，
  用 Tailwind + `--color-*` 自兜底，**不存在同类骨架塌陷**。设置页是唯一从静态原型继承整套 layout class 的页面。

### 生成机制
- `app/package.json` 无 aurora 生成脚本、无映射 `.mjs`。aurora/pages/*.css 的「Auto-scoped … Do not edit」
  注释指「别改 `ui/styles` 原型源」，该产物文件本身现为普通源文件、不会被自动覆盖。

## Requirements（evolving）
- [ ] 经典 dark 下设置页布局与极光一致（左右分栏 / 分类导航 / 标题区正常），仅配色不同
- [ ] 经典 light 下同样正确
- [ ] 极光主题 dark/light 视觉**零回归**
- [ ] 布局骨架成为**单一来源**（改一处两主题同步），满足用户「共用一套布局」诉求

## Acceptance Criteria
- [ ] 切换到经典主题，设置页左右分栏正确（左 ~260px 导航 + 右内容），不再竖直堆叠
- [ ] 经典下分类项(`.settings-cat`)有正确内边距/圆角/hover/选中态
- [ ] 经典 light + 经典 dark 两种 mode 都验证通过
- [ ] 极光 light + 极光 dark 对比改动前后无视觉差异
- [x] `npm run build` / typecheck 通过（tsc clean + vite build 成功，CSS 无语法错误）
- [ ] （待目测）经典 dark + light 设置页布局正常；极光 dark + light 零回归

## Technical Approach（草案，待 ADR 收敛）

核心三步（让布局骨架成为唯一一份、变量按主题喂值）：
1. **尺寸/动效 token 提全局**：`--space-*`/`--fs-*`/`--fw-*`/`--radius-{sm,md,pill}`/`--d-{fast,base}`/`--ease-*`/`--font-mono`
   （主题无关，约 22 个）提到全局 `:root`，两主题共用。已验证 classic 无同名定义 → 纯新增、无冲突。
2. **经典补 aurora 同名颜色变量**（约 19 个，dark/light 各一套），映射自 classic `--color-*`：

   | aurora 变量 | classic 映射 |
   |---|---|
   | `--bg-base` | `--color-bg-base` |
   | `--bg-elevated` | `--color-bg-elevated` |
   | `--bg-surface` | `--color-bg-surface` |
   | `--bg-hover` | `--color-bg-hover` |
   | `--bg-active` | `--color-bg-active` |
   | `--bg-app` | `--color-bg-base`(近似) |
   | `--fg-primary` | `--color-text-primary` |
   | `--fg-secondary` | `--color-text-secondary` |
   | `--fg-muted` | `--color-text-muted` |
   | `--fg-on-accent` | `--color-text-inverse` |
   | `--accent` | `--color-accent` |
   | `--accent-subtle` | `--color-accent-subtle` |
   | `--accent-glow` | `--color-accent` 的低透明(造值) |
   | `--accent-gradient` | `--color-accent` 单色实心（设计师确认：经典用单色蓝，不造渐变） |
   | `--border-subtle` | `--color-border-subtle` |
   | `--border-default` | `--color-border` |
   | `--border-strong` | `--color-border`(近似) |
   | `--success` | `--color-success` |

3. **解放页面骨架布局**：把上述「塌点」class 的布局规则从 `[data-ui-theme="aurora"]` 作用域解放为裸 class
   （唯一一份），两主题共用。aurora 自己的 token 仍由 aurora/tokens.css 提供 → 极光不变。

落点范围限制在「设置页 React 实际渲染的骨架 class」；aurora settings.css 里 React 不用的原型死规则
（`.toggle`/`.seg`/`.select`/`.settings-color`/`.settings-about-*`/`.settings-credits` 等）**不在本次范围**。

## Decision (ADR-lite)
- **Context**：经典设置页布局塌陷；两主题 token 体系隔离；用户(设计师 han)选定「共用一套布局只换色」。
- **Decision**：
  1. 设置页布局骨架解放为裸 class（单一来源，两主题共用）；
  2. 尺寸/动效 token 提全局 `:root`；
  3. 经典补 aurora 同名颜色变量（dark/light 两套），映射自 classic `--color-*`；
  4. 经典激活态用单色蓝 `--color-accent`、不造渐变。
- **Consequences**：布局单一来源（改一处两主题同步）；新增全局尺寸 token（纯增、无冲突）；
  经典多一套颜色别名变量（仅设置页骨架依赖）；极光零回归（aurora token 仍由 aurora/tokens.css 提供）。

## Resolved Decisions
- ✅ 方向：两主题共用一套布局，经典只换色（设计师 han 确认）
- ✅ 范围：仅设置页（其他页面无同类问题）
- ✅ 经典 accent：激活态统一用经典主色单色蓝 `--color-accent`(#3B82F6)，不造渐变（设计师 han 确认）

## Out of Scope
- 其他 6 个页面（无同类问题）
- 清理 aurora settings.css 中 React 未使用的原型死规则（另开任务）
- 改动设置页 DOM 结构 / React 逻辑（仅 CSS + token 层修复）

## Technical Notes
- 关键文件：
  - `app/src/features/settings/SettingsPage.tsx`（DOM 与 class，确认渲染哪些骨架 class）
  - `app/src/styles/aurora/pages/settings.css`（极光骨架来源，760+ 行）
  - `app/src/styles/aurora/tokens.css`（aurora token，`[data-ui-theme=aurora]` 作用域）
  - `app/src/styles.css`（classic token 与样式，`:root`=dark / `[data-theme=light]`=light）
- token 定义块：styles.css `:root`(41,classic dark) / `[data-theme=light]`(325) / `[data-ui-theme=aurora]`(356) / 组合(408)

---

## 真相修正（2026-06-05 复核，推翻上一轮"CSS 作用域"单一诊断）

上一轮诊断只抓住"CSS 作用域锁定"，**漏了两层关键事实**，导致"代码层就绪"是误判：

1. **真正根因 = React 的 `isAurora` DOM 分叉**（SettingsPage.tsx 约 30 处）。设置页用 `isAurora ? 极光class/JSX : 经典朴素/Tailwind` 把两主题做成**两套不同 DOM**，不是同 DOM 换色。经典 DOM 上根本没有 `settings-hero-card`/`settings-section`(语义版)/`settings-nav-panel` 等 class（或走完全不同的 Tailwind 兜底），CSS 再怎么调都选不中。
2. **极光是「扁平 + 分隔线」，不是卡片**。极光最终视觉由 specificity 最高的「带 `settings-page--aurora` 层」决定（settings.css 708–765）：hero/section 被 `padding:0;border:0;border-radius:0;background:transparent` 清零，仅靠底部分隔线 + 间距分组；row = `grid 1fr auto`。styles.css 里 `border-radius:24px` 那些卡片规则是**被覆盖的死规则**。
3. 极光这套排版**整体锁在 `[data-ui-theme="aurora"]` 作用域**（settings.css 几乎全文 + styles.css 1463–1810）。经典 `<html data-ui-theme="classic">` 物理上一条都命中不了 → 退化为 styles.css 裸卡片 class / React Tailwind 兜底 → 与极光两种风格。

设计师 han 决策（2026-06-05）：**全面对齐极光布局**（经典从朴素→扁平分隔线，仅换经典色）；**关于页统一用极光版内容**（版本/构建/运行时/平台 + credits + 三按钮）。

## 最终方案：整组去 `[data-ui-theme="aurora"]` 前缀（治本 + 零极光回归）

对某区域相关的**所有** `[data-ui-theme="aurora"] X` 规则，统一删除开头 `[data-ui-theme="aurora"] ` 前缀（X 选择器其余 + 所有属性值**一字不改**），并让 **React 两主题都加 `settings-page--aurora`**（994 去 isAurora）。

- 极光：整组规则同时少掉**共有**前缀 → 组内相对 specificity 与层叠顺序不变 → **视觉零变化**。
- 经典：现在命中同一套规则，拿到逐像素一致的布局，仅变量值为经典色（reverse-bridge 已供 `--bg-*/--fg-*/--border-*/--accent-*/--success`，尺寸 token 已全局）。
- 前提已验证：`settings-page--aurora` 无裸用法（经典加它不误命中未改规则）；`styles.css → settings.css` 加载顺序使后者覆盖成立。
- 配套：React 各组件去 `isAurora`、统一取原 aurora 分支 class，**删除经典 Tailwind 兜底**（避免 utility 与去前缀规则打架）。

## 分批计划（每批：派 trellis-implement 实现 → trellis-check 自检 → 交 han 目测）

- **Batch 1**：顶部 hero + 分组 section + 行 row + group/group-title（决定整页观感，并验证本方法）
- **Batch 2**：左侧导航 nav-* + 账户卡 account-card
- **Batch 3**：关于页（删 isAurora 分叉，统一极光版 DOM + about-* 去前缀）+ 保存状态 pane-status 收尾

### Batch 1 精确规格

**React (SettingsPage.tsx)** — 去 isAurora、统一 aurora 分支 class、删经典 Tailwind 兜底：
- `994`：`${isAurora ? " settings-page--aurora" : ""}` → 恒加 `" settings-page--aurora"`（两主题）
- `Section` 组件 `130–152`：`sectionCls="settings-group settings-section"`；`headerCls="settings-section__header"`；`titleCls="settings-group-title"`；description 恒为 `<p>{description}</p>`；删 glass-card/border/p-5/mb-4/pb-3/text-*/font-* 兜底
- `SettingRow` 组件 `170–194`：`rowCls=\`settings-row${indentCls}\``、`indentCls=indented?" settings-row--indented":""`；text/label/help/control 取 aurora 版双 class；删 flex/justify-between/py-2/pl-6/ml-4/text-* 兜底
- hero header `1078–1088`：恒加 `settings-hero-card`/`__title`/`__subtitle`/`__side`/`settings-pane-status settings-pane-status--${tone}`；图标恒为 `<span class="settings-pane-status__dot">`（删 `<Check>`）

**CSS — 删除开头 `[data-ui-theme="aurora"] ` 前缀（属性值不动）**，以 grep 实际定位为准，行号参考：
- settings.css：`193–220`（row/row-text/row-label/row-help/row-control/row-stack）、`663–704`（pane-status--idle、section 清零/header/content、row、row__label/desc/control）、`708–765`（settings-page--aurora 层：pane bg、tabpanel、hero+section 清零、hero margin/border、section header、group、group-title、row grid）
- styles.css：`1463–1499`（section overflow/header h3/content、row gap/border/text/label/desc/control）、`1639–1651`（hero-card padding/radius/紫边、title 32、subtitle）、`1761–1798`（section radius/padding/header/h3 大写小标题/content、row align/gap/padding/label/desc/control）
- 保持不动：styles.css `1366–1461` 裸 `.settings-hero-card`/`.settings-pane-status` 等（裸 class 用 `--color-*`，被去前缀后的高 specificity 规则覆盖或经典直接复用，无需改）
- **不在 Batch 1**：nav-*（settings.css 520–593）、account-card（595–）、about-*（448–506）—— 留 Batch 2/3

**约束 / 验收**：
- 只删选择器前缀，**属性值一字不改**；区域相关段**全部**去前缀（漏段会破坏 specificity、改值会动极光视觉）
- 极光 dark+light 应与改动前**零差异**；经典 dark+light 顶部=扁平大标题+底分隔线、分组无卡片、行 grid 左右对齐 + dashed 分隔
- `npm run build` / tsc 通过；**不要 commit**
