# v0.3.0 发布实施计划

1. 核对发布文档、远端 main、现有 tag、Secrets 和 `v0.2.9..HEAD` 变更范围。
2. 更新四处版本号、Release workflow 正文、README 链接和 v0.3.0 版本介绍。
3. 检查所有发布元数据一致，确保旧版文档未被改写。
4. 运行前端构建、预测回显测试、Rust 检查和 diff 检查。
5. 提交发布准备，提交信息为 `发布 v0.3.0`。
6. 推送 main，创建并推送 `v0.3.0` 标签。
7. 监控 Release workflow，修复任何失败并持续到构建完成。
8. 验证 Release 安装包、updater 签名和 `latest.json`。

## 验证命令

- `pnpm --dir app build`
- `pnpm --dir app test:predictive-echo`
- `cargo check --manifest-path app/src-tauri/Cargo.toml`
- `git diff --check`
- `rg '0\\.3\\.0|v0\\.3\\.0'` 检查发布文件
- `gh run view` 检查 workflow
- `gh release view v0.3.0` 检查资产

## 高风险操作

- `git push origin main`
- `git tag v0.3.0`
- `git push origin v0.3.0`

这些操作仅在发布准备提交和本地检查全部通过后执行。
