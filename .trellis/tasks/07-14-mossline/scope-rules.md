# Mossline 主题 CSS 移植 —— 作用域转换规则（子代理必读）

目标：把设计稿 `ui/ui-mossline/styles/` 下的 CSS 移植进应用 `app/src/styles/mossline/`，
方式与已存在的 `lumenreef` 主题**完全一致**。lumenreef 的成品文件是最权威的参照。

## 核心转换：给每条选择器加作用域前缀

设计稿里的每一条普通 CSS 规则，选择器都要加前缀 `[data-ui-theme="mossline"] `。
逗号分隔的选择器列表里**每一个**都要单独加前缀。

例：
```
.foo, .bar .baz { color: red; }
```
转换为：
```
[data-ui-theme="mossline"] .foo,
[data-ui-theme="mossline"] .bar .baz{ color: red; }
```

（注意 lumenreef 成品里 `{` 前的空格被压掉了，写成 `选择器{`；照抄这个风格即可，但不强制。）

## 特殊选择器（仅 base.css / tokens.css 出现）

严格对照 lumenreef 同名文件的写法，逐字模仿。已知映射：

- `*, *::before, *::after`
  → `[data-ui-theme="mossline"] *,\n[data-ui-theme="mossline"] *::before,\n[data-ui-theme="mossline"] *::after`
- `html, body`
  → `[data-ui-theme="mossline"] html,\nbody:has([data-ui-theme="mossline"]),\n[data-ui-theme="mossline"]`
- 单独的 `body`
  → `body:has([data-ui-theme="mossline"]),\n[data-ui-theme="mossline"]`

tokens.css 两个大块（严格对照 lumenreef/tokens.css 行 7-9 与 88-90）：
- 设计稿 `:root, .theme-dark {`
  → `[data-ui-theme="mossline"],\n[data-ui-theme="mossline"] body.theme-dark,\nbody.theme-dark [data-ui-theme="mossline"] {`
- 设计稿 `.theme-light {`
  → `[data-theme="light"][data-ui-theme="mossline"],\n[data-ui-theme="mossline"] body.theme-light,\nbody.theme-light [data-ui-theme="mossline"] {`
- 若设计稿 light 段末尾还有单独的 `.theme-light { ... }` 补充块，参照 lumenreef/tokens.css 行 262 `[data-theme="light"][data-ui-theme="mossline"] {`

## @ 规则

- `@keyframes name { ... }`：整块**原样保留**，动画名不加前缀（keyframe 内部的 `0% {}` 等也不动）。
  使用动画的选择器本身照常加前缀。
- `@media (...) { ... }`：`@media` 外壳保留，**内部**的选择器照常加 `[data-ui-theme="mossline"]` 前缀。
- `@font-face`：原样保留。
- CSS 变量定义、`var()`、颜色值、数值——**一律不改**，只改选择器。

## 文件头注释

每个文件第一行加：
`/* Auto-scoped Mossline CSS mapped from ui/ui-mossline/styles/<相对路径>. Do not edit ui/styles sources. */`
（pages 文件写成 `pages/xxx.css`）

## 铁律

1. 只做选择器作用域转换，**不改任何颜色、尺寸、属性值、声明顺序**。设计稿的视觉就是最终视觉。
2. 设计稿有多少条规则，输出就有多少条，不增不减不合并。
3. 完成后与 lumenreef 同名文件核对：作用域写法、@规则处理必须一致。
