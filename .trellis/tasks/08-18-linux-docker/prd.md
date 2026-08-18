# 补全终端命令助手内置命令（Linux + Docker）

## Goal

终端命令助手（CommandAssist）的系统内置命令库不够全，用户希望补全 Linux 常用命令和 Docker 命令，提升候选命中率。

## What I already know

* 内置命令定义在 `app/src-tauri/src/core/command_assist.rs` 的 `builtin_commands()`，目前约 450 条。
* 数据结构：`BuiltinCommand { title_zh, title_en, command, desc_zh, desc_en, distro }`，distro ∈ common/ubuntu/centos/arch/alpine。
* Docker 命令靠 `"docker "` 前缀由 `command_category()` 自动归入 docker 分类（设置中可开关），无需改分类表。
* 搜索去重按 command 字符串（`search()` 中 `seen.insert(e.command)`），新增命令的 command 字符串不能与现有重复。
* id = `builtin:{command}`，同样要求 command 唯一。
* Trie 按 command 小写 + 中英文标题三个 key 索引，纯数据新增，无需改引擎逻辑。

## 现有覆盖 vs 缺口（初步盘点）

**Docker 已有**：容器生命周期、logs/inspect/exec/stats、镜像、network/volume 基础、compose 常用、system df/prune。
**Docker 缺口**：pause/unpause、rename/update/wait、export/import、attach、search/logout、network connect/disconnect/rm/prune、volume inspect/rm/prune、builder prune、buildx、context、compose stop/start/run/top、manifest、swarm/service/stack（Swarm 系）。

**Linux 已有**：文件/目录、磁盘内存、进程、find/grep、网络、curl/wget、tar、权限、SSH、systemd/journalctl、iptables、git、web 服务器、各语言工具链、各发行版包管理。
**Linux 缺口（候选）**：
* 文件与状态：stat、lsblk、readlink、basename/dirname、rename、dd、truncate、install
* 性能诊断：vmstat、iostat、mpstat、pidstat、numastat、perf top、free 变体、/proc 系
* 文本处理进阶：sed/awk 更多用法、sort 变体、join、nl、fold、fmt、expand、rev、od/xxd、base64
* 网络进阶：ip 系（addr add/route/link set）、arping、curl 更多、socat、iperf3、whois、hostname -I
* 安全/加密：openssl（证书查看/生成/测连）、gpg、chattr/lsattr、umask、getfacl/setfacl
* 用户与安全：chage、visudo、last/lastb、faillock、w/who 变体
* 存储进阶：LVM（pv/vg/lvcreate、lvextend）、parted、resize2fs/xfs_growfs、mdadm、swap 创建
* 其他：xargs 变体、date 变体、bc、seq、sleep/timeout、env 变体、update-alternatives

## Assumptions (temporary)

* 只补 Linux + Docker，不新增其他应用分类（如 kubectl）。
* 保持现有代码结构（静态 Vec 数据），不改引擎/存储/前端。
* 中英文标题、描述与现有条目风格保持一致。

## Decision (ADR-lite)

**Context**: 补全范围需用户拍板（量级差异大）。
**Decision**: 用户选择「全面补齐」—— Linux 各领域缺口 + Docker 全量（含 Swarm、buildx、context、LVM 等），预计新增 250~350 条。
**Consequences**: 数据量大但纯数据新增，无引擎改动；命令准确性靠联网核实兜底。

## Requirements (evolving)

* 在 `builtin_commands()` 中新增 Linux 与 Docker 命令条目
* 新增条目 command 字符串不与现有重复
* 中英文 title/desc 完整，风格一致

## Acceptance Criteria (evolving)

* [x] cargo check / clippy 通过（clippy warning 均为既有代码遗留，与本次无关）
* [x] 无重复 command 字符串（grep + sort + uniq -d 验证为空）
* [x] Docker 新增命令均带 `docker ` 前缀（自动归类生效）
* [x] 命令内容准确（全部为标准 Linux/Docker 常用命令用法）

## Definition of Done

* cargo fmt / check 通过
* 抽样验证搜索候选正常出现

## Out of Scope

* 不改动搜索引擎、Trie、权重逻辑
* 不新增应用分类（kubectl、helm 等另行任务）
* 不改前端 UI

## Technical Notes

* 文件：`app/src-tauri/src/core/command_assist.rs`（`builtin_commands()` 约 L209–981）
* 分类机制：`APP_COMMAND_CATEGORIES`（L171）前缀匹配
