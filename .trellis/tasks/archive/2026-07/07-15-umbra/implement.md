# 实施计划：Umbra 主题

1. 加载前端主题规范和完整主题结构契约。
2. 注册 `umbra` 并添加 i18n、设置卡片、预览和 CSS 入口。
3. 从 Umbra 原型生成 scoped tokens 和应用变量桥接。
4. 从 Rainlake 完整成品生成其余样式文件并映射 Umbra 配色。
5. 对比 377 类结构模板并检查关键应用状态。
6. 运行生产构建、测试、旧主题残留搜索和 diff 检查。

## 验证命令

- `pnpm --dir app build`
- `pnpm --dir app test:predictive-echo`
- Rainlake/Umbra 类集合对比
- 关键类、硬编码主题判断和旧主题残留检查
- `git diff --check`

## 风险与回滚点

- 调色值替换必须覆盖深浅模式与应用 override 中的硬编码颜色，避免残留 Rainlake 蓝青色。
- 主题注册、设置选项和 CSS import 必须同时存在，否则持久化值可能有效但界面不完整。
