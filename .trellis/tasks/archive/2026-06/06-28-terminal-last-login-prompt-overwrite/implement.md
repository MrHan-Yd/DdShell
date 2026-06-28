# 执行计划

1. 读取任务文档和后端规范。
2. 扩展 `CrLfNormalizer`，支持 CR 后 ANSI 控制序列再接 bracket prompt。
3. 增加 in-chunk 和 cross-chunk 回归测试。
4. 运行：

```bash
pnpm -C app build
cargo check --manifest-path app/src-tauri/Cargo.toml
cargo test --manifest-path app/src-tauri/Cargo.toml
```

5. 复查规范是否需要补充。
