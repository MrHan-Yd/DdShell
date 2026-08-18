# 内置命令子命令级全覆盖补全

## Goal

现有 899 条内置命令仅覆盖"常用命令"。目标：对已有类型（7 个 JSON 文件涉及的程序），做**子命令级全覆盖**——每个程序的全部子命令/主要操作模式各至少 1 条典型用法。不是罗列参数组合，而是保证"子命令不遗漏"。预计总量 2500~4000 条。

## Decision (ADR-lite)

**Context**: "补全所有命令"的粒度需用户拍板。
**Decision**: 用户选择「子命令级全覆盖」——如 git 的 150+ 子命令、docker 全部子命令、systemctl 全部动作各 1 条典型用法；不做参数变体展开（5000+ 条方案被否）。
**Consequences**: 数据量 3~4 倍增长；编译期嵌入体积增大但仍可接受（纯文本 JSON）；测试总数断言需同步更新。

## Requirements

* 仅补全**已有 7 个 JSON 文件涉及的程序类型**，不新增程序类别（如 kubectl/helm 另行任务）
* 每个程序：枚举其全部子命令（`--help` 级别的官方子命令表），每个子命令至少 1 条典型用法
* 纯选项型程序（如 ls/grep/tar）：覆盖其主要操作模式（常用选项组合场景），不逐个选项展开
* command 字符串全局唯一（跨 7 个文件），`builtin:{command}` id 硬约束
* 中英文 title/desc 风格与现有条目一致
* distro 字段：通用命令 common；发行版特定命令按现有归属
* 程序归属权固定：每个程序只在其现有主文件中扩充（如 systemctl → linux-system.json，git → git.json），避免跨文件重复
* 更新单元测试总数断言（899 → 新总数）
* 清理现有数据中的可疑条目（如 linux-core.json 中 command 以 `-i`、`|` 开头的条目——核实是否为合法用法片段）

## Acceptance Criteria

* [ ] 已有各程序子命令覆盖完整（抽查 git/docker/systemctl/cargo/npm 等大程序对照官方子命令表无遗漏）
* [ ] cargo test 全部通过（含更新后的总数断言、全局查重、distro 枚举、字段非空）
* [ ] cargo check / clippy 无新增 warning
* [ ] 单文件条数如超 ~400 条可再拆分（同类别拆子文件并更新 BUILTIN_COMMAND_SOURCES）
* [ ] 应用启动、搜索候选、分类开关行为正常

## Definition of Done

* cargo fmt / check / test 通过
* 抽样验证搜索候选正常

## Out of Scope

* 不新增程序类别（kubectl、helm、ansible 等）
* 不做参数变体展开（每子命令 1 条典型用法为准）
* 不改引擎逻辑/前端

## Technical Notes

* 数据文件：`app/src-tauri/data/commands/*.json`，格式 `{"title_zh","title_en","command","desc_zh","desc_en","distro"}`
* 测试：`app/src-tauri/src/core/command_assist.rs` 尾部 5 个单元测试，总数断言需更新
* 现有程序清单与条数分布见任务创建时的统计（git 53 → 预计 150+；docker 128 → 预计 250+；systemctl 17 → 预计 40+ 等）
* 并行分工按文件划分，程序归属权禁止跨文件新增
