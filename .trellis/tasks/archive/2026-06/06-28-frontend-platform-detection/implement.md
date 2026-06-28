# 执行计划

## 步骤

1. 读取前端规范和共享规范。
2. 新增 `app/src/lib/platform.ts`。
3. 替换四处直接 `navigator.platform` 调用为 `isMacPlatform()`。
4. 搜索确认 `app/src` 中不再有散落平台兼容字符串读取。
5. 运行前端构建、Rust 检查和测试。
6. 如有必要，更新 `.trellis/spec/` 中的平台判断约定。

## 验证命令

```bash
rg -n "navigator\\.platform|navigator\\.userAgent" app/src
pnpm -C app build
cargo check --manifest-path app/src-tauri/Cargo.toml
cargo test --manifest-path app/src-tauri/Cargo.toml
```

## 风险点

- `useShortcuts.ts` 是热键路径，必须保持同步判断。
- `Titlebar.tsx` 影响窗口控制显示，必须保持 macOS 与非 macOS 分支不变。

## 回滚点

如果验证发现平台行为变化，回退 helper 替换，恢复原文件内常量判断。
