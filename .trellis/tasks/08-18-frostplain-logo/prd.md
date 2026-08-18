# Logo 更新为 frostplain 深色风格

## Goal

将应用 logo 从 aurora（紫→青渐变）风格更新为 ui-frostplain（霜原）主题的深色风格，覆盖应用内 SVG 与打包图标全套。

## Decision (ADR-lite)

**Context**: logo 更新范围需确认。
**Decision**: 用户选择「应用内 SVG + 打包图标」——重绘 public/ 下 logo SVG（frostplain 深色），并重新生成 icons/ 下全套 Tauri 图标（Dock/任务栏/安装包同步更新）。
**Consequences**: 需要 SVG → 1024px PNG 渲染再走 `tauri icon` 生成全套；App Store / 各平台图标一并变更。

## Requirements

* 保留现有 DD 双字母图形结构（logo-aurora-dark.svg 中的双 D path），仅换配色为 frostplain 深色 token：
  * 背景渐变：#060A14 → #0B1220（frostplain --bg-app/--bg-base）
  * 主渐变（描边/填充）：#4E79D9 → #8FE8FF → #F3F8FF（--accent-gradient 135deg）
  * 光晕：冰蓝 #8FE8FF（替代紫色 #A78BFA orb/glow）
* 新增 `app/public/logo-frostplain-dark.svg`（200×200 viewBox 同现有）
* `Logo.tsx` 引用切换到新 SVG；检查 App.tsx / Sidebar.tsx / SettingsPage.tsx 中其他 logo 引用一并切换
* 用新 SVG 重新生成 `app/src-tauri/icons/` 全套（`npx tauri icon`，输入需 1024×1024）
* 旧 aurora SVG 文件保留不删（历史主题资产）

## Acceptance Criteria

* [ ] 新 SVG 视觉符合 frostplain 深色 token（冰蓝系，无紫色残留）
* [ ] 应用内（侧栏/设置页等）logo 显示新版
* [ ] icons/ 全套重新生成（icns/ico/png 各尺寸 + android/ios）
* [ ] npm run build / tsc 无报错

## Out of Scope

* 不改主题系统本身
* 不为每个主题做动态 logo 切换（logo 固定 frostplain 深色）

## Technical Notes

* frostplain token 源：`app/src/styles/frostplain/tokens.css`
* 现有 logo：`app/public/logo-aurora-dark.svg`（结构参考）
* Logo 组件：`app/src/components/Logo.tsx`（当前硬编码 /logo-aurora-dark.svg）
* SVG→PNG 可用 rsvg-convert / ImageMagick / qlmanage，或 tauri icon 直接吃 SVG（需验证）
