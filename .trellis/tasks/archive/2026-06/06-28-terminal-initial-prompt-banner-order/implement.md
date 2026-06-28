# 执行计划

## 步骤

1. 读取前端/后端质量规范和共享思考指南。
2. 在 `app/src-tauri/src/lib.rs` 中实现有状态 CRLF 归一化器，并在 `output_reader_loop` 内按 session 持有。
3. 为跨 chunk `\r\r\n` 添加 Rust 单元测试。
4. 移除 `TerminalPage.tsx` 首次连接固定 CPR 注入，更新注释。
5. 搜索确认前端不再启动期写入 `\x1b[6n`。
6. 运行前端构建、Rust check、Rust test。

## 验证命令

```bash
rg "\\\\x1b\\[6n|CPR probe" app/src/features/terminal/TerminalPage.tsx
pnpm -C app build
cargo check --manifest-path app/src-tauri/Cargo.toml
cargo test --manifest-path app/src-tauri/Cargo.toml
```

## 回滚点

如果预测回显功能出现不可接受退化，可保留后端 CR 修复，并另行设计“本地 CPR 查询且不转发到远端”的实现。
