# PRD：新增「月蚀 / Umbra」主题

## 背景

设计稿位于 `ui/ui-umbra/`。主题以近黑夜空、暗红本影和月铜色边缘光表现克制的月蚀视觉，提供暗色与亮色两套 tokens。

## 目标

- 主题 ID：`umbra`
- 中文名：`月蚀`
- 英文名：`Umbra`
- 支持暗色、亮色和跟随系统
- 按 `afef4487` 与已完成 Rainlake 主题的完整 React 映射方式落地

## 接入范围

修改主题注册、i18n、设置页、主题预览和应用入口，并新增标准主题目录：tokens、base、components、layout、settings/connections/terminal/sftp 和 app-overrides。

## 样式要求

- 使用当前 `app/src/styles/rainlake/`（源自 Inkpaper/`afef4487`）作为完整结构模板。
- 使用 `ui/ui-umbra/styles/tokens.css` 和 `DESIGN.md` 作为视觉与配色来源。
- 完整覆盖设置骨架、Connections、SFTP path tools/transfer drawer、Terminal split/selection 及应用专属控件状态。
- 主题专属规则作用域为 `[data-ui-theme="umbra"]`。
- 保持近黑背景为主，暗红和铜橙只用于边缘光、焦点与关键操作，不做大面积高饱和红色铺底。
- 保留模板中共享的设置页布局规则。

## 验收标准

- 设置页出现“月蚀 / Umbra”及符合设计稿的主题预览。
- 主题可保存、恢复，主窗口与 Quick Edit 使用统一主题边界。
- 暗色、亮色和跟随系统正常。
- 与完整结构模板的类选择器集合一致，关键应用状态无缺失。
- 生产构建、现有前端测试、残留搜索和 `git diff --check` 通过。

## 非目标

- 不新增设计稿中的业务功能。
- 不单独移植 Monitor、Snippets、Workflows、Quick Edit 页面原型。
- 不修改 Logo 资源或品牌逻辑。

## 开放问题

无。用户已要求按前序新主题的完整接入方式实现 `ui-umbra`。
