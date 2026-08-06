# Layer 迁移审计记录(08-04-css-layer)

本文件记录迁移过程中所有验证的**方法与结论**,供未来翻转任务(utilities 压主题)复用。

## 1. 结构决策:app 主体与 15 主题共用同一 layer

- 拆分 styles.css 时原计划把主体(→`app`)与 15 套主题(→`ui-themes`)分成两个 layer。
- 审计发现:styles.css 主体与主题之间存在**依赖 specificity 的胜负**,如
  `.term-main[data-file-manager-resizing="true"] .terminal{transition:none}` 以高特异性压过主题的 `transition`。
- 跨 layer 时 specificity 不参与裁决(layer 完全先于 specificity),拆成两层会让这类规则失去优势。
- **结论:同层才能逐位保留"specificity + 源顺序"语义,故主体与主题合并为单一 `app` layer。**

## 2. 优先级等价性论证

- 迁移后最终 layer 序(产物验证):`properties < vendor < theme < base < components < utilities < app`。
- 普通声明:今天"无层(主体/主题/vendor) > Tailwind 各层";迁移后"后声明层 > 先声明层",胜者一致。
- important:层序反转(vendor 沉底后,其 important 弱于 app/主题的 important),但 vendor 与 app/主题在「选择器×属性」上零重叠(见下),无任何现有胜负改变。
- TSX `!` 工具类(如 `!px-6`):今天在 utilities 层内(important 强于无层);迁移后 utilities 仍先于 app 声明,important 反转后仍强于 app——胜负不变。
- 主题 `!important`(settings.css 各 5 处、components.css 各 2 处):随主题入 app 层,内部相对顺序不变,行为保留。

## 3. vendor(@xterm/xterm/css/xterm.css)零重叠审计

- vendor 285 行,2 处 `!important`(opacity/font-size,与 app/主题无属性交集)。
- 应用侧 xterm 相关规则全部为 `::-webkit-scrollbar` 伪元素与 `.terminal-xterm-surface`(transform/transition),vendor 均未定义。
- 产物级验证:vendor 层化后,唯一内容差异是 `.xterm{position:relative}` 的重复定义(声明级完全一致,被去除)。
- 结论:vendor 沉入最低层安全,现有渲染无任何改变。

## 4. 构建产物等价性验证方法(含踩坑)

**基线**:`git stash -u && npx vite build --minify false` → 两份未压缩 CSS(主题在 index, vendor 独立);
**新版**:stash pop 后同样构建。

对比解析器迭代了三版,教训:
1. 第一版解析对 `@keyframes` 内部逐行算声明,产生大量伪差异——keyframes 必须作为**原子块**整体对比。
2. Tailwind v4 在 `@supports` 内嵌 `.flex-shrink-0` 等 shim(替代 legacy 兼容),与 `@theme` 生成的 `:root/:host` 变量,重复规则被 lightningcss 去重;计数对比必须做**多重集差**(计数为 0 才算真缺失)。
3. `:root` 块中 `--tw-*` 与 `.flex` shim 的去重、`#rrggbbaa` 与 `rgba()` 的互相转换,让"最终生效值"对比需要颜色归一化。

**最终结论(逐项核对后)**:
- 无规则、无 keyframes 名字、无原子块丢失;
- 重复规则被去重(选择器、值完全一致)或仅排序变化(Tailwind 变量/工具类顺序),不改变任何裁决;
- 最终值 diff 全部来自语义等价改写:颜色格式(hex↔rgba)、`transparent↔none`、`0%` 空格(lightningcss 压缩)、线性渐变 `#a78bfa2e 0%` 排版——无一条渲染语义变化。

## 5. 已验证的边界样例(未来 flip 时参考)

- `[data-ui-theme="aurora"] .app-body-frame`:基线 3 条,两条相同声明(gap:0;padding:0)被去重为 1 条 → 净差异是「新增一批唯一 token」而非丢失;最终值为 `gap:14px;padding:14px 14px 10px`。
- `[data-ui-theme="aurora"] .settings-nav-button[data-active="true"]:before`:`top:10px`(旧规则)被 `top:8px`(新规则,更高 specificity:aurora + button 前缀)覆盖。**跨 layer 时这个裁决会翻转**——flip 前必须处理这类"同主题内新规则刻意压旧规则"的案例。
- `--shadow-card` 值:基线 `#0000004c` vs 新版 `#0000004d`(0x4c=76=29.8%,0x4d=77=30.2%)——lightningcss 的 alpha 舍入差异,肉眼不可辨,非语义变化。

## 6. 残余待办(翻转任务的前置)

- 影子工具类(`.gap-1~4`/`.flex-1`/`.truncate`,15 套同值,约 91 条)仍在 app 层内,**未剥离**。
- 若未来要让 utilities 压主题,须先做全量「主题规则×工具类」属性交叉审计(本次已提供评估文档 `docs/技术方案/theme-css-layer-migration-assessment.md` 中的冲突扫描方法)。
- 4px 网格修正(`--spacing` 基准)属独立决策,视觉判断权在 han。
