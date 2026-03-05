# Architecture

## 1. 总体架构
- 桌面容器：`Tauri 2`
- 前端：`React + TypeScript + Vite`
- 核心能力层：`Rust`
- 通信：Tauri command（请求响应）+ Event（状态推送）

## 2. 模块划分
### 前端
- `app-shell`：主框架、导航、窗口布局。
- `connections`：连接列表、编辑器、分组与搜索。
- `terminal`：xterm 实例、标签、分屏、快捷键。
- `sftp`：双栏文件面板、任务队列、状态反馈。
- `settings`：主题、快捷键、终端配置。

### Rust
- `core::ssh`：连接管理、认证、会话生命周期。
- `core::sftp`：目录读取、传输任务、重试。
- `core::secret`：keyring 读写。
- `core::store`：SQLite 数据访问。
- `core::event`：事件总线与订阅分发。

## 3. 核心数据流
- 连接流程：UI 发起连接 -> Rust 认证握手 -> 返回会话 ID -> 事件推送状态。
- 传输流程：UI 创建任务 -> Rust 执行传输 -> 周期上报进度 -> 完成/失败。

## 4. 跨平台兼容策略
- 路径：统一内部标准路径模型，UI 按平台渲染。
- 快捷键：统一动作映射，平台层做 keymap 适配。
- 字体与窗口效果：按平台提供默认值和降级策略。

