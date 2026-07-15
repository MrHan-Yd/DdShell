# 实施计划：补齐 Nebula Dust 样式映射

1. 加载前端开发规范。
2. 从 Inkpaper 成品模板重建 Nebula 的 base/components/layout/pages/app-overrides。
3. 应用 Nebula 主题 ID、注释和硬编码调色映射。
4. 重新加入禁用主按钮无外发光的质量保护。
5. 对比 Inkpaper/Nebula 类集合，检查关键缺失类。
6. 搜索 Inkpaper/Mossline 和旧调色值残留。
7. 运行构建、测试和 diff 检查。

## 验证命令

- `pnpm --dir app build`
- `pnpm --dir app test:predictive-echo`
- 类集合差异检查
- 旧主题 ID / 调色值残留搜索
- `git diff --check`
