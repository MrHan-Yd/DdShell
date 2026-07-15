# PRD：新增「夜雨霓湖 / Rainlake」主题

## 背景

设计稿位于 `ui/ui-rainlake/`，主题以深蓝黑湖面、冷青、青紫和少量玫红反光表现低饱和城市雨夜，提供暗亮双模式 tokens。

## 目标

- 主题 ID：`rainlake`
- 中文名：`夜雨霓湖`
- 英文名：`Rainlake`
- 支持暗色、亮色和跟随系统
- 按 `afef4487` 的完整 React 主题映射方式落地

## 接入范围

修改主题注册、i18n、设置页、预览和应用入口 5 个现有文件，并新增标准主题目录：tokens、base、components、layout、settings/connections/terminal/sftp 和 app-overrides。

## 样式要求

- 使用 Inkpaper/`afef4487` 成品作为完整结构模板。
- 使用 `ui/ui-rainlake/styles/tokens.css` 作为配色来源。
- 完整覆盖设置骨架、SFTP path tools/transfer drawer、Terminal split/selection、Monitor session picker。
- 主题专属规则作用域为 `[data-ui-theme="rainlake"]`。
- 保留模板中共享的设置页布局规则。

## 验收标准

- 设置页出现“夜雨霓湖 / Rainlake”和正确预览。
- 主题可保存、恢复，主窗口与 Quick Edit 通用加载。
- 暗色、亮色和跟随系统正常。
- 与完整结构模板的类集合一致。
- 生产构建、现有测试、关键类检查和旧主题残留检查通过。

## 非目标

- 不新增设计稿中的业务功能。
- 不单独移植 Monitor、Snippets、Workflows、Quick Edit 页面原型。
- 不修改 Logo 资源或品牌逻辑。
