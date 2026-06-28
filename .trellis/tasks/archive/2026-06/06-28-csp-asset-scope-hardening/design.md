# Design

## Architecture

安全加固分三层：

1. Tauri 配置层
   - 在 `tauri.conf.json` 启用 CSP baseline。
   - 将 `assetProtocol.scope.allow` 从任意文件收窄到 `$APPDATA/terminal-backgrounds/**`。
2. Rust 命令层
   - 增加 `terminal_import_background_image` 命令。
   - 命令负责校验扩展名、确认源路径是文件、创建应用数据目录子目录、复制图片并返回导入后的绝对路径。
3. 前端设置/终端层
   - 设置页选择图片后调用导入命令，保存导入后的路径。
   - 设置页加载旧路径时尝试迁移，迁移成功后更新本地草稿和持久化设置。
   - 终端加载旧路径时也做一次迁移兜底，避免用户不进设置页时背景失效。

## Data Flow

新选择图片：

`SettingsPage open()` -> `api.terminalImportBackgroundImage(sourcePath)` -> Rust 复制到 app data -> 返回 `path` -> 保存 `terminal.bgImagePath` -> `TerminalPage convertFileSrc(path)` -> asset protocol 读取 `$APPDATA/terminal-backgrounds/**`

旧路径迁移：

`settingGet("terminal.bgImagePath")` -> 判断不是导入目录路径 -> 调用 `terminalImportBackgroundImage` -> 成功后 `settingSet("terminal.bgImagePath", imported.path)` -> 使用新路径渲染

## CSP Contract

Baseline CSP 需要满足：

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' asset: http://asset.localhost data:`
- `font-src 'self' data:`
- `connect-src 'self' ipc: http://ipc.localhost`
- `media-src 'self' asset: http://asset.localhost data:`
- `object-src 'none'`
- `base-uri 'self'`
- `frame-src 'none'`

`asset:` 覆盖 macOS/Linux 的 `asset://localhost/...`。`http://asset.localhost` 覆盖 Windows WebView 的 asset URL。`ipc:` 与 `http://ipc.localhost` 覆盖 Tauri IPC。

## Compatibility

- 不删除旧源图片，只复制到应用数据目录。
- 导入失败不清空用户当前草稿，避免一次失败造成设置丢失。
- 旧路径迁移是 best effort：成功即落库，失败则保持可见路径，用户可以重新选择。
- 复制文件名使用源路径 hash 加扩展名，避免同名覆盖和暴露完整原始路径。

## Rollback

如果 CSP 导致页面资源阻断，回滚 `tauri.conf.json` 的 CSP 字段即可恢复 WebView 策略。

如果 asset scope 导致背景图不可用，临时回滚 `assetProtocol.scope.allow` 到宽范围可恢复旧行为，但最终应修正导入/migration 链路。
