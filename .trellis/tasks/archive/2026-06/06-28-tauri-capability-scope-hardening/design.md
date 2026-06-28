# Design

## Approach

采用保守瘦身，不动业务代码，只修改 `app/src-tauri/capabilities/*.json`。

## Permission Decisions

### Main Window

保留：

- `core:default`：当前主窗口使用 Tauri app/path/webview/window/event 等基础 API，拆分风险较高。
- `core:window:allow-minimize`
- `core:window:allow-toggle-maximize`
- `core:window:allow-close`
- `core:window:allow-start-dragging`
- `dialog:allow-open`：设置页选择下载目录/终端背景图，终端文件管理抽屉选择上传文件。
- `clipboard-manager:allow-read-text`
- `clipboard-manager:allow-write-text`
- `core:event:default`
- `process:allow-restart`
- `updater:allow-check`
- `updater:allow-download-and-install`

删除：

- `opener:default`：前端未直接导入 opener plugin；浏览器/安装器打开由后端自定义 command 执行。
- `notification:default`：前端未直接导入 notification plugin；当前仅存在传输通知设置项，没有 WebView notification plugin 调用。
- `dialog:default`：替换为更小的 `dialog:allow-open`。

### Quick Edit Window

保留：

- `core:default`
- `core:window:allow-minimize`
- `core:window:allow-toggle-maximize`
- `core:window:allow-close`
- `core:window:allow-start-dragging`
- `clipboard-manager:allow-read-text`
- `clipboard-manager:allow-write-text`
- `core:event:default`

删除：

- `dialog:default`：Quick Edit 没有 dialog plugin 用法。

## Compatibility

- 不改变自定义命令注册，因此 SSH/SFTP、Quick Edit 读写远程文件、更新器自定义 fallback 逻辑不受 capability 文件变更影响。
- 剪贴板权限对主窗口和 Quick Edit 均保留，避免编辑器/终端粘贴功能回归。
- updater/process 权限保留，避免官方更新器流程回归。

## Validation Strategy

1. `pnpm -C app build`：验证前端类型和打包。
2. `cargo check`：验证 Rust 编译。
3. `cargo test`：验证 Rust 测试。
4. `pnpm -C app tauri build --no-bundle`：验证 Tauri config/capabilities 与 WebView 权限解析。
