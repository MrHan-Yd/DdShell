# PRD：设计「青瓷 / Celadon」主题原型

## 背景

用户从一组与现有主题差异化的方向中选择了第 2 项「青瓷」。当前仓库的静态主题设计稿位于 `ui/ui-<theme>/`，每套完整原型包含首页、八个核心业务页面、双主题 tokens、通用样式、页面样式和双版本 Logo。

## 目标

- 新增静态设计目录：`ui/ui-celadon/`
- 中文名：`青瓷`
- 英文名：`Celadon`
- 形成一套清冷、浅色优先、带瓷釉与稀疏开片纹理的工具型主题
- 与云岚、墨纸、竹影等现有浅色或绿色主题保持明显差异

## 视觉要求

- 以瓷白、淡青釉、灰绿釉影和墨青作为主要色阶。
- 浅色模式是主展示面；暗色模式使用窑夜墨青和低亮青釉，不直接反相。
- 组件表面像薄釉瓷面：细边、柔和内高光、克制阴影，避免玻璃霓虹感。
- 使用稀疏、不规则、低对比的开片裂纹作为首页、Logo 与少量装饰纹理；不能做成蓝栅的规则网格。
- 主交互色使用较深的釉青，少量温润釉金只用于 warning、状态区分和 Logo 点睛。
- Logo 保留双 D 厚实骨架，内部使用极简开片纹路和釉面高光。

## 页面范围

原型必须包含：

- `index.html`
- `connections.html`
- `terminal.html`
- `sftp.html`
- `monitor.html`
- `snippets.html`
- `workflows.html`
- `quick-edit.html`
- `settings.html`
- `DESIGN.md`
- `assets/logo-v2.svg`
- `assets/logo-v2-dark.svg`
- `styles/` 下完整 tokens、base、components、layout 与页面样式

## 结构约束

- 以 `ui/ui-cloudrift/` 作为完整浅色原型结构模板，保留页面信息密度和交互演示。
- 只修改 `ui/ui-celadon/` 与当前 Trellis 任务文件，不接入 `app/src/`。
- 保留深浅主题切换脚本，默认使用浅色模式。
- 原型不得引用 Cloudrift 名称、云层文案或旧主题专属颜色。

## 验收标准

- `ui/ui-celadon/` 文件结构与完整参考原型一致。
- 九个 HTML 页面都能加载共享 CSS、页面 CSS 和主题切换逻辑。
- 首页能清楚表达瓷釉、开片、墨青与釉金的视觉语言。
- 双版本 Logo 均为有效 SVG，且与主题配色一致。
- 残留搜索中没有 `Cloudrift`、`云岚` 或云层专属文案。
- HTML/CSS/SVG 引用路径完整，`git diff --check` 通过。

## 非目标

- 本轮不注册应用主题、不修改 React、i18n 或 `app/src/styles/`。
- 不新增真实业务功能。
- 不生成位图素材。

## 开放问题

无。用户已选择「青瓷」，其余视觉细节按上述推荐方向执行。
