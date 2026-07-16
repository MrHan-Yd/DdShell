# 青瓷主题实施计划

1. 加载前端规范并检查主题注册、设置卡片、i18n 和 CSS 入口的当前结构。
2. 新增 `celadon` CSS 入口与完整目录结构。
3. 将青瓷原型令牌映射到应用令牌，补充瓷面背景与开片纹理。
4. 以完整主题选择器集为基线生成 base/components/layout/settings/connections/terminal/sftp/app-overrides，并替换为青瓷作用域。
5. 更新主题类型、合法值校验、入口导入、设置卡片、当前主题映射和中英文文案。
6. 对比完整主题文件集、选择器集合和关键状态，清除旧主题名称及配色残留。
7. 运行 `pnpm --dir app build`、相关测试、CSS/选择器检查和 `git diff --check`。

## 高风险文件

- `app/src/features/settings/SettingsPage.tsx`：主题列表和嵌套当前主题名称映射容易漏项。
- `app/src/stores/app.ts`：主题联合类型与合法值校验必须同步。
- `app/src/styles/celadon/tokens.css`：需要同时满足原型视觉、应用令牌桥接和双模式行为。

## 验证命令

- `pnpm --dir app build`
- `pnpm --dir app test:predictive-echo`
- `git diff --check`
- 使用 `rg` 检查 celadon 文件中的旧主题名和未限定选择器。
- 对比 `celadon` 与 `umbra` 的文件集合、CSS 类选择器和关键页面选择器。
