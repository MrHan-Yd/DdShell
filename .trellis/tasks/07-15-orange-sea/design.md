# 技术设计：Orange Sea 主题

## 结构模板

使用当前 `app/src/styles/inkpaper/`（对应 `afef4487`）作为 base/components/layout/pages/app-overrides 的结构权威。Orange Sea 与 Inkpaper 原型属于同一代，页面结构基本一致。

## 配色映射

- 朱砂红 → 日落橘 `#F47C3C`
- 矿物蓝 → 海面青 `#2D9BA3`
- 宣纸暖白 → 暖白 `#FFF7EA`
- 墨黑表面 → 深海蓝 `#0D2734`
- 浅色墨字 → 深海文本 `#10233A`

Tokens 从 Orange Sea 原型移植并增加应用变量桥接；非 token 文件复用完整结构模板，将主题 ID、注释和硬编码调色值替换为 Orange Sea 值。

## 兼容性

- 终端在亮色模式下继续使用深色终端 tokens。
- 主题选择只在保存成功后提交到全局状态。
- 主窗口和 Quick Edit 继续使用通用 `isUiTheme()` 加载逻辑。
