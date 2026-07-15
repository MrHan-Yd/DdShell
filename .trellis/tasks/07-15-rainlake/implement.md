# 实施计划：Rainlake 主题

1. 加载前端主题规范。
2. 注册主题并添加 i18n、设置卡片、预览和入口。
3. 从 Rainlake 原型生成 scoped tokens 和应用变量桥接。
4. 从 Inkpaper 成品生成其余完整样式文件并映射 Rainlake 配色。
5. 对比 377 类结构模板并检查关键应用状态。
6. 运行生产构建、测试、残留搜索和 diff 检查。

## 验证命令

- `pnpm --dir app build`
- `pnpm --dir app test:predictive-echo`
- 类集合对比
- 关键类和旧主题残留检查
- `git diff --check`
