# 执行计划

## 步骤

1. 读取任务文档和前后端规范。
2. 扩展 `CrLfNormalizer`，记录当前行可见文本状态。
3. 添加 bare CR + bracket prompt 覆盖场景测试，包含跨 chunk。
4. 复查前端仍无启动 CPR 写入。
5. 运行构建、Rust check、Rust tests。
6. 如有必要，同步更新 `.trellis/spec/backend/quality-guidelines.md`。

## 验证命令

```bash
rg "\\\\x1b\\[6n|CPR probe" app/src/features/terminal/TerminalPage.tsx
pnpm -C app build
cargo check --manifest-path app/src-tauri/Cargo.toml
cargo test --manifest-path app/src-tauri/Cargo.toml
```
