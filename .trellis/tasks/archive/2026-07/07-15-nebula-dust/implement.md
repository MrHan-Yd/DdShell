# 实施计划：Nebula Dust 主题

1. 加载前端开发规范并核对 Mossline 成品结构。
2. 在主题类型、设计系统判断、国际化、设置页、预览和入口中接入 `nebula-dust`。
3. 将设计稿 tokens/base/components/layout 和四个页面 CSS 转为主题作用域文件。
4. 基于 Mossline `app-overrides.css` 创建 Nebula Dust 应用适配层。
5. 核对作用域、暗亮模式、选择器数量和入口导入顺序。
6. 运行 lint、type-check、测试与构建检查；修复发现的问题。

## 风险点

- 自动作用域转换遗漏逗号选择器或误处理 `@keyframes`。
- 原型变量未桥接到应用现有 `--color-*` 变量。
- app-overrides 仍残留 Mossline 颜色或主题 ID。
- 设置页显示映射、合法值注册、设计系统分支三者不一致。

## 验证命令

- 使用项目脚本执行 lint / type-check / tests。
- 对 `nebula-dust` 目录运行选择器和旧主题 ID 残留检查。
- 对比 Mossline 文件结构和导入顺序。
