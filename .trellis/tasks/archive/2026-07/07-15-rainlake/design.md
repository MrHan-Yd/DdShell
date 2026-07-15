# 技术设计：Rainlake 主题

## 结构模板

使用当前 `app/src/styles/inkpaper/` 作为 base/components/layout/pages/app-overrides 的结构权威，以保证真实 React DOM 和交互状态完整。

## 配色映射

- 朱砂主强调 → 雨夜冷青 `#62CDE0`
- 矿物蓝辅助 → 青紫 `#A27CFF`
- 宣纸暖白 → 雨白 `#EEF6FA`
- 墨黑表面 → 深蓝黑 `#0A1220`
- 浅色墨字 → 湖面深蓝 `#07192A`

Rainlake 原型 tokens 经主题作用域转换后增加应用变量桥接；其余样式文件从完整模板生成并替换主题 ID、注释及硬编码调色值。

## 兼容性

- 亮色模式仍使用深色终端 tokens。
- 继续复用通用主题持久化、`isUiTheme()` 校验和文档边界属性。
