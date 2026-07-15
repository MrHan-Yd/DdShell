# PRD：新增「星云尘埃 / Nebula Dust」主题

## 背景

设计稿位于 `ui/ui-nebula-dust/`，包含 `DESIGN.md`、完整 HTML 原型、双模式设计令牌和页面 CSS。

主题定位为低饱和、克制的深空工具主题：以黑紫和暗蓝作为大面积背景，以雾紫、粉橙和银蓝作为低亮星尘高光。它应与高饱和、流动感更强的 Aurora 主题保持明显区别。

## 目标

将设计稿落地为应用内可选主题：

- 主题 ID：`nebula-dust`
- 中文名：`星云尘埃`
- 英文名：`Nebula Dust`
- 支持暗色、亮色和跟随系统模式
- 接入方式对齐现有 `mossline` / `lumenreef` 设计系统主题

## 已确认事实

- `ui/ui-nebula-dust/styles/tokens.css` 已提供暗色和亮色令牌。
- 设计稿已提供 `base.css`、`components.css`、`layout.css`。
- 设计稿已提供 Settings、Connections、Terminal、SFTP 页面样式。
- 设计稿另外提供 Monitor、Snippets、Workflows、Quick Edit 等页面样式。
- 当前应用主题入口结构固定导入 Settings、Connections、Terminal、SFTP 四个页面文件，并通过 `app-overrides.css` 适配现有 React 类名。
- 应用通用逻辑会将当前主题写入 `<html data-ui-theme="...">`，不需要为新主题修改主题应用机制或 Rust 后端。

## 功能要求

### 接入层

1. 在 `UI_THEMES` 注册 `nebula-dust`，并将其纳入设计系统主题判断。
2. 添加主题中英文名称和描述。
3. 在设置页添加当前主题名称映射和主题选择卡片。
4. 添加符合黑紫、暗蓝、雾紫和粉橙视觉的主题预览卡片。
5. 在应用入口导入 `nebula-dust-index.css`。

### 样式层

创建以下主题结构：

```text
app/src/styles/nebula-dust-index.css
app/src/styles/nebula-dust/
├── tokens.css
├── base.css
├── components.css
├── layout.css
├── pages/
│   ├── settings.css
│   ├── connections.css
│   ├── terminal.css
│   └── sftp.css
└── app-overrides.css
```

- 原型 CSS 选择器必须作用域化到 `[data-ui-theme="nebula-dust"]`。
- 暗色和亮色变量必须映射到现有 React/Tailwind token 名称。
- `app-overrides.css` 参考 Mossline/Lumenreef 的现有适配点，使用 Nebula Dust 配色和材质。
- 不得污染其他主题。

## 验收标准

- 设置页出现“星云尘埃 / Nebula Dust”主题卡片及正确预览。
- 保存后主题可持久化，重新启动或重新加载后仍可正确恢复。
- 暗色、亮色和跟随系统均正常。
- 设置、连接、终端、SFTP 页面正确应用主题。
- 经典主题和其他设计系统主题不受影响。
- lint、type-check、相关测试和构建检查通过。

## 确认范围

严格对齐提交 `707e88bb` 的 Mossline 主题接入方式：

- 修改相同的 5 个现有接入文件。
- 新增相同结构的主题入口和样式目录。
- 只移植 Settings、Connections、Terminal、SFTP 四个主题标准页面。
- 不因为设计稿还包含其他页面而扩大本次范围。

## 非目标

- 不修改 Logo 或品牌资源。
- 不改变主题持久化协议和后端设置结构。
- 不调整其他主题的视觉。
- 不单独移植 Monitor、Snippets、Workflows、Quick Edit 页面样式。
