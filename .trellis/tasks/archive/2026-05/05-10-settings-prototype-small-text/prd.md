# 设置页原型小字圆形样式修复

## Goal

让设置页面顶部标题“设置 / Settings”下方的小字文案与 `ui/settings.html` 原型一致，避免当前 React 版本显示迁移说明类文案，恢复设计稿的产品化副标题。

## What I already know

* 用户反馈：设置页面“设置底下的小字”与原型不一致，需要实现“原型小字”的功能。
* 用户确认：指的是设置页顶部标题下方的小字；“原型就是 ui 设计稿”。
* 原型文案：`ui/settings.html:61-62` 显示 `Settings` / `Personalise DdShell · 6 categories · synced`。
* 当前 React 文案：`app/src/lib/i18n.ts` 的 `settings.heroSubtitle` 为双主题迁移说明：`保持原有能力不变，用更明确的层级、玻璃质感和双主题结构管理整套应用界面。`
* 原型位置：`ui/settings.html` 的 `.settings-cat` 分类项包含 `.label` 主标题、`.meta` 小字，命令助手项额外包含 `.settings-cat-badge.badge.badge-accent` 的 `Beta` 徽标。
* React 位置：`app/src/features/settings/SettingsPage.tsx` 使用 `SETTINGS_TAB_META[].navMeta` 渲染 `<span className="meta ...">{navMeta}</span>`。
* 样式位置：`ui/styles/pages/settings.css` 和 `app/src/styles/aurora/pages/settings.css` 都定义了 `.settings-cat .meta`、`.settings-cat-badge`。

## Assumptions (temporary)

* 因当前没有真实设置同步功能，顶部副标题不能承诺“已同步”。
* 中文文案应使用本地设置语义：`个性化 DdShell · 6 个分类 · 本地设置`。
* 英文文案应使用本地设置语义：`Personalise DdShell · 6 categories · local settings`。
* 设置菜单底部概览区块已符合用户给定内容：`本地设备概览`、`这是一个纯展示概览区块，用于显示当前主题与版本；你的设置仍然只保存在本地。`、`极光主题（Aurora） · 深色`。

## Open Questions

* 已确认：指顶部标题下方原型小字，不是分类菜单 `.meta` 或 `Beta` 徽标。

## Requirements (evolving)

* `settings.heroSubtitle` 的中英文文案需对齐设计稿结构，但不能暗示尚未实现的同步功能。
* 中文显示：`个性化 DdShell · 6 个分类 · 本地设置`。
* 英文显示：`Personalise DdShell · 6 categories · local settings`。
* `settings.accountTitle` 和 `settings.accountSubtitle` 保持本地设备概览语义。
* 设置页左侧设置列表下方的“本地设备概览”卡片布局需要恢复为清晰、稳定的概览区块；不能出现文字/主题版本信息挤压、错位或破坏侧栏宽度。
* 设置页左侧设置列表项右侧的英文菜单名（`General` / `Data` / `Terminal` 等 navMeta）需要去掉，不再显示。
* 设置页“关于”里的程序 Logo 需要跟随页面左上角 Logo 的主题变化一起变化，避免两处品牌图形不一致。
* 设置页“关于”里的程序 Logo 复用主题感知来源后，仍需要保持关于卡片中的大 Logo 视觉；不能在原图标容器中变成中间很小的一块。
* 设置页“关于”里的程序 Logo 应正常展示 Logo 本体，不需要额外背景/边框图标盒；额外容器装饰会让 Logo 显得更小。
* 左上角应用 Logo 也应正常展示 Logo 本体，不需要额外背景/边框图标盒，保持与关于页 Logo 的展示方式一致。
* 设置页“关于”里的平台信息不能使用 `navigator.platform` 的兼容字符串误报 Apple Silicon 为 `MacIntel`；需要显示真实 OS/架构信息。
* 修改不改变设置页布局、按钮、分类菜单和保存状态逻辑。

## Acceptance Criteria (evolving)

* [ ] 设置页顶部标题下方小字不再显示双主题迁移说明文案。
* [ ] 中文 locale 显示 `个性化 DdShell · 6 个分类 · 本地设置`。
* [ ] 英文 locale 显示 `Personalise DdShell · 6 categories · local settings`。
* [ ] 设置页不出现会误导用户已有真实云同步的 `已同步` / `synced` 顶部副标题。
* [ ] Classic 和 Aurora 主题下都通过同一 i18n key 显示正确。
* [ ] 设置页左侧列表下方“本地设备概览”卡片在 Classic / Aurora 下布局稳定，标题、说明、当前主题/模式信息不重叠、不溢出。
* [ ] 设置页左侧列表只显示图标和本地化菜单名，不显示右侧英文 navMeta。
* [ ] 设置页“关于”程序 Logo 与左上角应用 Logo 使用同一主题感知来源/组件，切换 Classic / Aurora 时保持一致。
* [ ] 设置页“关于”程序 Logo 在卡片中有合理尺寸和填充，不显示为容器中央的小图标。
* [ ] 设置页“关于”程序 Logo 不再显示额外背景/边框图标盒，只展示主题感知 Logo 本体。
* [ ] 左上角应用 Logo 不再显示额外背景/边框图标盒，只展示主题感知 Logo 本体。
* [ ] Apple Silicon Mac 不显示 `MacIntel` 作为平台；平台信息应包含真实架构（例如 `macOS arm64` / `darwin arm64`）。

## Definition of Done

* Lint / typecheck 通过或说明无法运行的原因。
* 若发现可复用样式约定，记录到 spec 或说明无需更新。

## Out of Scope

* 不重做设置页整体布局。
* 不调整 `Beta` 徽标。
* 不调整保存/恢复默认按钮逻辑。

## Technical Notes

* `ui/settings.html:61-62` 是原型顶部标题和副标题。
* `app/src/features/settings/SettingsPage.tsx:948-949` 渲染 `settings.heroSubtitle`。
* `app/src/lib/i18n.ts:350-352` 定义 `settings.title` / `settings.heroSubtitle`。
