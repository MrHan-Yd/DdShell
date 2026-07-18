# 修复 Windows MSI 安装 2503 与自动更新失败

## 背景

v0.3.0 发布后用户反馈两个 Windows 问题（实为两个根因，均在 MSI 链路）：

1. **手动安装 MSI 报错 2503**（"Setup Wizard ended prematurely"）
2. **程序内自动更新完全失败**：下载完成 → 应用关闭 → 不重启，手动打开仍是旧版本

### 根因（已通过源码级调查确认）

- **2503**：v0.2.8 提交 `c195de0` 引入的 `app/src-tauri/wix-preserve-install-dir.wxs`，内嵌约 170 行 VBScript custom action。脚本类 custom action 在 Windows 11 上易被拦截，导致 MSI 状态机错乱报 2503。**v0.2.7 及之前的 MSI 是纯净的、可正常安装的。**
- **自动更新失败**：`tauri.conf.json` 中 `updater.windows.installMode: "quiet"`。tauri-plugin-updater 2.10.1 对 MSI 的静默安装流程为 `ShellExecuteW(msiexec /i xxx.msi /quiet ...)` 后立即 `std::process::exit(0)`——msiexec 以非提权用户身份静默运行，per-machine MSI 必须提权，静默模式不弹 UAC 直接失败，应用已退出无法感知。
- NSIS(exe) 链路健康：静默 `/S` 更新免提权、自动装回原位置、`nsis-hooks.nsh` 保留 shell.db。**不动。**

## 方案（与用户确认定稿）

按安装类型运行时分流（依据 `tauri::utils::platform::bundle_type()`，打包时烙入 exe 的标记，可靠）：

| 安装类型 | 更新流程 |
|---|---|
| NSIS(exe) | 保持现状：`downloadAndInstall()` 静默安装 → 自动重启，用户无感知 |
| MSI | `update.download()` 只下载 → 下载完成显示提示卡片 → **用户点击后**唤起 MSI 完整安装向导（等同双击 .msi，用户可自选目录、走 UAC）→ 用户自行完成安装并手动启动新版 |

## 变更清单

1. **删除 `app/src-tauri/wix-preserve-install-dir.wxs`**，并移除 `tauri.conf.json` 中 `bundle.windows.wix.fragmentPaths` 引用（保留 `upgradeCode`）。根治 2503。
   - 已知取舍（用户已接受）：MSI 自定义安装路径的记忆功能随之移除；但新流程走完整向导，用户可在向导中自行选目录，实际无损。
2. **Rust 端**：暴露安装类型给前端（已有 `get_install_type` command，确认可用）；新增/复用 command 用系统方式打开已下载的 .msi 文件（唤起安装向导）。
3. **前端 `app/src/stores/updater.ts`**：
   - 安装类型为 `msi` 时：改走 `update.download()`（只下载不安装），新增状态如 `downloadedManualInstall`；
   - 新增 action：用户点击 → 调用打开 .msi → 提示"请完成安装后启动新版本"；
   - 非 msi：逻辑不变。
4. **UI（SettingsPage / StatusBar 的更新入口）**：MSI 分支的下载完成提示卡片与文案（终态，不再有"安装中→自动重启"）。视觉细节由 han 定夺。
5. **`nsis-hooks.nsh`、`installMode: "quiet"`、CI release.yml 均不动**（quiet 此后仅 NSIS 走到）。

## 验收标准

- [ ] 构建产物 MSI 内不再含 VBScript custom action（可用 msiexec 日志或 orca 验证 CustomAction 表）
- [ ] Windows MSI 安装的应用：程序内更新 → 下载完成出现提示 → 点击唤起安装向导 → 安装成功为新版本
- [ ] Windows NSIS 安装的应用：程序内更新行为与现状一致（静默 + 自动重启）
- [ ] macOS 更新流程回归无变化
- [ ] `cargo check` / 前端 tsc 通过；`msi_install_location_args` 相关既有测试处理妥当（若逻辑仍被 NSIS→无关，评估是否保留 `configure_windows_updater_builder`）

## 风险与迁移

- 存量 MSI 用户（含 v0.2.8~v0.3.0 装上的）：下一次更新即走新流程，无需迁移动作。
- 存量 v0.3.0 MSI 用户当前无法自动更新（旧版 quiet 缺陷仍在他们机器上）：需在发布说明中引导手动下载 v0.3.1 安装一次。
