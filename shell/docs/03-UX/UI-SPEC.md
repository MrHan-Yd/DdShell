# UI Specification

## 1. 设计原则
- 专业工具优先：信息密度与可读性平衡。
- 反馈即时：所有关键操作有状态反馈。
- 轻动效：克制、流畅、不过度炫技。

## 2. 布局规范
- 顶栏：44px。
- 侧栏：260px（收起 72px）。
- 标签栏：40px。
- 状态栏：28px。
- 间距系统：8pt。

## 3. 视觉 Token
- 圆角：控件 10px、卡片 12px、浮层 14px。
- 字号：12/13/14/16/20。
- 动效：120ms ease-out；面板开合 160~180ms。
- 终端背景：支持纯色/渐变/图片，支持透明度与轻模糊调节。

## 4. 页面规范
### 连接页
- 左侧连接树，右侧详情与快捷操作。
- 支持空态、加载态、错误态。

### 终端页
- 标签支持拖拽排序。
- 支持单屏/水平分屏/垂直分屏。
- 粘贴多行命令提供确认开关。

### SFTP 页
- 双栏文件列表 + 中部操作条 + 底部任务队列。
- 失败任务可重试并查看错误明细。
- 支持从本地直接拖拽文件到远程面板触发上传。
- 拖拽态提供高亮落点、文件数量提示与冲突策略提示。
- 支持“打包传输”开关：目录/多文件可先打包再传输。

### 系统信息页
- 顶部概览卡：`Uptime`、`Load(1/5/15)`、`CPU`、`Memory`、`Network`。
- 中部图表区：CPU 使用率、内存使用率、网络上下行速率。
- 时间窗口切换：5 分钟 / 15 分钟 / 60 分钟。
- 底部明细区：进程列表（Top N）+ 常用命令模板。
- 新增磁盘区块：按挂载点展示总量/已用/可用/使用率。
- 新增网卡区块：支持网卡多选与每网卡上下行曲线。
- 新增连接区块：端口监听与连接状态列表。
- 新增路径区块：当前路径、最近路径、收藏路径与快速跳转。
- 状态要求：支持加载态、空态、断线态、采集失败态。

### 命令中心页（macOS 风格）
- 视觉风格：半透明层次、细描边、轻阴影、细腻动效。
- 结构：左侧历史命令列表，右侧命令预览与说明。
- 交互：支持搜索、筛选、键盘上下选择、回车插入终端。
- 补充：支持命令名快速输入与路径快速选择面板。
- 补充：支持历史命令字段级左右键选择回填。
- 补充：支持命令提示下拉层（历史/系统/规则来源分组展示）。
- 补充：候选命令显示 distro 标签（Ubuntu/CentOS/Common）。

### 终端输入区背景自定义
- 支持背景来源：纯色、渐变、用户图片。
- 支持参数：透明度（0~100）、模糊（0~20px）、明暗遮罩。
- 可为全局或单会话配置，默认跟随全局。
- 可一键恢复默认背景。
- 背景变化不影响文本对比度与光标可见性。

### 终端字体与配色自定义
- 字体：支持字体家族、字号（10~24）、字重（400/500/600）、行高（1.2~1.8）。
- 配色：支持前景色、光标色、选区色。
- 预设：提供高对比、柔和暗色、浅色清晰三种预设。
- 联动：启用图片背景时提供可读性评分与“增强可读性”一键修正。
- 范围：支持全局配置与单会话覆盖。
- 结果：选择命令后不自动执行，仅回填到终端输入区。

## 5. 交互细节
- 首屏自动聚焦终端输入。
- 危险操作二次确认（可配置）。
- 状态提示统一出现在右下角 toast + 状态栏。
- 进入系统信息页后自动开始采样，离开页面自动降频或停止采样。
- 图表刷新平滑过渡，不允许闪屏和轴跳变。
- 断线时暂停图表并展示“连接中断，可重试”提示。
- 文件拖拽上传时，提供队列化反馈与可取消操作。
- 命令历史选择后应保持终端焦点并允许用户继续编辑。
- 命令提示选择后仅回填，不自动执行。
- 若命令与当前 distro 不匹配，显示替代建议与风险提示。

## 11. Update Center (Client)
- Entry: `Settings -> Update Center`.
- Capabilities:
  - check updates
  - view current/latest version
  - download progress
  - install update and restart
  - view release notes
- States:
  - idle / checking / up_to_date / update_available / downloading / ready_to_install / failed
- Interaction:
  - one-click `Check for Updates`
  - after download complete, show `Install and Restart`
  - on failure, display actionable reason and retry entry
- Safety:
  - signature verification failure blocks install and shows security warning
  - no silent force install

### Session Health Score (FR-37)
- Location: terminal status bar right side + system insights overview card.
- Display:
  - numeric score (`0~100`)
  - level badge (`GOOD/FAIR/POOR`)
  - tooltip with top reasons (latency/loss/reconnect/timeout)
- Color token:
  - GOOD: green
  - FAIR: amber
  - POOR: red
- Interaction:
  - click score opens details drawer with 5-minute trend and reason breakdown.
  - when POOR for >=30s, show non-blocking suggestion: `Reconnect` / `Lower sampling`.
- UX constraints:
  - update interval: 2s
  - no modal interruption
  - must not steal terminal input focus

## 12. Component Quality Baseline
- Component visual quality must follow `docs/03-UX/COMPONENT-STYLE-SPEC.md`.
- For all interactive controls, default/hover/active/focus/disabled states are mandatory.
- Glass surfaces must include blur + hairline border + shadow hierarchy.
- New page UI reviews must include a macOS feel checklist.

## 13. Layout Rationalization (Mandatory)

### 13.1 System Insights Information Hierarchy
- First screen must only include:
  - Overview cards (`Uptime`, `Load`, `CPU`, `Memory`, `Network`, `Session Health`)
  - Core trend charts (`CPU`, `Memory`, `Network`)
- Secondary modules (`process list`, `disk`, `multi-NIC`, `connections`, `path tools`) must be placed in collapsible sections or tabbed sub-panels.
- Default order priority:
  1. Session health and real-time stability
  2. Core resource trends
  3. Diagnostic details

### 13.2 Small Window Fallback
- For window height < 800px:
  - top bar: 44px -> 40px
  - tab bar: 40px -> 36px
  - status bar must collapse to compact mode
- For window width < 1280px:
  - non-critical side widgets must collapse by default
  - dense cards switch to compact typography and reduced paddings

### 13.3 Command Center Narrow Mode
- For window width < 1280px, command center must switch from dual-pane to single-pane mode.
- History panel becomes a drawer/sheet triggered by shortcut or button.
- Focus returns to terminal input after insert/close operations.

### 13.4 SFTP Queue Behavior
- Transfer queue should be collapsed by default when idle.
- Queue auto-expands only when:
  - active transfer exists, or
  - failed transfer exists
- User manual expand/collapse preference should persist.
