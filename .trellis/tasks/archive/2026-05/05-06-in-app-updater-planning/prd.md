# In-app updater planning

## Goal

为 DdShell 规划一套可落地的应用内更新方案，从当前“检查更新后跳转 GitHub 让用户自行下载”演进到“应用内可判断目标包并下载更新”，先完成方案设计与实施边界，不在本任务内直接编码实现。

## What I already know

* 当前应用技术栈是 Tauri 2 + React 19 + TypeScript + Rust。
* 当前更新检查由 `app/src-tauri/src/lib.rs` 中的 `check_update` 实现：先请求 `releases/latest` 判断是否有新版，再请求 GitHub Releases API 拉取 assets 列表。
* 当前前端状态栏 `app/src/components/StatusBar.tsx` 在发现新版本后，只提供“下载”按钮，行为是 `openBrowser(GITHUB_REPO_URL)`，即跳 GitHub 页面手动下载。
* 当前 Tauri bridge 已暴露 `checkUpdate`、`downloadUpdate`、`getInstallType`、`openBrowser` 等接口，说明仓库里已经有“应用内下载”和“安装类型识别”的基础能力雏形。
* 当前 `release.yml` 会上传 6 类发布产物：macOS arm64 dmg、macOS x64 dmg、Windows x64 msi、Windows x64 exe、Linux amd64 deb、Linux amd64 AppImage。
* 当前 Windows 侧 `get_install_type()` 通过 `current_exe()` 路径启发式判断 `msi` / `nsis` / `unknown`，macOS 与 Linux 还没有明确包型识别逻辑。
* 用户提出了一个更稳的方向：在不同安装包构建阶段主动写入包型标识，让运行中的应用直接读到 `package_type`，而不是纯靠环境反推。

## Assumptions (temporary)

* 本次优先目标是先规划“如何选择正确安装包并在应用内下载”，不立即承诺“自动静默安装”。
* 若平台原生自更新链路复杂，允许 MVP 只做到“应用内下载到本地 + 告知用户安装”。
* Windows 和 Linux 因存在多种发布包，需要额外的 `package_type` 识别或持久化策略；不能仅靠 `os + arch` 唯一定位。

## Open Questions

* 无

## Requirements (evolving)

* 梳理当前 GitHub Release 产物与平台/架构/包型的映射关系。
* 规划应用运行时可获取的更新选择维度（至少 `os`、`arch`、必要时 `package_type`）。
* 规划在无法可靠反推原安装包时的兜底策略。
* 给出适合当前 Tauri 项目的 MVP 路线与后续增强路线。
* MVP 范围确定为：应用内检查更新、选择正确安装包、下载到本地、下载后拉起安装器或打开安装包；不做应用自替换。
* 优先评估“构建时写入包型标识，运行时直接读取”方案，以降低 Windows / Linux 多包型识别错误率。
* 包型标识的首选方案为“编译/打包时注入常量或环境变量”，而不是首次启动写本地配置或运行时路径猜测。
* MVP 先不提供面向普通用户的包型手动切换入口，默认走内部识别与兜底逻辑。
* MVP 平台范围优先支持 macOS + Windows；Linux 暂时保持现有 GitHub 跳转下载流程，后续单独补齐。

## Acceptance Criteria (evolving)

* [ ] 明确当前“检查更新 -> GitHub 跳转”链路的现状与缺口。
* [ ] 明确 6 个 release 产物分别服务于哪些平台/场景。
* [ ] 明确应用内下载更新所需的识别字段、元数据格式和选择逻辑。
* [ ] 明确 MVP 范围、非目标范围和后续实现阶段建议。
* [ ] 明确首期只覆盖 macOS + Windows，Linux 延后，并说明原因与后续扩展点。

## Definition of Done (team quality bar)

* PRD 对需求、边界、技术路线表述清晰。
* 实施前需要的信息缺口已收敛到少数明确决策点。
* 后续实现任务可直接基于该 PRD 进入编码阶段。

## Out of Scope (explicit)

* 本任务不直接修改生产代码。
* 本任务不直接接入完整自动静默安装、进程自替换或平台专用 updater 框架。
* 本任务不重构 GitHub Release 工作流，只做规划建议。

## Decision (ADR-lite)

**Context**: 应用内更新可以分为仅跳下载页、应用内下载、下载后拉起安装器、完整自更新等不同层级，复杂度差异较大。

**Decision**: MVP 选择“应用内下载 + 拉起安装器/安装包”，即用户不再跳 GitHub 页面手动找包，但仍由系统安装器完成最终安装。

**Consequences**: 该方案能显著改善体验，同时避开 Tauri 跨平台自替换、签名、回滚等高复杂度问题；后续如要升级到完整自更新，需要再补 manifest、签名校验和平台更新链路。

**Additional decision**: `package_type` 优先采用构建时注入（如环境变量 / 编译常量）并在运行时直接读取；运行时路径判断仅保留为兼容兜底，不作为主链路。

**Additional decision**: MVP 暂不在主更新交互里暴露包型切换 UI，先保持默认无感；如后续需要人工纠错，再考虑增加隐藏高级选项。

**Additional decision**: MVP 首期只做 macOS + Windows 的应用内下载与拉起安装包；Linux 继续跳 GitHub 下载页，原因是 Linux 包型分发差异更大，留待后续独立设计。

## Technical Approach

* 更新检查仍复用当前 GitHub latest release 查询链路，但需要在拿到 assets 后追加“按当前运行环境筛选目标安装包”的逻辑。
* 当前运行环境识别维度采用 `os + arch + package_type`。
* `package_type` 主来源为构建/打包阶段注入的编译常量；若缺失，再走运行时启发式兜底。
* macOS 通过 `arch` 直接在两个 dmg 中选择。
* Windows 通过注入的 `package_type` 在 `msi` / `exe` 中选择，并在下载完成后拉起对应安装包。
* Linux 首期不进入应用内下载链路，继续复用现有 GitHub 跳转逻辑。
* UI 上保留当前“发现新版本”入口，但下载动作从“打开 GitHub 仓库页”改为“应用内下载并打开安装包”；失败时再回退到 GitHub 页面。

## Technical Notes

* 更新检查后端：`app/src-tauri/src/lib.rs:1959`
* 安装类型识别雏形：`app/src-tauri/src/lib.rs:1941`
* 前端桥接：`app/src/lib/tauri.ts:547`
* 状态栏下载入口：`app/src/components/StatusBar.tsx:77`
* 发布产物定义：`.github/workflows/release.yml`
* 可探索方案：在 CI / build 阶段通过环境变量、配置文件或打包后资源文件将 `package_type` 写入应用，应用启动后读该值参与更新资产选择。
