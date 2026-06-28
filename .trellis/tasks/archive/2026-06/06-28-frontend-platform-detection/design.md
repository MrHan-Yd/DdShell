# 技术方案

## 边界

本次只修改前端平台判断入口。后端 `app_platform_info` 保持不变，继续承担平台展示标签和更新器支持判断等异步场景。

## 方案

新增 `app/src/lib/platform.ts`：

- 导出 `isMacPlatform()`。
- 内部保留现有判断逻辑：`navigator.platform.toUpperCase().includes("MAC")`。
- 对非浏览器/测试环境做最小防护：没有 `navigator.platform` 时返回 `false`。

替换调用点：

- `app/src/hooks/useShortcuts.ts`
- `app/src/components/Titlebar.tsx`
- `app/src/features/terminal/RemoteFilePicker.tsx`
- `app/src/features/settings/SettingsPage.tsx`

## 取舍

- 不用 `api.appPlatformInfo()` 替换快捷键判断：快捷键监听和模块常量需要同步可用，异步查询会扩大改动范围并带来启动时序风险。
- 不立即改变判断语义：这次优化目标是集中散点，不引入行为变化。后续如果要修复特殊平台字符串，只需改 helper。

## 兼容性

保持现有 UI、快捷键、窗口控制和文案分支结果一致。新增 helper 是纯前端同步函数，不影响 Tauri 命令权限或后端数据流。
