# 收敛前端平台判断

## 目标

将前端散落的 macOS 平台判断集中到统一 helper，降低后续维护风险，同时保持现有快捷键、标题栏和提示文案行为不变。

## 背景与证据

- `app/src/hooks/useShortcuts.ts` 直接使用 `navigator.platform` 判断 macOS，用于 Cmd/Ctrl 快捷键分支和部分 Shift 逻辑。
- `app/src/components/Titlebar.tsx` 直接使用 `navigator.platform` 判断 macOS，用于 macOS 下隐藏自定义窗口控制按钮。
- `app/src/features/terminal/RemoteFilePicker.tsx` 直接使用 `navigator.platform` 判断 macOS，仅用于隐藏文件快捷键提示文案。
- `app/src/features/settings/SettingsPage.tsx` 直接使用 `navigator.platform` 判断 macOS，用于快捷键标签文案；同文件已使用 `api.appPlatformInfo()` 展示应用平台标签。
- 后端已有 `app_platform_info` / 前端 `api.appPlatformInfo()`，适合展示规范化平台标签，不适合替换同步快捷键判断。

## 需求

1. 新增前端平台 helper，集中提供同步 macOS 判断。
2. 替换前端功能代码中的直接 `navigator.platform` 访问。
3. 保持现有判断语义不变：仍按当前 `navigator.platform.toUpperCase().includes("MAC")` 识别 macOS。
4. 保持 `api.appPlatformInfo()` 继续用于设置页和更新器等异步平台标签/支持判断，不把快捷键路径改成异步。
5. 不改后端命令、不改快捷键定义、不改窗口控制行为。

## 验收标准

- `app/src` 中不再有散落的 `navigator.platform` 或 `navigator.userAgent` 直接调用，平台判断集中在 helper。
- macOS 下快捷键标签仍显示 Cmd/Option，非 macOS 下仍显示 Ctrl/Alt。
- macOS 下标题栏仍隐藏自定义窗口控制按钮，非 macOS 下仍显示。
- 远程文件选择器隐藏文件提示仍按平台显示 `⌘.` 或 `Ctrl+.`。
- 前端构建通过。
- Tauri Rust 检查和测试通过。

## 不在范围

- 不引入异步平台状态 store。
- 不改变 `appPlatformInfo()` 的后端实现。
- 不修正浏览器兼容字符串本身的潜在历史问题，只先集中入口，便于后续统一增强。
