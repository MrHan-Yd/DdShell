# 内置命令数据抽离为 JSON 文件

## Goal

`command_assist.rs` 中 900 条内置命令硬编码为 Rust Vec，文件已达 1600+ 行，数据与逻辑混杂，维护成本高。将命令数据抽离为按类别拆分的 JSON 文件，`include_str!` 编译期嵌入 + serde 启动时解析，实现数据与代码分离。

## Requirements

* 命令数据迁移到 `app/src-tauri/data/commands/*.json`，按类别拆分（建议：linux.json、network.json、git.json、docker.json、dev-tools.json、distro.json，具体划分实现时按条目归属定，单文件不超过 ~250 条）
* `BuiltinCommand` 结构体加 `serde::Deserialize` 派生，字段与 JSON key 一一对应（title_zh/title_en/command/desc_zh/desc_en/distro）
* `builtin_commands()` 改为 `include_str!` 各 JSON + `serde_json::from_str` 拼接，返回类型保持 `Vec<BuiltinCommand>`（&'static str 需改为 String，随之调整 rebuild_index 中的引用处）
* 迁移必须无损：899 条命令逐条对齐，不增不减不改内容（注：早前 PRD 写 900 系 grep 误把 struct 定义行计入，实际数据为 899 条）
* 新增单元测试：解析全部 JSON 成功 + command 字符串全局无重复 + 总数断言（899）
* 其余引擎逻辑（Trie/搜索/权重/分类）不动

## Acceptance Criteria

* [ ] 899 条命令全部迁入 JSON，Rust 源码中不再有 BuiltinCommand 字面量数据
* [ ] cargo test 通过（含新增的解析/查重/总数测试）
* [ ] cargo check / clippy 无新增 warning
* [ ] 迁移前后 `builtin_commands()` 输出集合一致（迁移脚本或测试比对）
* [ ] 应用启动、搜索候选、分类开关、发行版过滤行为不变

## Definition of Done

* 测试覆盖 JSON 解析与数据完整性
* cargo fmt / check / test 通过

## Technical Approach

1. 写一次性脚本（或手工正则）从现有 Rust Vec 提取 900 条为 JSON
2. `BuiltinCommand` 派生 Deserialize，&'static str → String
3. `builtin_commands()` 改为 include_str! 拼接解析
4. 删除源码中的数据字面量
5. 添加单元测试（解析成功 / 无重复 / 条数）

## Decision (ADR-lite)

**Context**: 命令数据硬编码在 Rust 源码中，文件膨胀、维护不便。候选：A 嵌入式 JSON、B 运行时资源文件、C 入 SQLite。
**Decision**: 方案 A —— 编译期嵌入 JSON。数据文件可自由拆分，diff 清爽，行为与现状完全一致（零运行时 IO），无版本迁移成本。
**Consequences**: 失去编译期字段检查，用单元测试（解析 + 查重 + 总数）兜底；未来若需用户覆盖内置命令可从 A 平滑演进到 C。

## Out of Scope

* 不做运行时热更新（方案 B）
* 不做内置命令入库/用户可编辑内置命令（方案 C）
* 不改变命令内容本身
* 不改前端

## Technical Notes

* 数据源：`app/src-tauri/src/core/command_assist.rs` `builtin_commands()`（约 L209 起，900 条）
* 用户自定义命令走 SQLite（store::Snippet），与本次改动无关；rebuild_index 中用户命令先插入、搜索去重保留首个，该优先级行为保持不变
* 分类开关依赖 `command_category()` 按 command 前缀匹配，与文件划分无关
* id 生成 `builtin:{command}` 依赖 command 唯一 —— 查重测试是硬约束
