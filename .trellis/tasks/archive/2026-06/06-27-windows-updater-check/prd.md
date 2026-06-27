# 检查 Windows 更新安装链路

## Goal

确认 v0.2.5 版本的 Windows 更新安装链路是否存在类似 macOS “下载完成后打开安装包没反应”的问题，并给出是否需要修复的结论。

## User Value

用户需要知道 Windows 版本是否可以正常通过应用内更新安装，避免发布后出现下载完成但无法启动安装器的同类问题。

## Confirmed Facts

- macOS 手动安装包打开问题已在上一轮通过 `download_update` 文件落盘校验和 macOS `/usr/bin/open` 打开逻辑修复。
- Windows 当前主更新链路应优先走 Tauri 官方 updater 的 `downloadAndInstall()`。
- Windows 手动下载打开链路仍需要确认是否有文件存在校验、安装包类型选择和打开安装包能力。
- v0.2.5 发布资产需要确认是否包含 Windows 安装包、签名和 `latest.json` manifest。

## Requirements

- 检查前端 updater store，确认 Windows 是否使用官方 updater 还是手动下载打开链路。
- 检查 Tauri 后端 updater 命令，确认 Windows 手动打开安装包是否存在明显代码问题。
- 检查 release workflow 和 v0.2.5 实际发布资产，确认 Windows manifest 指向的安装包和签名存在。
- 如发现明显问题，修复并验证；如未发现明显问题，给出明确风险结论。

## Acceptance Criteria

- 能明确回答 Windows 更新安装链路是否会像 macOS 一样“下载完成后打开安装包没反应”。
- 能区分官方 updater 链路与手动下载打开链路的行为和风险。
- 能确认 v0.2.5 Windows 发布资产和 updater manifest 是否齐全。
- 若无代码修改，也要说明未修改的原因和剩余风险。

## Out Of Scope

- 不重新设计 updater UI。
- 不发布新 tag 或新 release，除非用户另行要求。
- 不在真实 Windows 机器上安装验证，除非有可用 Windows 环境或用户要求。

## Open Questions

- 无阻塞问题；当前可通过代码和发布资产检查继续。

## Inspection Results

- Windows 主更新入口使用 `app/src/stores/updater.ts` 的官方 Tauri updater 链路：
  - `isOfficialUpdaterSupported(os)` 支持 `windows`。
  - 下载和安装调用 `pendingUpdate.downloadAndInstall()`。
  - 安装完成后进入 `readyToRestart`，重启需要用户确认。
- Windows 旧手动链路没有发现 macOS 同类问题：
  - `download_update` 会 flush、关闭文件，并校验下载文件存在、是文件、大小匹配后才发送完成事件。
  - `open_installer` 在 Windows 会先校验路径存在且是文件，再调用 `tauri_plugin_opener::open_path`。
  - 当前前端 updater 主 UI 不直接调用旧手动下载打开链路。
- v0.2.5 release 资产检查通过：
  - `DdShell-v0.2.5-windows-x64.exe`
  - `DdShell-v0.2.5-windows-x64.exe.sig`
  - `DdShell-v0.2.5-windows-x64.msi`
  - `latest.json`
- `latest.json` 检查通过：
  - `windows-x86_64-nsis` 指向 `DdShell-v0.2.5-windows-x64.exe`。
  - `windows-x86_64` fallback 也指向同一个 NSIS exe。
  - 两个 Windows 平台项都有签名字段。
- 未发现需要代码修复的问题。剩余风险是当前环境不是 Windows 真实安装环境，无法在本机实际点击安装器验证 UAC/安装向导行为。

## Validation

- `cd app/src-tauri && cargo check`
- `cd app && pnpm build`
