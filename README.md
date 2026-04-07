# DdShell

DdShell 是一个基于 Tauri + React + Rust 的跨平台 SSH / SFTP 客户端项目，目标是做成可替代 FinalShell 的开源桌面应用。

## 当前仓库结构

- `app/`: 实际应用代码，包含 React 前端与 Tauri Rust 后端
- `shell/`: 产品、架构、UX、工程、发布文档
- 根目录中文文档: 补充说明、规划和发布资料

## 从哪里开始看

- 项目入口文档: [shell/docs/START-HERE.md](shell/docs/START-HERE.md)
- 产品需求: [shell/docs/01-PRODUCT/PRD.md](shell/docs/01-PRODUCT/PRD.md)
- 功能状态: [shell/docs/01-PRODUCT/FEATURE-STATUS.md](shell/docs/01-PRODUCT/FEATURE-STATUS.md)
- FR 索引: [shell/docs/01-PRODUCT/FR-INDEX.md](shell/docs/01-PRODUCT/FR-INDEX.md)
- 应用开发说明: [app/README.md](app/README.md)

## 当前状态

仓库并非纯文档项目。`app/` 内已经实现了连接管理、SSH 终端、多标签、分屏、SFTP 双栏、系统监控、Snippets、终端样式设置、命令提示等原型功能；状态请以 `shell/docs/01-PRODUCT/FEATURE-STATUS.md` 为准。

## 开发约定

- 包管理器只使用 `pnpm`
- 文档主入口在 `shell/docs/`
- 代码状态与 FR 状态变更时，需要同步更新状态文档

## License

This project is licensed under the MIT License.
See the [LICENSE](shell/LICENSE) file for details.

## Disclaimer

This software is provided "AS IS", without warranty of any kind, express or implied.
The authors or copyright holders are not liable for any claim, damages, or other liability
arising from the software or the use of the software.

本软件按“现状”提供，不提供任何明示或暗示担保。
因软件或使用软件产生的任何索赔、损害或其他责任，作者和版权持有人不承担责任。

## Anti-Plagiarism & Evidence

See [docs/07-LEGAL/ANTI-PLAGIARISM-FORENSICS.md](shell/docs/07-LEGAL/ANTI-PLAGIARISM-FORENSICS.md).
