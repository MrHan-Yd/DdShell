# 技术设计：按 afef4487 补齐 Nebula Dust

## 权威模板

- 结构模板：提交 `afef4487` 的 `app/src/styles/inkpaper/` 成品。
- 配色来源：`ui/ui-nebula-dust/styles/tokens.css` 及现有 Nebula tokens。
- 接入层：保持 `f84b8c1` 已完成内容。

## 重建策略

1. 保留现有 `nebula-dust/tokens.css`，因为其暗亮主题变量和应用 token 桥接已正确。
2. 以 Inkpaper 成品重建 base、components、layout、四个 pages 和 app-overrides。
3. 将作用域 `inkpaper` 替换为 `nebula-dust`，更新文件头注释。
4. 将 Inkpaper 硬编码调色值映射到 Nebula Dust：
   - 朱砂红 → 粉橙星尘
   - 矿物蓝 → 雾紫/银蓝
   - 宣纸白/墨黑表面 → 星白/深空黑紫
5. 保持使用 CSS 变量的结构声明不变，避免重新发明真实 DOM 适配。

## 风险控制

- 搜索 Inkpaper 主题 ID、名称和纸色调色值残留。
- 比较完整类名集合，确保缺失的真实功能类已补齐。
- 检查 unscoped 设置布局规则与 Inkpaper 模板一致，避免产生新的全局差异。
- 生产构建解析完整 CSS bundle。
