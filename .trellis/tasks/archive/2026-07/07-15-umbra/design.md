# 技术设计：Umbra 主题

## 结构模板

使用 `app/src/styles/rainlake/` 作为 base/components/layout/pages/app-overrides 的结构权威。该目录已与 Inkpaper 完整模板保持 377 个类选择器一致，并包含真实 React DOM 与交互状态映射。

## 配色映射

- 雨夜冷青 `#62CDE0` → 月铜边缘光 `#C5724C`
- 青紫霓光 `#A27CFF` → 本影暗红 `#8E2F2C`
- 雨白 `#EEF6FA` → 冷暖月白 `#F0ECE6`
- 深蓝黑 `#0A1220` → 深棕黑 `#0B090C`
- 浅色湖面深蓝 `#07192A` → 月蚀深褐 `#130807`

Umbra 原型 tokens 与 Rainlake 原型 tokens 结构一致。先将原型 tokens 转为应用主题作用域并补齐变量桥接，再以完整模板生成其余样式文件，替换主题 ID、注释和 Rainlake 硬编码调色值。

## 兼容性

- 亮色模式继续使用深色终端 tokens。
- 复用通用主题持久化、`isUiTheme()` 校验、设计系统组件分支和文档边界属性。
- 不改变现有主题顺序之外的业务逻辑；Umbra 追加在主题列表末尾。
