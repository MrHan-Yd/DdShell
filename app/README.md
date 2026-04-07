# DdShell App

`app/` 是 DdShell 的桌面应用工程，技术栈为 Tauri 2 + React 19 + TypeScript + Rust。

## 目录

- `src/`: React 前端
- `src-tauri/`: Tauri Rust 后端
- `public/`: 静态资源
- `docs/`: 前端补充文档

## 已有功能原型

- 连接管理与分组
- SSH 会话、多标签、分屏
- SFTP 双栏与传输队列
- 系统监控页
- Snippets 管理
- 终端主题、背景、字体、颜色设置
- 命令提示与命令历史

## 开发环境

- Node.js
- `pnpm`
- Rust toolchain
- Tauri 2 依赖环境

## 常用命令

在 `app/` 目录执行：

```bash
pnpm install
pnpm dev
pnpm tauri dev
pnpm build
pnpm tauri build
```

## 说明

- `pnpm dev` 只启动前端开发服务器
- `pnpm tauri dev` 启动完整桌面应用开发模式
- 状态说明和 FR 对齐信息请查看 `../shell/docs/01-PRODUCT/FEATURE-STATUS.md`
