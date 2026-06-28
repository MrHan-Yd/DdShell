# Tauri capabilities 权限瘦身

## Goal

按窗口实际功能收窄 Tauri capability 权限，降低 WebView 可调用原生插件能力，同时验证现有主窗口、Quick Edit、设置、更新器、剪贴板和文件选择功能不被破坏。

## Confirmed Facts

- 当前 capability 文件：
  - `app/src-tauri/capabilities/default.json` 绑定 `main` 窗口。
  - `app/src-tauri/capabilities/quick-edit.json` 绑定 `quick-edit` 窗口。
- 主窗口当前权限包含：
  - `opener:default`
  - `dialog:default`
  - `notification:default`
  - `clipboard-manager:allow-read-text`
  - `clipboard-manager:allow-write-text`
  - `process:allow-restart`
  - `updater:allow-check`
  - `updater:allow-download-and-install`
- Quick Edit 当前权限包含 `dialog:default`，但 Quick Edit 相关代码未发现 `@tauri-apps/plugin-dialog` 用法。
- 前端未直接导入 `@tauri-apps/plugin-opener` 或 `@tauri-apps/plugin-notification`。
- 打开 GitHub/安装器等行为通过自定义 Rust command 调用后端 `tauri_plugin_opener`，不是前端 opener plugin API。
- 设置页和终端文件管理抽屉使用 `@tauri-apps/plugin-dialog` 的 `open()`，没有发现 `ask`、`confirm`、`message`、`save` dialog plugin 用法。
- Quick Edit 复用 `QuickEditor`，其中会通过 `@tauri-apps/plugin-clipboard-manager` 读写剪贴板，因此 Quick Edit 仍需要剪贴板读写权限。
- 主窗口和 Quick Edit 都使用共享 `Titlebar` 的 minimize/toggleMaximize/close，并使用拖拽区域，因此窗口权限不应收窄这些项。

## Requirements

1. 只做低风险 capability 瘦身，不改业务逻辑。
2. 主窗口：
   - 保留 `core:default`、窗口控制、event、剪贴板、process restart、updater 权限。
   - 将 `dialog:default` 收窄为 `dialog:allow-open`。
   - 删除前端未直接使用的 `opener:default`。
   - 删除前端未直接使用的 `notification:default`。
3. Quick Edit：
   - 保留 `core:default`、窗口控制、event、剪贴板读写权限。
   - 删除未使用的 `dialog:default`。
4. 不删除不确定权限：
   - 不在本任务中拆 `core:default`，避免影响 path/app/window/webview 基础 API。
   - 不改变 updater/process 权限，因为设置页/状态栏更新流程需要。
5. 验证：
   - 运行前端 build、Rust check/test。
   - 运行 Tauri capability/config 校验或等效 `tauri build --no-bundle`，确认权限名和配置有效。

## Acceptance Criteria

- capability 文件不再授予主窗口 `opener:default`、`notification:default`。
- 主窗口 dialog 权限仅保留 `dialog:allow-open`。
- Quick Edit 不再授予 `dialog:default`。
- `pnpm -C app build` 通过。
- `cargo check` 在 `app/src-tauri` 下通过。
- `cargo test` 在 `app/src-tauri` 下通过。
- Tauri 配置/capability 校验通过；若完整构建因环境限制失败，需要记录原因和失败阶段。

## Out Of Scope

- 拆分或替换 `core:default`。
- 改造自定义 Rust command 权限模型。
- 实现或删除未完成的传输系统通知功能。
- UI 行为重构。

## Open Questions

无阻塞问题。用户已要求修改后校验原功能可用。
