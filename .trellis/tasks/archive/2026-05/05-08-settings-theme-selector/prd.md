# add settings theme selector and second ui theme

## Goal

在不改变现有设置功能、数据结构、交互语义和主题切换能力的前提下，为设置页加入明确的主题栏/主题选择器，并把当前 `ui/` 目录中这套经典风格扩展为可切换的双主题展示，其中第二套主题采用新的视觉语言与布局表达，但功能保持一致。

## What I already know

* 用户明确要求：原有功能不能变化，只允许 UI 展示与布局不同。
* `ui/settings.html` 当前是独立 HTML/CSS 原型，已有全局 `dark/light` 页面预览切换。
* `ui/index.html` 已明确这套新视觉为新版 UI concept：Warp-inspired、紫青渐变、玻璃质感，并包含 `v2` logo proposal。
* 真实设置页在 `app/src/features/settings/SettingsPage.tsx`，已有主题设置能力，真实 tabs 为 `general / transfer / terminal / commandAssist / shortcuts / about`。
* 历史研究 `ui-vs-real-gap.md` 已指出：`ui/settings.html` 与真实设置页功能分组不完全一致，不能直接把原型结构原样映射到真实功能。

## Assumptions (temporary)

* “当前这套 UI 为经典主题”指现有真实应用视觉风格将保留为默认主题。
* `ui/` 目录现有设计稿就是第二套主题的视觉来源，不需要重新定义视觉方向。
* 第二套主题是新的应用主题，不只是 `ui/` 静态稿命名调整。
* 第二套主题暂命名为“极光主题（Aurora）”。
* 这次需要修改真实应用设置页和相关主题展示，而不仅是 `ui/` 静态 HTML 原型。

## Open Questions

* 无。

## Requirements (evolving)

* 保留所有现有设置功能，不删除、不改名、不重排成影响使用的功能结构。
* 在设置页加入主题栏，核心控件是主题选择器。
* 现有视觉方案命名为“经典主题”。
* 新增一套第二主题，按 `ui/` 目录现有设计稿落地，命名为“极光主题（Aurora）”。
* 第二主题生效范围为整个应用界面，不仅限设置页。
* 设置页提供主题选择器，作为整套应用主题切换入口。
* 新增的 UI 主题选择器独立于现有 `dark/light/system` 主题模式存在；原有模式功能继续保留。
* 第二主题只能改变视觉表现和布局层次，不能影响原有功能行为。

## Acceptance Criteria (evolving)

* [ ] 设置页可看到主题选择器，且包含“经典主题”和新增第二主题。
* [ ] 切换主题后整套应用视觉风格同步变化，现有设置项和交互功能保持可用。
* [ ] 不因主题改造破坏已有 theme/light/dark/system 等原有功能语义。

## Technical Approach

* 在现有主题模式之上新增一层应用 UI 主题枚举：`classic` / `aurora`。
* 设置页新增独立主题栏，提供 UI 主题选择器，同时保留原有 dark/light/system 模式设置。
* `classic` 维持当前真实应用视觉；`aurora` 以 `ui/` 目录现有设计稿为依据，映射到真实页面样式与布局层次。
* 改造范围以前端样式、布局、主题令牌和设置页展示为主，不改动原有设置项行为、业务数据结构和功能语义。

## Decision (ADR-lite)

**Context**: 需要在不破坏现有主题能力的前提下，引入一套与 `ui/` 设计稿一致的新视觉主题。

**Decision**: 保留现有 `dark/light/system` 作为颜色模式，再新增一层 UI 主题选择 `经典主题 / 极光主题（Aurora）`。设置页作为该选择器入口，整套应用界面跟随切换。

**Consequences**: 主题系统会从单层颜色模式扩展为“UI 主题 + 颜色模式”的双层结构，但可以最大限度保持原有功能不变，并避免用新视觉直接替换掉已有主题语义。

## Definition of Done (team quality bar)

* Tests added/updated when appropriate
* Lint / typecheck green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

* 新增与主题无关的设置功能
* 修改设置项业务逻辑或存储结构
* 借机修复与本任务无关的 UI 差异

## Technical Notes

* 参考文件：`ui/settings.html`
* 参考文件：`ui/index.html`
* 参考样式：`ui/styles/pages/settings.css`
* 真实实现：`app/src/features/settings/SettingsPage.tsx`
* 历史研究：`.trellis/tasks/archive/2026-05/05-08-ui-html-css/research/ui-vs-real-gap.md`
