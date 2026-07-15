# Journal - han (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-06-28

---



## Session 57: 修复路径收藏下拉贴边

**Date**: 2026-06-28
**Task**: 修复路径收藏下拉贴边
**Branch**: `main`

### Summary

确认 Aurora 全局 button reset 覆盖了路径收藏下拉按钮行 padding，改为 SFTP 页面级具名 class 规则并补充前端规范。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ba2b030` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 58: 修复终端底部黑边

**Date**: 2026-06-28
**Task**: 修复终端底部黑边
**Branch**: `main`

### Summary

同步 xterm surface 和终端 pane 父容器背景，避免 xterm 行高舍入露出不同颜色底边，并记录前端规范。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f490dcf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 59: 修复重连遮罩终端边框

**Date**: 2026-06-28
**Task**: 修复重连遮罩终端边框
**Branch**: `main`

### Summary

提高活动终端边框层级，避免断连/重新连接遮罩盖住下方和侧边边框；补充终端内部 overlay 不应盖住 active outline 的前端规范。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2615bb2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 60: 实现会话无操作超时

**Date**: 2026-06-28
**Task**: 实现会话无操作超时
**Branch**: `main`

### Summary

为终端 SSH session 增加后端应用层 idle watchdog，按 session.keepAlive 主动断开无操作会话；用户输入、resize、SFTP 操作和传输进度刷新活动时间，远端输出和 SSH keepalive 不算用户活动。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f81da38` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 61: 修复状态栏心跳续期会话

**Date**: 2026-06-29
**Task**: 修复状态栏心跳续期会话
**Branch**: `main`

### Summary

定位状态栏每 5 秒 sshPing 刷新会话 activity，移除 ssh_ping 的 touch_activity，避免 latency 心跳让 30 秒 idle timeout 永远无法触发。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `66277c5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 62: 发布 v0.2.7

**Date**: 2026-06-29
**Task**: 发布 v0.2.7
**Branch**: `main`

### Summary

发布 DdShell v0.2.7，版本说明基于 v0.2.6..HEAD 提交记录生成；更新版本号、README、发布说明、Release 文案和发布文档，并推送 v0.2.7 tag 触发 GitHub Actions。用户将自行查看远端打包结果。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0ba3b3c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 63: 修复 SSH 终端回车显示 ^M

**Date**: 2026-06-29
**Task**: 修复 SSH 终端回车显示 ^M
**Branch**: `main`

### Summary

修复 SSH PTY 默认输入模式，启用 ICRNL 让 xterm 回车在远端按标准行输入提交；补充回归测试和后端规范，并归档任务 06-29-fix-db-enter-key。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b074883` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 64: 修复 Windows 更新数据丢失

**Date**: 2026-06-29
**Task**: 修复 Windows 更新数据丢失
**Branch**: `main`

### Summary

修复 Windows in-app update 跨安装器类型和安装目录数据丢失问题：发布清单区分 NSIS/MSI，Windows updater quiet 安装，NSIS 保护 shell.db*，MSI 固定 upgradeCode，并更新发布验证规范。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `83a3a95` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 65: 修复 MSI 更新继承原安装路径

**Date**: 2026-06-29
**Task**: 修复 MSI 更新继承原安装路径
**Branch**: `main`

### Summary

实现 Windows MSI 更新继承原安装目录：运行时为 MSI updater 注入 APPLICATIONFOLDER/INSTALLDIR，新增 WiX first-upgrade fallback 读取相关产品安装位置和注册表，并更新发布验证与后端质量规范。验证通过 cargo check、cargo test、pnpm build、tauri build --no-bundle。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c195de0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 66: Terminal selection actions and session lifecycle fixes

**Date**: 2026-06-30
**Task**: Terminal selection actions and session lifecycle fixes
**Branch**: `main`

### Summary

Added terminal selection quick actions, fixed top-edge popover placement, prevented connection loading shadow bleed, and kept terminal sessions alive while the terminal page is foregrounded.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `709092a` | (see git log) |
| `ee62195` | (see git log) |
| `f452a9a` | (see git log) |
| `0aa911e` | (see git log) |
| `a160e43` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 67: 发布 v0.2.8 与终端工具栏图标

**Date**: 2026-06-30
**Task**: 发布 v0.2.8 与终端工具栏图标
**Branch**: `main`

### Summary

完成 v0.2.8 版本提交并补推 tag 触发 Release workflow；调整终端工具栏分屏图标为上下/左右分屏图标，历史记录入口改为仅图标显示。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ea0cdd1` | (see git log) |
| `798722b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 68: 终端分屏按钮顺序调整

**Date**: 2026-06-30
**Task**: 终端分屏按钮顺序调整
**Branch**: `main`

### Summary

将终端右上角两个分屏按钮的显示顺序调整为先左右分屏、后上下分屏，保留原有功能、激活态、tooltip 和快捷键说明。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d96d7f8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 69: 终端面板显示服务器延迟

**Date**: 2026-06-30
**Task**: 终端面板显示服务器延迟
**Branch**: `main`

### Summary

将终端 pane 顶栏右侧连接状态改为服务器延迟显示；为可见 pane 会话刷新 latencyMap，保持自动 ping 不触发 session activity。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `331e516` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 70: 底部状态栏隐藏延迟

**Date**: 2026-06-30
**Task**: 底部状态栏隐藏延迟
**Branch**: `main`

### Summary

移除底部状态栏会话数量旁的延迟显示，保留终端 pane 顶栏延迟。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3605af4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 71: 新增珊光主题

**Date**: 2026-07-05
**Task**: 新增珊光主题
**Branch**: `main`

### Summary

新增珊光主题并修正设置控件、连接管理、终端、SFTP 等真实组件样式对齐问题。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7b940d8` | (see git log) |
| `12e7ad5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 72: 新增竹影主题（mossline）

**Date**: 2026-07-15
**Task**: 新增竹影主题（mossline）
**Branch**: `main`

### Summary

从 ui/ui-mossline 设计稿落地竹影主题：接入层 5 文件（UI_THEMES/i18n/SettingsPage/预览卡/main 导入），样式层 10 文件（设计稿加作用域移植 + lumenreef 应用桥接层换色移植：tokens Bridge 块、mon-* 规则、settings 对齐段）。修复泛光雾刺眼：高光色相由竹叶露光校正为中性冷白，shell-overlay opacity 降至 0.55、bg-image 光晕减半。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `707e88b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 73: 新增星云尘埃主题

**Date**: 2026-07-15
**Task**: 新增星云尘埃主题
**Branch**: `main`

### Summary

按 707e88bb 的主题接入结构，将 ui-nebula-dust 落地为支持暗亮模式的 Nebula Dust 主题，完成设置入口、预览、分层 CSS、应用覆盖与质量验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f84b8c1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
