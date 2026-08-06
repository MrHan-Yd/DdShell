# 主题 CSS layer 化(保序迁移,零视觉回归)

## 目标

把当前全部游离在 `@layer` 之外的 CSS(15 套主题 + styles.css 主体 + vendor xterm.css)纳入显式 layer 体系,消除"无层样式静默压过 Tailwind 工具类"这一不可见陷阱的结构性根源,同时**保证渲染结果与现状逐位一致**。

## 硬性约束(用户原话)

> 可以优化,但是不能把目前布局好的样式改坏了。

零视觉回归是验收红线。因此本任务采用**保序迁移**:不翻转任何优先级,主题在 layer 序中仍高于 utilities;所有现在"主题赢"的地方迁移后依然主题赢。

## 已确认事实

- 无层 CSS 三块:15 套主题(149 文件/5.8 万行,经 `main.tsx` JS import)、`styles.css` 主体(约 9,300 行,含 classic 主题与 xterm 覆盖)、vendor `@xterm/xterm/css/xterm.css`(285 行,经 `TerminalPage.tsx` import)。
- 级联规则:普通声明中无层 > 有层;**important 声明层序反转**(先声明的 layer 反而强,无层 important 弱于有层 important)。
- important 清单:styles.css 33 处(集中在 xterm 滚动条/背景)、各主题 settings.css 约 5 处、lumenreef/mossline components.css 各 2 处、vendor 2 处(opacity/font-size)、TSX 中 `!` 前缀工具类 5 处(WorkflowEditor `!px-6`、TerminalPage:2764 `!bg/!px/!py/!text`)。
- 经核对,vendor CSS 与应用 CSS 在「选择器×属性」上**零重叠**(应用侧 xterm 普通声明全是 `::-webkit-scrollbar` 伪元素和 `.terminal-xterm-surface`,vendor 均未定义);vendor 与主题的 important 也无属性交集。故 vendor 的层位自由,且 important 反转不改变任何现有胜负。
- TSX 的 `!` 工具类今天(有层 important > 无层 important)和迁移后(utilities 层先声明,important 反转后仍强于 ui-themes)都赢——胜负不变。
- 影子工具类(`.gap-1~4`/`.flex-1`/`.truncate` 等,15 套主题同值)**本任务不剥离**:它们随主题整体入层,内部相对顺序不变,行为逐位保留。剥离属于未来翻转阶段的前置,不属于本任务。
- `@import ... layer(...)` 是标准语法,Vite 的 CSS 管线支持解析(含 node_modules 包路径);Tailwind v4 自身生成 `@layer theme, base, components, utilities`,预声明只需保持这四个名字的相对顺序一致。
- CSS 规范要求 `@import` 位于所有规则之前,因此主题 import 不能追加在 styles.css 主体之后——必须把 styles.css 重构为纯编排文件。

## 方案

### 目标结构

`src/styles.css` 变为编排入口(约 30 行):

```css
@layer vendor, theme, base, components, utilities, app;
@import "tailwindcss";
@import "@xterm/xterm/css/xterm.css" layer(vendor);
@import "./styles/app.css" layer(app);
@import "./styles/aurora-index.css" layer(app);
/* …其余 14 套主题,保持 main.tsx 中原有顺序,全部 layer(app)… */
@theme { /* 原 @theme 块原样保留 */ }
```

- 原 styles.css 主体(去掉 `@import "tailwindcss"` 与 `@theme` 块后的全部内容)整体移入新文件 `src/styles/app.css`,内容零修改。
- `main.tsx` 删除 15 行主题 import;`TerminalPage.tsx` 删除 vendor xterm import(改由入口统一加载;该文件仅 285 行,打包位置变化无视觉影响)。
- **app 主体与 15 套主题共用同一 layer(app)**,不拆分。原因:跨 layer 后 specificity 不参与裁决,而今天 styles.css 与主题之间存在依赖 specificity 的胜负(如 `.term-main[data-file-manager-resizing] .terminal-xterm-surface{transition:none}` 以高特异性压主题);只有同层才能逐位保留"specificity + 源顺序"语义。未来翻转任务如需拆分主题层,须先做全量 specificity 交叉审计。
- 层序语义:`app` 高于 `utilities`,保持"应用/主题压工具类"现状;`vendor` 置于最低(其层位经零重叠审计确认自由)。

### 等价性论证(为什么逐位一致)

1. 同层内部:specificity + 源顺序语义与无层时完全相同,且所有文件的相对顺序保持不变。
2. 跨组普通声明:今天"无层(app/主题/vendor)> Tailwind 各层";迁移后"后声明层 > 先声明层",胜者相同。
3. important:唯一语义变化是反转,但经审计所有跨组 important 对(vendor↔app/主题、TSX `!` 工具类↔主题)在元素×属性上零交集或胜负不变。

### 机械验证(不靠眼睛)

1. **内容等价检查**:构建迁移前后两份 dist CSS,剥掉 layer 包装后对比(选择器, 声明)多重集——必须完全一致,证明零内容改动。
2. **层归属检查**:扫描新 dist CSS,断言无任何规则游离在 layer 外,且层声明顺序与设计一致。
3. 以上做成 `scripts/check-css-layers.mjs`,并挂入 `npm run build` 作为长期护栏(防止未来新增无层 CSS 复发)。

## 步骤清单

1. 迁移前基线:构建一次,留存 dist CSS 供等价性对比。
2. 拆分 styles.css → 编排入口 + `styles/app.css`(内容零修改)。
3. 迁移 15 套主题 import 至编排入口(`layer(ui-themes)`,保序);清理 main.tsx。
4. 迁移 vendor xterm import(`layer(vendor)`);清理 TerminalPage.tsx;若 Vite 对包路径 CSS `@import` 解析失败,回退方案:vendor 保持无层并在审计文档记录(已证零重叠,现状安全)。
5. 编写 `check-css-layers.mjs`(内容等价 + 层归属双检查),挂入 build。
6. 构建 + 双检查通过;`tsc --noEmit`;`git diff --check`。
7. 更新 spec:layer 架构成文,替换"无层覆盖"旧描述;写明状态可见性用内联样式、局部覆盖主题用 `!` 前缀的既定习惯。
8. 归档审计产物(important 清单、vendor 零重叠证明、未来翻转所需的冲突清单)到任务 research/。

## 验收标准

- 迁移前后 dist CSS 剥层对比:规则多重集完全一致。
- 新 dist CSS 无任何 layer 外规则,层序符合设计。
- `pnpm build`(含新检查脚本)、`tsc --noEmit` 通过,`git diff --check` 干净。
- han 抽查数套主题(含 classic、aurora、mossline 等结构差异大的)+ 明暗模式,确认无视觉变化。
- 终端页专项:多标签不分屏、手动分屏/关闭、xterm 滚动条样式、终端背景图——全部与现状一致。

## 不在范围内

- 不翻转优先级(utilities 压主题)——那是未来独立任务,本次产出其所需的冲突清单即可。
- 不剥离影子工具类,不改任何规则内容、选择器或数值。
- 不改 `--spacing` 基准(4px 网格修正属独立决策,视觉判断权在 han)。
- 不改版本号或发布流程。

## 开放问题

无。
