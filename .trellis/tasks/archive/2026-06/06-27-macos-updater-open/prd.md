# macOS 更新包打开失败 PRD

## Goal

修复 macOS 上更新包下载完成后点击“打开安装包”没有反应的问题，确保下载完成事件只在文件写入完成后发出，并且 macOS 使用可靠的系统打开方式打开 `.dmg` 安装包。

## User Value

- 用户在应用内下载更新包后，点击“打开安装包”能真正打开 macOS 安装包。
- 如果打开失败，应用能返回明确错误并回退到下载页，而不是看起来没有任何响应。

## Confirmed Facts

- 用户反馈：macOS 系统中更新版本下载完成后，点击“打开安装包”没有反应。
- 旧版更新 UI 使用 `download_update` 下载 GitHub Release 安装包，下载完成后监听 `update:download_completed` 并调用 `open_installer`。
- 当前 `open_installer` 在 macOS 上直接调用 `tauri_plugin_opener::open_path(&path, None)`。
- `download_update` 在后台任务中写完最后一块后立即 emit `update:download_completed`，没有显式 flush/sync 文件，也没有在发事件前校验文件可读。
- 当前 v0.2.4+ 主要走 Tauri 官方 updater，但旧的 `download_update/open_installer` 命令仍保留，且旧版本用户升级时仍可能经过这条路径。

## Requirements

- `download_update` 在发出完成事件前必须 flush 文件，并确认目标文件存在。
- `open_installer` 必须先校验路径存在且是文件。
- macOS 上优先使用系统 `/usr/bin/open <path>` 打开安装包，并等待命令启动返回状态。
- 如果 macOS `open` 命令失败，返回包含状态或 stderr 的错误；不要静默成功。
- Windows 继续使用现有 opener 路径打开安装包。
- Linux 继续返回不支持。
- 不改变 Tauri 官方 updater 的 `downloadAndInstall()` 安装/重启流程。

## Acceptance Criteria

- macOS 下载完成后调用 `open_installer` 可以打开 `.dmg` 文件，失败时返回明确错误。
- 完成事件不会早于文件写入 flush。
- Windows / Linux 行为不回归。
- `cargo check` 和 `pnpm build` 通过。

## Out Of Scope

- 重新设计官方 updater UI。
- 改变 `latest.json` manifest 或 release workflow。
- 自动修复已经发布旧版本中的代码；本修复随后续版本生效。

## Open Questions

- 无阻塞问题。先修保留的手动更新包打开路径，并保持官方 updater 流程不变。
