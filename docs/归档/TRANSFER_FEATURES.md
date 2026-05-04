# 传输配置实现文档

## 概述

本文档记录传输配置功能的实现情况。

## 已实现的配置项

| 配置项 | 设置 key | 默认值 | 状态 |
|--------|----------|--------|------|
| 传输块大小 | `transfer.chunkSize` | 256 | ✅ 已实现 |
| 最大并发传输数 | `transfer.maxConcurrent` | 1 | ✅ 已实现 |
| 传输超时 | `transfer.timeout` | 300 | ✅ 已实现 |
| 自动重试次数 | `transfer.retryCount` | 3 | ✅ 已实现 |
| 下载保存路径 | `transfer.downloadPath` | 系统下载目录 | ✅ 已实现 |
| 传输完成通知 | `transfer.notify` | true | ✅ 已实现 |

## 实现细节

### 1. 传输块大小 (transfer.chunkSize)

**文件**: `app/src-tauri/src/core/sftp.rs`

在 `execute_upload` 和 `execute_download` 函数中使用，控制每次读写的数据块大小。

### 2. 最大并发传输数 (transfer.maxConcurrent)

**文件**: `app/src-tauri/src/lib.rs`

使用 `tokio::sync::Semaphore` 控制同时传输的文件数量：
- 从设置读取最大并发数
- 使用信号量限制同时执行的任务数
- 任务完成后自动释放许可

### 3. 传输超时 (transfer.timeout)

**文件**: `app/src-tauri/src/core/sftp.rs`

使用 `tokio::time::timeout` 实现超时检测：
- 上传：每个 chunk 写入操作都有超时检测
- 下载：每次读取操作有超时检测
- 超时后标记任务失败并返回错误

### 4. 自动重试次数 (transfer.retryCount)

**文件**: `app/src-tauri/src/lib.rs`

传输失败后根据设置自动重试：
- 重试间隔：2 秒
- 重试逻辑：`while attempts <= retry_count`
- 所有重试都失败后标记任务为失败状态

### 5. 下载保存路径 (transfer.downloadPath)

**文件**: `app/src-tauri/src/lib.rs`

当用户未指定保存路径时：
- 优先使用设置中的 `transfer.downloadPath`
- 如果设置为空，使用系统默认下载目录
- 自动组合路径和文件名

### 6. 传输完成通知 (transfer.notify)

**文件**: `app/src-tauri/src/lib.rs`

使用 `tauri-plugin-notification` 发送系统通知：
- 传输完成时显示系统通知
- 通知内容：文件名 + 传输方向 + 状态

## 相关代码位置

- 前端设置页面: `app/src/features/settings/SettingsPage.tsx`
- i18n 翻译: `app/src/lib/i18n.ts`
- 后端传输逻辑: `app/src-tauri/src/core/sftp.rs`
- 后端命令入口: `app/src-tauri/src/lib.rs`
- 通知插件配置: `app/src-tauri/capabilities/default.json`

## 已移除的功能

- 传输限速：个人使用场景下不需要，已移除
