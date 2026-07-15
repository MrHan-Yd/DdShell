# 实施计划：Orange Sea 主题

1. 加载前端主题规范。
2. 注册 `orange-sea`、添加 i18n、设置卡片和主题预览。
3. 从 Orange Sea 原型创建 scoped tokens 和应用变量桥接。
4. 以 Inkpaper 成品重建其余 8 个样式文件并映射 Orange Sea 调色值。
5. 创建主题 index 并在 `main.tsx` 导入。
6. 对比结构模板类集合，检查关键应用类和旧主题残留。
7. 运行构建、测试和 diff 检查。

## 验证命令

- `pnpm --dir app build`
- `pnpm --dir app test:predictive-echo`
- 类集合对比
- 旧主题 ID / 调色值搜索
- `git diff --check`
