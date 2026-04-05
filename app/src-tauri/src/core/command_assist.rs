use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

// ── Data Models ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateItem {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub source: String,       // "user" | "system"
    pub distro: Option<String>, // "ubuntu" | "centos" | "common"
    pub weight: f64,
    pub category: Option<String>, // "git" | "docker" | "python" | ...
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub items: Vec<CandidateItem>,
    pub total: usize,
    pub page: u32,
    pub has_more: bool,
}

// ── Trie Node ──

#[derive(Debug, Default)]
struct TrieNode {
    children: HashMap<char, TrieNode>,
    /// Commands stored at this node (key = command string)
    entries: Vec<TrieEntry>,
}

#[derive(Debug, Clone)]
struct TrieEntry {
    id: String,
    title: String,
    command: String,
    description: Option<String>,
    source: String,
    distro: Option<String>,
    category: Option<String>,
}

impl TrieNode {
    fn insert(&mut self, key: &str, entry: TrieEntry) {
        let mut node = self;
        for ch in key.chars() {
            node = node.children.entry(ch).or_default();
        }
        node.entries.push(entry);
    }

    fn search_prefix(&self, prefix: &str) -> Vec<&TrieEntry> {
        let mut node = self;
        for ch in prefix.chars() {
            match node.children.get(&ch) {
                Some(child) => node = child,
                None => return Vec::new(),
            }
        }
        // Collect all entries from this node and all descendants
        let mut results = Vec::new();
        Self::collect_entries(node, &mut results);
        results
    }

    fn collect_entries<'a>(node: &'a TrieNode, results: &mut Vec<&'a TrieEntry>) {
        results.extend(node.entries.iter());
        for child in node.children.values() {
            Self::collect_entries(child, results);
        }
    }
}

// ── LRU Cache ──

struct LruCache {
    capacity: usize,
    entries: Vec<(String, Vec<CandidateItem>)>,
}

impl LruCache {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: Vec::new(),
        }
    }

    fn get(&mut self, key: &str) -> Option<&Vec<CandidateItem>> {
        if let Some(pos) = self.entries.iter().position(|(k, _)| k == key) {
            // Move to end (most recently used)
            let entry = self.entries.remove(pos);
            self.entries.push(entry);
            self.entries.last().map(|(_, v)| v)
        } else {
            None
        }
    }

    fn put(&mut self, key: String, value: Vec<CandidateItem>) {
        // Remove existing entry if present
        self.entries.retain(|(k, _)| k != &key);
        if self.entries.len() >= self.capacity {
            self.entries.remove(0); // Remove least recently used
        }
        self.entries.push((key, value));
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

// ── LRU cache for weights (hot-key protection) ──

struct WeightsLruCache {
    capacity: usize,
    entries: Vec<(String, f64)>,
}

impl WeightsLruCache {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: Vec::with_capacity(capacity.min(64)),
        }
    }

    fn get(&mut self, key: &str) -> Option<f64> {
        if let Some(pos) = self.entries.iter().position(|(k, _)| k == key) {
            let entry = self.entries.remove(pos);
            let val = entry.1;
            self.entries.push(entry);
            Some(val)
        } else {
            None
        }
    }

    fn insert(&mut self, key: String, value: f64) {
        if let Some(pos) = self.entries.iter().position(|(k, _)| k == &key) {
            self.entries.remove(pos);
        } else if self.entries.len() >= self.capacity {
            self.entries.remove(0); // evict LRU
        }
        self.entries.push((key, value));
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

// ── Built-in Commands ──

/// Category of application-specific commands that users can toggle individually.
struct AppCommandCategory {
    id: &'static str,
    prefixes: &'static [&'static str],
}

const APP_COMMAND_CATEGORIES: &[AppCommandCategory] = &[
    AppCommandCategory { id: "git",       prefixes: &["git "] },
    AppCommandCategory { id: "docker",    prefixes: &["docker "] },
    AppCommandCategory {
        id: "webServer",
        prefixes: &["sudo nginx", "sudo systemctl restart nginx", "sudo apachectl", "sudo systemctl restart apache2"],
    },
    AppCommandCategory { id: "python",   prefixes: &["python3", "pip "] },
    AppCommandCategory { id: "node",     prefixes: &["npm ", "node "] },
    AppCommandCategory { id: "java",     prefixes: &["java ", "javac "] },
    AppCommandCategory { id: "maven",    prefixes: &["mvn "] },
    AppCommandCategory { id: "gradle",   prefixes: &["gradle "] },
    AppCommandCategory { id: "go",       prefixes: &["go "] },
    AppCommandCategory { id: "jq",       prefixes: &["jq "] },
    AppCommandCategory { id: "kotlin",   prefixes: &["kotlinc ", "kotlin "] },
    AppCommandCategory { id: "php",      prefixes: &["php ", "composer "] },
    AppCommandCategory { id: "rust",     prefixes: &["cargo ", "rustc ", "rustup "] },
];

/// Determine the category id of a command, or None if it is a core system command.
fn command_category(command: &str) -> Option<&'static str> {
    for cat in APP_COMMAND_CATEGORIES {
        if cat.prefixes.iter().any(|p| command.starts_with(p)) {
            return Some(cat.id);
        }
    }
    None
}

struct BuiltinCommand {
    title_zh: &'static str,
    title_en: &'static str,
    command: &'static str,
    desc_zh: &'static str,
    desc_en: &'static str,
    distro: &'static str, // "common" | "ubuntu" | "centos"
}

fn builtin_commands() -> Vec<BuiltinCommand> {
    vec![
        // ── Common: 文件与目录操作 ──
        BuiltinCommand { title_zh: "列出文件", title_en: "List files", command: "ls", desc_zh: "列出当前目录文件", desc_en: "List files in current directory", distro: "common" },
        BuiltinCommand { title_zh: "列出文件（详细信息）", title_en: "List files long", command: "ls -l", desc_zh: "列出文件及详细信息", desc_en: "List files with details", distro: "common" },
        BuiltinCommand { title_zh: "列出所有文件", title_en: "List all files", command: "ls -la", desc_zh: "列出所有文件（含隐藏文件）", desc_en: "List all files including hidden", distro: "common" },
        BuiltinCommand { title_zh: "列出文件（可读大小）", title_en: "List files human-readable", command: "ls -lah", desc_zh: "列出所有文件，大小以人类可读格式显示", desc_en: "List all files with human-readable sizes", distro: "common" },
        BuiltinCommand { title_zh: "按时间排序列出", title_en: "List files by time", command: "ls -lt", desc_zh: "按修改时间排序", desc_en: "List files sorted by modification time", distro: "common" },
        BuiltinCommand { title_zh: "按大小排序列出", title_en: "List files by size", command: "ls -lSh", desc_zh: "按文件大小排序", desc_en: "List files sorted by size", distro: "common" },
        BuiltinCommand { title_zh: "显示当前目录", title_en: "Print working directory", command: "pwd", desc_zh: "显示当前工作目录路径", desc_en: "Show current directory path", distro: "common" },
        BuiltinCommand { title_zh: "切换目录", title_en: "Change directory", command: "cd ", desc_zh: "切换到指定目录", desc_en: "Change to a directory", distro: "common" },
        BuiltinCommand { title_zh: "回到主目录", title_en: "Go home", command: "cd ~", desc_zh: "切换到用户主目录", desc_en: "Change to home directory", distro: "common" },
        BuiltinCommand { title_zh: "返回上一次目录", title_en: "Go back", command: "cd -", desc_zh: "返回到上一个工作目录", desc_en: "Go to previous directory", distro: "common" },
        BuiltinCommand { title_zh: "创建目录", title_en: "Make directory", command: "mkdir ", desc_zh: "创建一个目录", desc_en: "Create a directory", distro: "common" },
        BuiltinCommand { title_zh: "递归创建目录", title_en: "Make nested directory", command: "mkdir -p ", desc_zh: "递归创建目录及父目录", desc_en: "Create directory and all parents", distro: "common" },
        BuiltinCommand { title_zh: "复制文件", title_en: "Copy file", command: "cp  dest", desc_zh: "复制文件到目标位置", desc_en: "Copy a file", distro: "common" },
        BuiltinCommand { title_zh: "复制目录", title_en: "Copy directory", command: "cp -r  dest", desc_zh: "递归复制目录", desc_en: "Copy a directory recursively", distro: "common" },
        BuiltinCommand { title_zh: "移动/重命名", title_en: "Move/rename", command: "mv  dest", desc_zh: "移动或重命名文件", desc_en: "Move or rename a file", distro: "common" },
        BuiltinCommand { title_zh: "删除文件", title_en: "Remove file", command: "rm ", desc_zh: "删除一个文件", desc_en: "Remove a file", distro: "common" },
        BuiltinCommand { title_zh: "递归删除目录", title_en: "Remove directory", command: "rm -rf ", desc_zh: "递归强制删除目录", desc_en: "Remove directory recursively", distro: "common" },
        BuiltinCommand { title_zh: "删除空目录", title_en: "Remove empty dir", command: "rmdir ", desc_zh: "删除空目录", desc_en: "Remove empty directory", distro: "common" },
        BuiltinCommand { title_zh: "查看文件内容", title_en: "Cat file", command: "cat ", desc_zh: "显示文件全部内容", desc_en: "Display file contents", distro: "common" },
        BuiltinCommand { title_zh: "带行号查看", title_en: "Cat with numbers", command: "cat -n ", desc_zh: "显示文件内容并带行号", desc_en: "Display file with line numbers", distro: "common" },
        BuiltinCommand { title_zh: "分页查看", title_en: "Less pager", command: "less ", desc_zh: "使用分页器查看文件", desc_en: "View file with scrollable pager", distro: "common" },
        BuiltinCommand { title_zh: "查看前10行", title_en: "Head first 10", command: "head ", desc_zh: "显示文件前10行", desc_en: "Show first 10 lines", distro: "common" },
        BuiltinCommand { title_zh: "查看后10行", title_en: "Tail last 10", command: "tail ", desc_zh: "显示文件最后10行", desc_en: "Show last 10 lines", distro: "common" },
        BuiltinCommand { title_zh: "查看后N行", title_en: "Tail N lines", command: "tail -n 100 ", desc_zh: "显示文件最后N行", desc_en: "Show last N lines", distro: "common" },
        BuiltinCommand { title_zh: "实时跟踪文件", title_en: "Tail follow", command: "tail -f ", desc_zh: "实时跟踪文件变化", desc_en: "Follow file changes in real time", distro: "common" },
        BuiltinCommand { title_zh: "创建空文件", title_en: "Touch file", command: "touch ", desc_zh: "创建空文件或更新时间戳", desc_en: "Create empty file or update timestamp", distro: "common" },
        BuiltinCommand { title_zh: "输出文本", title_en: "Echo text", command: "echo ", desc_zh: "在终端输出文本", desc_en: "Print text to terminal", distro: "common" },
        BuiltinCommand { title_zh: "写入文件", title_en: "Echo to file", command: "echo '' > ", desc_zh: "将文本写入文件（覆盖）", desc_en: "Write text to file (overwrite)", distro: "common" },
        BuiltinCommand { title_zh: "追加到文件", title_en: "Append to file", command: "echo '' >> ", desc_zh: "将文本追加到文件末尾", desc_en: "Append text to file", distro: "common" },
        BuiltinCommand { title_zh: "查找命令路径", title_en: "Which command", command: "which ", desc_zh: "显示命令的完整路径", desc_en: "Show full path of a command", distro: "common" },
        BuiltinCommand { title_zh: "定位命令位置", title_en: "Whereis", command: "whereis ", desc_zh: "定位二进制、源码和手册页", desc_en: "Locate binary, source, and man page", distro: "common" },
        BuiltinCommand { title_zh: "查看手册", title_en: "Man page", command: "man ", desc_zh: "显示命令的手册页", desc_en: "Show manual page for a command", distro: "common" },
        BuiltinCommand { title_zh: "创建别名", title_en: "Alias command", command: "alias name='command'", desc_zh: "创建命令别名", desc_en: "Create a command alias", distro: "common" },
        BuiltinCommand { title_zh: "设置环境变量", title_en: "Export variable", command: "export =value", desc_zh: "设置环境变量", desc_en: "Set an environment variable", distro: "common" },
        BuiltinCommand { title_zh: "查看PATH", title_en: "Show PATH", command: "echo $PATH", desc_zh: "显示PATH环境变量", desc_en: "Show PATH environment variable", distro: "common" },
        BuiltinCommand { title_zh: "执行脚本", title_en: "Source script", command: "source ", desc_zh: "在当前shell中执行脚本", desc_en: "Execute commands from a file in current shell", distro: "common" },
        BuiltinCommand { title_zh: "同时输出到终端和文件", title_en: "Tee output", command: " | tee ", desc_zh: "将输出同时发送到终端和文件", desc_en: "Pipe output to both terminal and file", distro: "common" },
        // ── Common: 磁盘与内存 ──
        BuiltinCommand { title_zh: "磁盘使用情况", title_en: "Disk usage", command: "df -h", desc_zh: "查看磁盘空间使用情况", desc_en: "Show disk space usage", distro: "common" },
        BuiltinCommand { title_zh: "磁盘使用（含文件系统类型）", title_en: "Disk usage by type", command: "df -Th", desc_zh: "查看磁盘使用及文件系统类型", desc_en: "Show disk usage with filesystem type", distro: "common" },
        BuiltinCommand { title_zh: "目录大小", title_en: "Directory size", command: "du -sh ", desc_zh: "查看指定目录的大小", desc_en: "Show size of a directory", distro: "common" },
        BuiltinCommand { title_zh: "当前目录各项目大小", title_en: "Directory size all", command: "du -sh *", desc_zh: "查看当前目录下各项目大小", desc_en: "Show size of each item in current directory", distro: "common" },
        BuiltinCommand { title_zh: "目录大小（指定深度）", title_en: "Directory max depth", command: "du -h --max-depth=1 ", desc_zh: "查看目录大小（1层深度）", desc_en: "Show directory sizes 1 level deep", distro: "common" },
        BuiltinCommand { title_zh: "内存使用", title_en: "Free memory", command: "free -h", desc_zh: "查看内存使用情况", desc_en: "Show memory usage", distro: "common" },
        BuiltinCommand { title_zh: "内存使用（宽格式）", title_en: "Free memory wide", command: "free -wh", desc_zh: "查看内存使用（宽格式输出）", desc_en: "Show memory usage (wide output)", distro: "common" },
        BuiltinCommand { title_zh: "交换分区使用", title_en: "Swap usage", command: "swapon --show", desc_zh: "查看交换分区设备及使用情况", desc_en: "Show swap devices and usage", distro: "common" },
        BuiltinCommand { title_zh: "块设备UUID", title_en: "Block device UUID", command: "sudo blkid", desc_zh: "查看块设备的UUID和文件系统类型", desc_en: "Show block device UUID and filesystem type", distro: "common" },
        // ── Common: 进程管理 ──
        BuiltinCommand { title_zh: "进程列表", title_en: "Process list", command: "ps aux", desc_zh: "显示所有运行中的进程", desc_en: "Show all running processes", distro: "common" },
        BuiltinCommand { title_zh: "进程列表（BSD格式）", title_en: "Process list BSD", command: "ps -ef", desc_zh: "显示所有进程（System V风格）", desc_en: "Show all processes (System V style)", distro: "common" },
        BuiltinCommand { title_zh: "进程树", title_en: "Process tree", command: "ps auxf", desc_zh: "以树形结构显示进程", desc_en: "Show processes in tree format", distro: "common" },
        BuiltinCommand { title_zh: "按名称查找进程", title_en: "Find PID", command: "pgrep -l ", desc_zh: "按名称查找进程PID", desc_en: "Find process PIDs by name", distro: "common" },
        BuiltinCommand { title_zh: "资源占用排行", title_en: "Top processes", command: "top -bn1 | head -20", desc_zh: "显示资源占用最高的进程（快照）", desc_en: "Show top processes (one snapshot)", distro: "common" },
        BuiltinCommand { title_zh: "交互式进程查看", title_en: "Htop", command: "htop", desc_zh: "交互式进程查看器", desc_en: "Interactive process viewer", distro: "common" },
        BuiltinCommand { title_zh: "磁盘IO监控", title_en: "Iotop", command: "sudo iotop", desc_zh: "按进程监控磁盘I/O使用", desc_en: "Monitor disk I/O by process", distro: "common" },
        BuiltinCommand { title_zh: "文件占用进程", title_en: "Fuser", command: "fuser -v ", desc_zh: "查看占用文件或端口的进程", desc_en: "Find processes using file or port", distro: "common" },
        // ── Common: 文件查找 ──
        BuiltinCommand { title_zh: "全局查找文件", title_en: "Find file", command: "find / -name ", desc_zh: "按名称全局查找文件", desc_en: "Find file by name", distro: "common" },
        BuiltinCommand { title_zh: "当前目录查找", title_en: "Find in current dir", command: "find . -name ", desc_zh: "在当前目录中查找文件", desc_en: "Find file in current directory", distro: "common" },
        BuiltinCommand { title_zh: "查找普通文件", title_en: "Find by type", command: "find . -type f -name ", desc_zh: "只查找普通文件", desc_en: "Find only regular files", distro: "common" },
        BuiltinCommand { title_zh: "查找目录", title_en: "Find directory", command: "find . -type d -name ", desc_zh: "只查找目录", desc_en: "Find only directories", distro: "common" },
        BuiltinCommand { title_zh: "查找并执行命令", title_en: "Find and exec", command: "find . -name '' -exec {} \\;", desc_zh: "查找文件并执行命令", desc_en: "Find files and execute command", distro: "common" },
        BuiltinCommand { title_zh: "查找并删除", title_en: "Find and delete", command: "find . -name '' -delete", desc_zh: "查找并删除匹配的文件", desc_en: "Find and delete matching files", distro: "common" },
        BuiltinCommand { title_zh: "查找空文件", title_en: "Find empty files", command: "find . -empty -type f", desc_zh: "查找所有空文件", desc_en: "Find all empty files", distro: "common" },
        BuiltinCommand { title_zh: "查找空目录", title_en: "Find empty dirs", command: "find . -empty -type d", desc_zh: "查找所有空目录", desc_en: "Find all empty directories", distro: "common" },
        BuiltinCommand { title_zh: "查找较新文件", title_en: "Find newer files", command: "find . -newer ", desc_zh: "查找比指定文件更新的文件", desc_en: "Find files newer than reference", distro: "common" },
        BuiltinCommand { title_zh: "按大小查找文件", title_en: "Find by size", command: "find . -type f -size +10M -size -100M", desc_zh: "查找10M到100M之间的文件", desc_en: "Find files between 10M and 100M", distro: "common" },
        BuiltinCommand { title_zh: "按权限查找", title_en: "Find by perm", command: "find . -perm 777", desc_zh: "查找指定权限的文件", desc_en: "Find files with specific permissions", distro: "common" },
        // ── Common: 文本搜索 ──
        BuiltinCommand { title_zh: "搜索文本", title_en: "Grep text", command: "grep  file", desc_zh: "在文件中搜索文本", desc_en: "Search text in a file", distro: "common" },
        BuiltinCommand { title_zh: "忽略大小写搜索", title_en: "Grep case-insensitive", command: "grep -i  file", desc_zh: "忽略大小写搜索文本", desc_en: "Search text case-insensitively", distro: "common" },
        BuiltinCommand { title_zh: "反向匹配", title_en: "Grep invert match", command: "grep -v  file", desc_zh: "显示不匹配的行", desc_en: "Show lines NOT matching pattern", distro: "common" },
        BuiltinCommand { title_zh: "递归搜索", title_en: "Grep recursive", command: "grep -rn '' .", desc_zh: "递归搜索文件中的文本", desc_en: "Search text in files recursively", distro: "common" },
        BuiltinCommand { title_zh: "带上下文搜索", title_en: "Grep with context", command: "grep -C 3  file", desc_zh: "搜索并显示上下3行", desc_en: "Search with 3 lines of context", distro: "common" },
        // ── Common: 网络连接 ──
        BuiltinCommand { title_zh: "监听端口", title_en: "Network connections", command: "ss -tulnp", desc_zh: "显示所有监听端口", desc_en: "Show all listening ports", distro: "common" },
        BuiltinCommand { title_zh: "TCP连接", title_en: "TCP connections", command: "ss -tn", desc_zh: "显示TCP连接", desc_en: "Show TCP connections", distro: "common" },
        BuiltinCommand { title_zh: "Socket统计", title_en: "Socket summary", command: "ss -s", desc_zh: "显示Socket统计摘要", desc_en: "Show socket statistics summary", distro: "common" },
        BuiltinCommand { title_zh: "监听端口（旧版）", title_en: "Netstat listening", command: "netstat -tlnp", desc_zh: "显示监听端口（旧版命令）", desc_en: "Show listening ports (legacy)", distro: "common" },
        BuiltinCommand { title_zh: "所有网络连接", title_en: "Netstat all", command: "netstat -anp", desc_zh: "显示所有网络连接", desc_en: "Show all network connections", distro: "common" },
        BuiltinCommand { title_zh: "网络接口", title_en: "Network interfaces", command: "ip addr", desc_zh: "显示网络接口信息", desc_en: "Show network interfaces", distro: "common" },
        BuiltinCommand { title_zh: "网络接口（简要）", title_en: "IP addr brief", command: "ip -br a", desc_zh: "以简要格式显示网络接口", desc_en: "Show interfaces in brief format", distro: "common" },
        BuiltinCommand { title_zh: "链路状态", title_en: "Link status", command: "ip link", desc_zh: "显示网络链路状态", desc_en: "Show network link status", distro: "common" },
        BuiltinCommand { title_zh: "Ping主机", title_en: "Ping host", command: "ping ", desc_zh: "持续Ping主机", desc_en: "Ping a host continuously", distro: "common" },
        BuiltinCommand { title_zh: "Ping指定次数", title_en: "Ping count", command: "ping -c 4 ", desc_zh: "Ping主机4次", desc_en: "Ping a host 4 times", distro: "common" },
        BuiltinCommand { title_zh: "DNS查询", title_en: "DNS lookup", command: "dig ", desc_zh: "查询域名DNS记录", desc_en: "DNS lookup for a domain", distro: "common" },
        BuiltinCommand { title_zh: "DNS简短查询", title_en: "DNS short answer", command: "dig +short ", desc_zh: "DNS查询（仅简短答案）", desc_en: "DNS lookup (short answer only)", distro: "common" },
        BuiltinCommand { title_zh: "DNS MX记录", title_en: "DNS MX records", command: "dig MX ", desc_zh: "查询邮件交换记录", desc_en: "Lookup mail exchange records", distro: "common" },
        BuiltinCommand { title_zh: "DNS NS记录", title_en: "DNS NS records", command: "dig NS ", desc_zh: "查询域名服务器记录", desc_en: "Lookup name server records", distro: "common" },
        BuiltinCommand { title_zh: "NS域名查询", title_en: "NS lookup", command: "nslookup ", desc_zh: "DNS域名查询", desc_en: "DNS name server lookup", distro: "common" },
        BuiltinCommand { title_zh: "主机查询", title_en: "Host lookup", command: "host ", desc_zh: "简单的DNS查询", desc_en: "DNS lookup simple", distro: "common" },
        // ── Common: HTTP请求 ──
        BuiltinCommand { title_zh: "HTTP GET请求", title_en: "Curl GET", command: "curl ", desc_zh: "发起HTTP GET请求", desc_en: "HTTP GET request", distro: "common" },
        BuiltinCommand { title_zh: "静默HTTP请求", title_en: "Curl silent", command: "curl -s ", desc_zh: "静默模式HTTP请求", desc_en: "HTTP GET (silent mode)", distro: "common" },
        BuiltinCommand { title_zh: "获取响应头", title_en: "Curl headers", command: "curl -I ", desc_zh: "仅获取HTTP响应头", desc_en: "Fetch HTTP headers only", distro: "common" },
        BuiltinCommand { title_zh: "POST JSON请求", title_en: "Curl POST JSON", command: "curl -X POST -H 'Content-Type: application/json' -d '' ", desc_zh: "发送JSON POST请求", desc_en: "Send JSON POST request", distro: "common" },
        BuiltinCommand { title_zh: "POST表单请求", title_en: "Curl POST form", command: "curl -X POST -d 'key=value' ", desc_zh: "发送POST表单数据", desc_en: "Send POST form data", distro: "common" },
        BuiltinCommand { title_zh: "带认证请求", title_en: "Curl with auth", command: "curl -u user:pass ", desc_zh: "带基本认证的HTTP请求", desc_en: "HTTP request with basic auth", distro: "common" },
        BuiltinCommand { title_zh: "下载文件", title_en: "Curl download", command: "curl -o filename ", desc_zh: "使用curl下载文件", desc_en: "Download file with curl", distro: "common" },
        BuiltinCommand { title_zh: "跟随重定向", title_en: "Curl follow redirect", command: "curl -L ", desc_zh: "跟随HTTP重定向", desc_en: "Follow HTTP redirects", distro: "common" },
        BuiltinCommand { title_zh: "详细输出请求", title_en: "Curl verbose", command: "curl -v ", desc_zh: "显示详细的HTTP请求信息", desc_en: "HTTP request with verbose output", distro: "common" },
        BuiltinCommand { title_zh: "跳过SSL验证", title_en: "Curl insecure", command: "curl -k ", desc_zh: "跳过SSL证书验证的请求", desc_en: "Skip SSL certificate verification", distro: "common" },
        BuiltinCommand { title_zh: "指定DNS解析", title_en: "Curl resolve", command: "curl --resolve example.com:443:1.2.3.4 https://example.com", desc_zh: "手动指定域名的DNS解析地址", desc_en: "Manually resolve domain to IP", distro: "common" },
        BuiltinCommand { title_zh: "上传文件", title_en: "Curl upload", command: "curl -T  sftp://user@host/path/", desc_zh: "使用curl上传文件", desc_en: "Upload file with curl", distro: "common" },
        BuiltinCommand { title_zh: "限速下载", title_en: "Curl limit rate", command: "curl --limit-rate 1M -O ", desc_zh: "限速下载文件", desc_en: "Download file with rate limit", distro: "common" },
        BuiltinCommand { title_zh: "Wget下载", title_en: "Download file", command: "wget ", desc_zh: "使用wget下载文件", desc_en: "Download file with wget", distro: "common" },
        BuiltinCommand { title_zh: "下载并重命名", title_en: "Download rename", command: "wget -O  ", desc_zh: "下载文件并重命名", desc_en: "Download file and rename", distro: "common" },
        BuiltinCommand { title_zh: "断点续传", title_en: "Download continue", command: "wget -c ", desc_zh: "恢复中断的下载", desc_en: "Resume interrupted download", distro: "common" },
        BuiltinCommand { title_zh: "镜像网站", title_en: "Wget mirror", command: "wget -m ", desc_zh: "递归镜像整个网站", desc_en: "Mirror a website recursively", distro: "common" },
        // ── Common: 压缩解压 ──
        BuiltinCommand { title_zh: "tar gzip压缩", title_en: "Tar compress", command: "tar -czf archive.tar.gz ", desc_zh: "创建gzip压缩归档", desc_en: "Create gzip compressed archive", distro: "common" },
        BuiltinCommand { title_zh: "解压gzip", title_en: "Tar extract gz", command: "tar -xzf ", desc_zh: "解压gzip归档", desc_en: "Extract gzip archive", distro: "common" },
        BuiltinCommand { title_zh: "解压bzip2", title_en: "Tar extract bz2", command: "tar -xjf ", desc_zh: "解压bzip2归档", desc_en: "Extract bzip2 archive", distro: "common" },
        BuiltinCommand { title_zh: "列出归档内容", title_en: "Tar list contents", command: "tar -tzf ", desc_zh: "列出gzip归档内容", desc_en: "List contents of gzip archive", distro: "common" },
        BuiltinCommand { title_zh: "解压tar", title_en: "Tar extract plain", command: "tar -xf ", desc_zh: "解压普通tar归档", desc_en: "Extract plain tar archive", distro: "common" },
        // ── Common: 权限管理 ──
        BuiltinCommand { title_zh: "设置权限755", title_en: "File permissions", command: "chmod 755 ", desc_zh: "设置文件权限为755", desc_en: "Set file permissions to 755", distro: "common" },
        BuiltinCommand { title_zh: "设置权限644", title_en: "Permissions 644", command: "chmod 644 ", desc_zh: "设置文件权限为644", desc_en: "Set file permissions to 644", distro: "common" },
        BuiltinCommand { title_zh: "设置权限777", title_en: "Permissions 777", command: "chmod 777 ", desc_zh: "设置文件权限为777", desc_en: "Set file permissions to 777", distro: "common" },
        BuiltinCommand { title_zh: "添加执行权限", title_en: "Add execute bit", command: "chmod +x ", desc_zh: "为文件添加执行权限", desc_en: "Make file executable", distro: "common" },
        BuiltinCommand { title_zh: "递归设置权限", title_en: "Chmod recursive", command: "chmod -R 755 ", desc_zh: "递归设置目录权限", desc_en: "Set permissions recursively", distro: "common" },
        BuiltinCommand { title_zh: "修改所有者", title_en: "Change owner", command: "chown user:group ", desc_zh: "修改文件所有者和组", desc_en: "Change file ownership", distro: "common" },
        BuiltinCommand { title_zh: "递归修改所有者", title_en: "Chown recursive", command: "chown -R user:group ", desc_zh: "递归修改文件所有者", desc_en: "Change ownership recursively", distro: "common" },
        BuiltinCommand { title_zh: "修改所属组", title_en: "Change group", command: "chgrp  file", desc_zh: "修改文件所属组", desc_en: "Change file group", distro: "common" },
        // ── Common: SSH ──
        BuiltinCommand { title_zh: "生成SSH密钥(ED25519)", title_en: "SSH key generate", command: "ssh-keygen -t ed25519 -C ''", desc_zh: "生成ED25519 SSH密钥", desc_en: "Generate ED25519 SSH key", distro: "common" },
        BuiltinCommand { title_zh: "生成SSH密钥(RSA)", title_en: "SSH key generate RSA", command: "ssh-keygen -t rsa -b 4096 -C ''", desc_zh: "生成RSA 4096 SSH密钥", desc_en: "Generate RSA 4096 SSH key", distro: "common" },
        BuiltinCommand { title_zh: "SSH连接", title_en: "SSH connect", command: "ssh user@host", desc_zh: "通过SSH连接远程主机", desc_en: "Connect to remote host via SSH", distro: "common" },
        BuiltinCommand { title_zh: "SSH指定端口连接", title_en: "SSH with port", command: "ssh -p 2222 user@host", desc_zh: "使用自定义端口SSH连接", desc_en: "SSH connect with custom port", distro: "common" },
        BuiltinCommand { title_zh: "复制SSH密钥", title_en: "SSH copy key", command: "ssh-copy-id user@host", desc_zh: "将SSH密钥复制到远程主机", desc_en: "Copy SSH key to remote host", distro: "common" },
        BuiltinCommand { title_zh: "SCP上传文件", title_en: "SCP upload", command: "scp  user@host:/path/", desc_zh: "上传文件到远程主机", desc_en: "Copy file to remote host", distro: "common" },
        BuiltinCommand { title_zh: "SCP下载文件", title_en: "SCP download", command: "scp user@host:/path/file .", desc_zh: "从远程主机下载文件", desc_en: "Copy file from remote host", distro: "common" },
        BuiltinCommand { title_zh: "SCP上传目录", title_en: "SCP directory", command: "scp -r dir user@host:/path/", desc_zh: "上传目录到远程主机", desc_en: "Copy directory to remote host", distro: "common" },
        BuiltinCommand { title_zh: "Rsync同步", title_en: "Rsync sync", command: "rsync -avz --progress ", desc_zh: "使用rsync同步文件", desc_en: "Sync files with rsync", distro: "common" },
        BuiltinCommand { title_zh: "Rsync镜像同步", title_en: "Rsync delete sync", command: "rsync -avz --delete ", desc_zh: "同步文件，删除目标多余文件", desc_en: "Sync files, delete extras on dest", distro: "common" },
        BuiltinCommand { title_zh: "SSH本地端口转发", title_en: "SSH tunnel local", command: "ssh -L 8080:localhost:80 user@host", desc_zh: "创建SSH本地端口转发", desc_en: "Create SSH local port forward", distro: "common" },
        BuiltinCommand { title_zh: "SSH远程端口转发", title_en: "SSH tunnel remote", command: "ssh -R 8080:localhost:80 user@host", desc_zh: "创建SSH远程端口转发", desc_en: "Create SSH remote port forward", distro: "common" },
        BuiltinCommand { title_zh: "SSH SOCKS代理", title_en: "SSH SOCKS proxy", command: "ssh -D 1080 user@host", desc_zh: "通过SSH创建SOCKS代理", desc_en: "Create SOCKS proxy via SSH", distro: "common" },
        BuiltinCommand { title_zh: "SSH跳板机", title_en: "SSH proxy jump", command: "ssh -J jumphost user@target", desc_zh: "通过跳板机连接目标主机", desc_en: "Connect to target via jump host", distro: "common" },
        BuiltinCommand { title_zh: "添加SSH密钥到Agent", title_en: "SSH add key", command: "ssh-add ", desc_zh: "将SSH私钥添加到Agent", desc_en: "Add SSH private key to agent", distro: "common" },
        BuiltinCommand { title_zh: "列出SSH密钥", title_en: "SSH list keys", command: "ssh-add -l", desc_zh: "列出Agent中所有SSH密钥", desc_en: "List all SSH keys in agent", distro: "common" },
        // ── Common: 进程控制 ──
        BuiltinCommand { title_zh: "终止进程", title_en: "Kill process", command: "kill ", desc_zh: "发送SIGTERM信号终止进程", desc_en: "Send SIGTERM to process", distro: "common" },
        BuiltinCommand { title_zh: "强制终止进程", title_en: "Kill -9", command: "kill -9 ", desc_zh: "强制终止进程（SIGKILL）", desc_en: "Force kill a process by PID", distro: "common" },
        BuiltinCommand { title_zh: "按名称终止", title_en: "Kill by name", command: "killall ", desc_zh: "按名称终止所有进程", desc_en: "Kill all processes by name", distro: "common" },
        BuiltinCommand { title_zh: "按模式终止", title_en: "Pkill pattern", command: "pkill -f ", desc_zh: "按命令模式终止进程", desc_en: "Kill processes by name pattern", distro: "common" },
        BuiltinCommand { title_zh: "系统时间", title_en: "System date", command: "date '+%Y-%m-%d %H:%M:%S'", desc_zh: "显示当前日期和时间", desc_en: "Show current date and time", distro: "common" },
        BuiltinCommand { title_zh: "定时执行命令", title_en: "Watch command", command: "watch -n 2 ", desc_zh: "每2秒执行一次命令", desc_en: "Run command every 2 seconds", distro: "common" },
        BuiltinCommand { title_zh: "搜索历史命令", title_en: "History search", command: "history | grep ", desc_zh: "搜索命令历史", desc_en: "Search command history", distro: "common" },
        BuiltinCommand { title_zh: "重定向输出", title_en: "Redirect output", command: "command > output.log 2>&1", desc_zh: "将标准输出和错误重定向到文件", desc_en: "Redirect stdout and stderr to file", distro: "common" },
        BuiltinCommand { title_zh: "后台运行", title_en: "Background job", command: "nohup command &", desc_zh: "在后台运行命令", desc_en: "Run command in background", distro: "common" },
        BuiltinCommand { title_zh: "查看后台任务", title_en: "List jobs", command: "jobs -l", desc_zh: "列出当前Shell的后台任务", desc_en: "List background jobs in current shell", distro: "common" },
        BuiltinCommand { title_zh: "后台继续运行", title_en: "Background job", command: "bg %1", desc_zh: "将挂起的任务放到后台继续执行", desc_en: "Resume suspended job in background", distro: "common" },
        BuiltinCommand { title_zh: "前台恢复任务", title_en: "Foreground job", command: "fg %1", desc_zh: "将后台任务恢复到前台执行", desc_en: "Bring background job to foreground", distro: "common" },
        BuiltinCommand { title_zh: "脱离终端", title_en: "Disown job", command: "disown -h %1", desc_zh: "使任务脱离当前Shell（退出不终止）", desc_en: "Detach job from current shell", distro: "common" },
        BuiltinCommand { title_zh: "一次性定时任务", title_en: "At schedule", command: "echo 'command' | at 10:00", desc_zh: "在指定时间执行一次命令", desc_en: "Execute command once at specified time", distro: "common" },
        BuiltinCommand { title_zh: "Screen会话", title_en: "Screen session", command: "screen -S session_name", desc_zh: "创建命名的screen会话", desc_en: "Create named screen session", distro: "common" },
        BuiltinCommand { title_zh: "Screen会话列表", title_en: "Screen list", command: "screen -ls", desc_zh: "列出所有screen会话", desc_en: "List all screen sessions", distro: "common" },
        BuiltinCommand { title_zh: "恢复Screen会话", title_en: "Screen resume", command: "screen -r session_name", desc_zh: "重新连接到screen会话", desc_en: "Reattach to screen session", distro: "common" },
        BuiltinCommand { title_zh: "Tmux会话", title_en: "Tmux session", command: "tmux new -s session_name", desc_zh: "创建命名的tmux会话", desc_en: "Create named tmux session", distro: "common" },
        BuiltinCommand { title_zh: "Tmux会话列表", title_en: "Tmux list", command: "tmux ls", desc_zh: "列出所有tmux会话", desc_en: "List all tmux sessions", distro: "common" },
        BuiltinCommand { title_zh: "恢复Tmux会话", title_en: "Tmux attach", command: "tmux attach -t session_name", desc_zh: "重新连接到tmux会话", desc_en: "Reattach to tmux session", distro: "common" },
        BuiltinCommand { title_zh: "终止Tmux会话", title_en: "Tmux kill session", command: "tmux kill-session -t session_name", desc_zh: "终止指定tmux会话", desc_en: "Kill specified tmux session", distro: "common" },

        // ── Common: 用户管理 ──
        BuiltinCommand { title_zh: "创建用户", title_en: "Add user", command: "sudo useradd -m ", desc_zh: "创建新用户并建立主目录", desc_en: "Create a new user with home directory", distro: "common" },
        BuiltinCommand { title_zh: "删除用户", title_en: "Delete user", command: "sudo userdel -r ", desc_zh: "删除用户及其主目录", desc_en: "Delete user and home directory", distro: "common" },
        BuiltinCommand { title_zh: "修改密码", title_en: "Change password", command: "passwd ", desc_zh: "修改用户密码", desc_en: "Change user password", distro: "common" },
        BuiltinCommand { title_zh: "添加到用户组", title_en: "Add to group", command: "sudo usermod -aG  username", desc_zh: "将用户添加到用户组", desc_en: "Add user to a group", distro: "common" },
        BuiltinCommand { title_zh: "切换用户", title_en: "Switch user", command: "su - ", desc_zh: "切换到其他用户", desc_en: "Switch to another user", distro: "common" },
        BuiltinCommand { title_zh: "切换到root", title_en: "Sudo as root", command: "sudo -i", desc_zh: "打开root交互式shell", desc_en: "Open interactive root shell", distro: "common" },
        BuiltinCommand { title_zh: "查看用户组", title_en: "List groups", command: "groups ", desc_zh: "显示用户所属组", desc_en: "Show groups for a user", distro: "common" },
        BuiltinCommand { title_zh: "用户ID信息", title_en: "ID info", command: "id ", desc_zh: "显示用户UID/GID信息", desc_en: "Show user UID/GID info", distro: "common" },

        // ── Common: 磁盘与文件系统 ──
        BuiltinCommand { title_zh: "磁盘分区", title_en: "Disk partitions", command: "sudo fdisk -l", desc_zh: "列出磁盘分区", desc_en: "List disk partitions", distro: "common" },
        BuiltinCommand { title_zh: "格式化为ext4", title_en: "Make filesystem", command: "sudo mkfs.ext4 ", desc_zh: "将分区格式化为ext4", desc_en: "Format partition as ext4", distro: "common" },
        BuiltinCommand { title_zh: "文件系统检查", title_en: "Filesystem check", command: "sudo fsck -y ", desc_zh: "检查并修复文件系统", desc_en: "Check and repair filesystem", distro: "common" },
        BuiltinCommand { title_zh: "挂载设备", title_en: "Mount device", command: "sudo mount /dev/sdXn /mnt", desc_zh: "挂载设备", desc_en: "Mount a device", distro: "common" },
        BuiltinCommand { title_zh: "卸载设备", title_en: "Unmount device", command: "sudo umount /mnt", desc_zh: "卸载设备", desc_en: "Unmount a device", distro: "common" },
        BuiltinCommand { title_zh: "挂载配置表", title_en: "Fstab entries", command: "cat /etc/fstab", desc_zh: "显示文件系统挂载配置", desc_en: "Show filesystem mount table", distro: "common" },
        BuiltinCommand { title_zh: "Inode使用情况", title_en: "Inode usage", command: "df -i", desc_zh: "显示各文件系统Inode使用情况", desc_en: "Show inode usage per filesystem", distro: "common" },

        // ── Common: 网络诊断 ──
        BuiltinCommand { title_zh: "路由追踪", title_en: "Traceroute", command: "traceroute ", desc_zh: "追踪到主机的路由路径", desc_en: "Trace route to host", distro: "common" },
        BuiltinCommand { title_zh: "MTR网络诊断", title_en: "MTR report", command: "mtr -r -c 10 ", desc_zh: "网络诊断（路由追踪+Ping）", desc_en: "Network diagnostic (traceroute+ping)", distro: "common" },
        BuiltinCommand { title_zh: "Netcat监听", title_en: "Netcat listen", command: "nc -lvnp ", desc_zh: "使用netcat监听端口", desc_en: "Listen on a port with netcat", distro: "common" },
        BuiltinCommand { title_zh: "端口测试", title_en: "Netcat port test", command: "nc -zv  ", desc_zh: "测试端口是否开放", desc_en: "Test if a port is open", distro: "common" },
        BuiltinCommand { title_zh: "抓包（指定端口）", title_en: "TCP dump", command: "sudo tcpdump -i eth0 port 80", desc_zh: "抓取80端口数据包", desc_en: "Capture packets on port 80", distro: "common" },
        BuiltinCommand { title_zh: "抓包（指定主机）", title_en: "TCP dump host", command: "sudo tcpdump host ", desc_zh: "抓取指定主机的数据包", desc_en: "Capture packets to/from host", distro: "common" },
        BuiltinCommand { title_zh: "TCP端口扫描", title_en: "Port scan", command: "nmap -sT -p- ", desc_zh: "TCP端口扫描", desc_en: "TCP port scan", distro: "common" },
        BuiltinCommand { title_zh: "服务版本探测", title_en: "Nmap service scan", command: "nmap -sV ", desc_zh: "探测主机上运行的服务版本", desc_en: "Detect service versions on host", distro: "common" },
        BuiltinCommand { title_zh: "路由表", title_en: "Route table", command: "ip route", desc_zh: "显示路由表", desc_en: "Show routing table", distro: "common" },
        BuiltinCommand { title_zh: "添加静态路由", title_en: "Add route", command: "sudo ip route add via ", desc_zh: "添加静态路由", desc_en: "Add a static route", distro: "common" },
        BuiltinCommand { title_zh: "ARP表", title_en: "ARP table", command: "ip neigh", desc_zh: "显示ARP表/邻居", desc_en: "Show ARP table / neighbors", distro: "common" },
        BuiltinCommand { title_zh: "网卡设置查看", title_en: "Ethtool", command: "sudo ethtool eth0", desc_zh: "查看网卡硬件设置和状态", desc_en: "Show NIC hardware settings", distro: "common" },
        BuiltinCommand { title_zh: "网卡统计信息", title_en: "Ethtool stats", command: "ethtool -S eth0", desc_zh: "查看网卡收发包统计", desc_en: "Show NIC packet statistics", distro: "common" },
        BuiltinCommand { title_zh: "Nftables规则", title_en: "Nft list", command: "sudo nft list ruleset", desc_zh: "列出nftables防火墙规则", desc_en: "List nftables rules", distro: "common" },
        BuiltinCommand { title_zh: "DNS解析缓存", title_en: "Systemd-resolve", command: "resolvectl status", desc_zh: "查看DNS解析状态", desc_en: "Show DNS resolution status", distro: "common" },

        // ── Common: 进程与监控 ──
        BuiltinCommand { title_zh: "端口占用进程", title_en: "Open files", command: "lsof -i :80", desc_zh: "查看占用80端口的进程", desc_en: "List processes using port 80", distro: "common" },
        BuiltinCommand { title_zh: "用户打开的文件", title_en: "Lsof user files", command: "lsof -u ", desc_zh: "列出用户打开的文件", desc_en: "List open files for a user", distro: "common" },
        BuiltinCommand { title_zh: "跟踪系统调用", title_en: "Strace process", command: "strace -p ", desc_zh: "跟踪进程的系统调用", desc_en: "Trace system calls of a process", distro: "common" },
        BuiltinCommand { title_zh: "进程树（带PID）", title_en: "Process tree", command: "pstree -p", desc_zh: "显示带PID的进程树", desc_en: "Show process tree with PIDs", distro: "common" },
        BuiltinCommand { title_zh: "指定优先级运行", title_en: "Nice priority", command: "nice -n 10 ", desc_zh: "以自定义优先级运行命令", desc_en: "Run command with custom priority", distro: "common" },
        BuiltinCommand { title_zh: "CPU使用率统计", title_en: "Sar CPU", command: "sar -u 1 5", desc_zh: "CPU使用率统计信息", desc_en: "CPU usage statistics", distro: "common" },
        BuiltinCommand { title_zh: "系统负载", title_en: "Load average", command: "cat /proc/loadavg", desc_zh: "显示系统负载均值", desc_en: "Show system load average", distro: "common" },
        BuiltinCommand { title_zh: "CPU架构信息", title_en: "CPU info", command: "lscpu", desc_zh: "显示CPU架构信息", desc_en: "Show CPU architecture info", distro: "common" },
        BuiltinCommand { title_zh: "PCI设备列表", title_en: "PCI devices", command: "lspci", desc_zh: "列出PCI设备", desc_en: "List PCI devices", distro: "common" },
        BuiltinCommand { title_zh: "USB设备列表", title_en: "USB devices", command: "lsusb", desc_zh: "列出USB设备", desc_en: "List USB devices", distro: "common" },

        // ── Common: 文本处理 ──
        BuiltinCommand { title_zh: "替换文本", title_en: "Stream edit", command: "sed -i 's/old/new/g' ", desc_zh: "在文件中替换文本（原地修改）", desc_en: "Replace text in file in-place", distro: "common" },
        BuiltinCommand { title_zh: "AWK提取列", title_en: "AWK print", command: "awk '{print $1}' ", desc_zh: "打印文件的第一列", desc_en: "Print first column of file", distro: "common" },
        BuiltinCommand { title_zh: "查看前N行", title_en: "Head lines", command: "head -n 20 ", desc_zh: "显示文件前20行", desc_en: "Show first 20 lines", distro: "common" },
        BuiltinCommand { title_zh: "统计行数", title_en: "Word count", command: "wc -l ", desc_zh: "统计文件行数", desc_en: "Count lines in file", distro: "common" },
        BuiltinCommand { title_zh: "排序去重统计", title_en: "Sort unique", command: "sort  | uniq -c | sort -rn", desc_zh: "统计并排序唯一行", desc_en: "Count and sort unique lines", distro: "common" },
        BuiltinCommand { title_zh: "提取列", title_en: "Cut column", command: "cut -d',' -f1 ", desc_zh: "提取CSV的第一列", desc_en: "Extract first CSV column", distro: "common" },
        BuiltinCommand { title_zh: "对齐列输出", title_en: "Column format", command: "column -t -s',' ", desc_zh: "将输出按列对齐", desc_en: "Align columns in output", distro: "common" },
        BuiltinCommand { title_zh: "比较文件差异", title_en: "Diff files", command: "diff -u  file2", desc_zh: "比较两个文件", desc_en: "Compare two files", distro: "common" },
        BuiltinCommand { title_zh: "批量执行", title_en: "Xargs execute", command: "find . -name '*.log' | xargs rm -f", desc_zh: "对查找到的文件执行命令", desc_en: "Execute command on found files", distro: "common" },
        BuiltinCommand { title_zh: "Xargs替换执行", title_en: "Xargs replace", command: "find . -name '*.jpg' | xargs -I {} cp {} /dest/", desc_zh: "对每个结果执行命令（支持替换）", desc_en: "Execute command on each result with substitution", distro: "common" },
        BuiltinCommand { title_zh: "字符替换", title_en: "Translate chars", command: "tr 'a-z' 'A-Z' < ", desc_zh: "替换或删除字符", desc_en: "Replace or delete characters", distro: "common" },
        BuiltinCommand { title_zh: "删除字符", title_en: "Delete chars", command: "tr -d '\\r' < win.txt > unix.txt", desc_zh: "删除指定字符", desc_en: "Delete specified characters", distro: "common" },
        BuiltinCommand { title_zh: "倒序输出", title_en: "Reverse output", command: "tac ", desc_zh: "倒序显示文件内容", desc_en: "Display file in reverse order", distro: "common" },
        BuiltinCommand { title_zh: "分割文件", title_en: "Split file", command: "split -l 1000  prefix_", desc_zh: "按行数分割文件", desc_en: "Split file by line count", distro: "common" },
        BuiltinCommand { title_zh: "按大小分割", title_en: "Split by size", command: "split -b 100M  prefix_", desc_zh: "按大小分割文件", desc_en: "Split file by size", distro: "common" },
        BuiltinCommand { title_zh: "随机排序", title_en: "Shuffle lines", command: "shuf ", desc_zh: "随机打乱文件行序", desc_en: "Randomly shuffle lines", distro: "common" },
        BuiltinCommand { title_zh: "合并文件行", title_en: "Paste lines", command: "paste file1 file2", desc_zh: "按列合并多个文件的行", desc_en: "Merge lines from multiple files", distro: "common" },
        BuiltinCommand { title_zh: "比较排序文件", title_en: "Comm compare", command: "comm -23 <(sort a.txt) <(sort b.txt)", desc_zh: "比较两个已排序文件（仅显示A独有的行）", desc_en: "Compare sorted files (lines only in A)", distro: "common" },

        // ── Common: 其他压缩格式 ──
        BuiltinCommand { title_zh: "Zip压缩", title_en: "Zip compress", command: "zip -r archive.zip ", desc_zh: "创建zip归档", desc_en: "Create zip archive", distro: "common" },
        BuiltinCommand { title_zh: "解压Zip", title_en: "Unzip", command: "unzip -o ", desc_zh: "解压zip归档", desc_en: "Extract zip archive", distro: "common" },
        BuiltinCommand { title_zh: "Bzip2压缩", title_en: "Bzip2 compress", command: "tar -cjf archive.tar.bz2 ", desc_zh: "创建bzip2归档", desc_en: "Create bzip2 archive", distro: "common" },
        BuiltinCommand { title_zh: "XZ压缩", title_en: "XZ compress", command: "tar -cJf archive.tar.xz ", desc_zh: "创建xz归档", desc_en: "Create xz archive", distro: "common" },
        BuiltinCommand { title_zh: "压缩排除文件", title_en: "Tar exclude", command: "tar -czf archive.tar.gz --exclude='*.log' --exclude='node_modules' ", desc_zh: "压缩时排除指定文件和目录", desc_en: "Create archive excluding patterns", distro: "common" },

        // ── Common: 服务与系统控制 ──
        BuiltinCommand { title_zh: "查看服务状态", title_en: "Systemctl status", command: "systemctl status ", desc_zh: "查看服务运行状态", desc_en: "Check service status", distro: "common" },
        BuiltinCommand { title_zh: "启动服务", title_en: "Systemctl start", command: "sudo systemctl start ", desc_zh: "启动服务", desc_en: "Start a service", distro: "common" },
        BuiltinCommand { title_zh: "停止服务", title_en: "Systemctl stop", command: "sudo systemctl stop ", desc_zh: "停止服务", desc_en: "Stop a service", distro: "common" },
        BuiltinCommand { title_zh: "重启服务", title_en: "Systemctl restart", command: "sudo systemctl restart ", desc_zh: "重启服务", desc_en: "Restart a service", distro: "common" },
        BuiltinCommand { title_zh: "开机自启服务", title_en: "Systemctl enable", command: "sudo systemctl enable ", desc_zh: "设置服务开机自启", desc_en: "Enable service at boot", distro: "common" },
        BuiltinCommand { title_zh: "禁止开机自启", title_en: "Systemctl disable", command: "sudo systemctl disable ", desc_zh: "禁止服务开机自启", desc_en: "Disable service at boot", distro: "common" },
        BuiltinCommand { title_zh: "重载服务配置", title_en: "Systemctl reload", command: "sudo systemctl reload ", desc_zh: "重载服务配置（不重启）", desc_en: "Reload service config (no restart)", distro: "common" },
        BuiltinCommand { title_zh: "重载Systemd配置", title_en: "Daemon reload", command: "sudo systemctl daemon-reload", desc_zh: "重载systemd单元文件", desc_en: "Reload systemd unit files", distro: "common" },
        BuiltinCommand { title_zh: "查看服务配置", title_en: "Systemctl cat", command: "systemctl cat ", desc_zh: "显示服务单元文件内容", desc_en: "Show service unit file content", distro: "common" },
        BuiltinCommand { title_zh: "服务是否活跃", title_en: "Systemctl is-active", command: "systemctl is-active ", desc_zh: "检查服务是否在运行", desc_en: "Check if service is active", distro: "common" },
        BuiltinCommand { title_zh: "列出所有服务", title_en: "List services", command: "systemctl list-units --type=service", desc_zh: "列出所有服务单元", desc_en: "List all service units", distro: "common" },
        BuiltinCommand { title_zh: "失败的服务", title_en: "Failed services", command: "systemctl --failed", desc_zh: "列出失败的服务单元", desc_en: "List failed service units", distro: "common" },
        BuiltinCommand { title_zh: "重置失败状态", title_en: "Reset failed", command: "sudo systemctl reset-failed", desc_zh: "重置所有失败单元状态", desc_en: "Reset all failed units", distro: "common" },
        BuiltinCommand { title_zh: "屏蔽服务", title_en: "Systemctl mask", command: "sudo systemctl mask ", desc_zh: "完全禁止服务被启动", desc_en: "Prevent service from being started", distro: "common" },
        BuiltinCommand { title_zh: "取消屏蔽", title_en: "Systemctl unmask", command: "sudo systemctl unmask ", desc_zh: "取消服务屏蔽", desc_en: "Unmask a previously masked service", distro: "common" },
        BuiltinCommand { title_zh: "编辑服务配置", title_en: "Systemctl edit", command: "sudo systemctl edit ", desc_zh: "编辑服务覆盖配置", desc_en: "Edit service override config", distro: "common" },
        BuiltinCommand { title_zh: "列出定时器", title_en: "List timers", command: "systemctl list-timers --all", desc_zh: "列出所有定时任务", desc_en: "List all systemd timers", distro: "common" },
        BuiltinCommand { title_zh: "用户会话列表", title_en: "List sessions", command: "loginctl list-sessions", desc_zh: "列出所有用户登录会话", desc_en: "List all user sessions", distro: "common" },
        BuiltinCommand { title_zh: "会话详情", title_en: "Session status", command: "loginctl session-status ", desc_zh: "查看指定会话的状态", desc_en: "Show session details", distro: "common" },

        // ── Common: Journalctl日志 ──
        BuiltinCommand { title_zh: "跟踪所有日志", title_en: "Journal follow", command: "journalctl -f", desc_zh: "实时跟踪所有系统日志", desc_en: "Follow all journal logs", distro: "common" },
        BuiltinCommand { title_zh: "跟踪服务日志", title_en: "Journal service", command: "journalctl -u  -f", desc_zh: "实时跟踪指定服务日志", desc_en: "Follow service logs", distro: "common" },
        BuiltinCommand { title_zh: "最近日志", title_en: "Journal recent", command: "journalctl -n 50 --no-pager", desc_zh: "显示最近50条日志", desc_en: "Show last 50 journal entries", distro: "common" },
        BuiltinCommand { title_zh: "最近一小时日志", title_en: "Journal since", command: "journalctl --since '1 hour ago'", desc_zh: "显示最近一小时的日志", desc_en: "Show logs from last hour", distro: "common" },
        BuiltinCommand { title_zh: "今天的日志", title_en: "Journal today", command: "journalctl --since today", desc_zh: "显示今天的日志", desc_en: "Show today's logs", distro: "common" },
        BuiltinCommand { title_zh: "本次启动日志", title_en: "Journal boot", command: "journalctl -b", desc_zh: "显示本次启动以来的日志", desc_en: "Show logs from current boot", distro: "common" },
        BuiltinCommand { title_zh: "内核日志", title_en: "Journal kernel", command: "journalctl -k", desc_zh: "显示内核消息", desc_en: "Show kernel messages", distro: "common" },
        BuiltinCommand { title_zh: "日志磁盘占用", title_en: "Journal disk usage", command: "journalctl --disk-usage", desc_zh: "显示日志的磁盘占用", desc_en: "Show journal disk usage", distro: "common" },
        BuiltinCommand { title_zh: "清理旧日志", title_en: "Journal vacuum", command: "sudo journalctl --vacuum-time=7d", desc_zh: "清理7天以前的日志", desc_en: "Remove logs older than 7 days", distro: "common" },
        BuiltinCommand { title_zh: "限制日志大小", title_en: "Journal vacuum size", command: "sudo journalctl --vacuum-size=500M", desc_zh: "限制日志总大小为500MB", desc_en: "Limit journal total size to 500MB", distro: "common" },

        // ── Common: 系统控制 ──
        BuiltinCommand { title_zh: "启动耗时分析", title_en: "Boot analyze", command: "systemd-analyze blame", desc_zh: "分析系统启动各服务耗时", desc_en: "Analyze boot time per service", distro: "common" },
        BuiltinCommand { title_zh: "启动耗时", title_en: "Boot time", command: "systemd-analyze", desc_zh: "显示系统启动总耗时", desc_en: "Show total boot time", distro: "common" },
        BuiltinCommand { title_zh: "重启系统", title_en: "Reboot system", command: "sudo reboot", desc_zh: "重启系统", desc_en: "Reboot the system", distro: "common" },
        BuiltinCommand { title_zh: "立即关机", title_en: "Shutdown now", command: "sudo shutdown -h now", desc_zh: "立即关闭系统", desc_en: "Shutdown immediately", distro: "common" },
        BuiltinCommand { title_zh: "5分钟后关机", title_en: "Shutdown in 5min", command: "sudo shutdown -h +5", desc_zh: "5分钟后关闭系统", desc_en: "Shutdown in 5 minutes", distro: "common" },
        BuiltinCommand { title_zh: "取消关机", title_en: "Cancel shutdown", command: "sudo shutdown -c", desc_zh: "取消计划中的关机", desc_en: "Cancel scheduled shutdown", distro: "common" },
        BuiltinCommand { title_zh: "立即断电关机", title_en: "Power off", command: "sudo poweroff", desc_zh: "立即关闭系统并断电", desc_en: "Power off the system immediately", distro: "common" },
        BuiltinCommand { title_zh: "停止系统", title_en: "Halt system", command: "sudo halt", desc_zh: "停止系统运行（不断电）", desc_en: "Halt system (no power off)", distro: "common" },
        BuiltinCommand { title_zh: "主机名", title_en: "Hostname", command: "hostnamectl", desc_zh: "显示或设置主机名", desc_en: "Show or set hostname", distro: "common" },
        BuiltinCommand { title_zh: "设置主机名", title_en: "Set hostname", command: "sudo hostnamectl set-hostname ", desc_zh: "设置系统主机名", desc_en: "Set system hostname", distro: "common" },
        BuiltinCommand { title_zh: "时间设置", title_en: "Time settings", command: "timedatectl", desc_zh: "显示时间和时区设置", desc_en: "Show time and timezone settings", distro: "common" },
        BuiltinCommand { title_zh: "设置时区", title_en: "Set timezone", command: "sudo timedatectl set-timezone ", desc_zh: "设置系统时区", desc_en: "Set system timezone", distro: "common" },
        BuiltinCommand { title_zh: "启用NTP同步", title_en: "NTP sync", command: "sudo timedatectl set-ntp true", desc_zh: "启用NTP时间同步", desc_en: "Enable NTP time sync", distro: "common" },
        BuiltinCommand { title_zh: "系统信息", title_en: "System info", command: "uname -a", desc_zh: "显示系统信息", desc_en: "Show system information", distro: "common" },
        BuiltinCommand { title_zh: "内核版本", title_en: "Kernel version", command: "uname -r", desc_zh: "显示内核版本", desc_en: "Show kernel release", distro: "common" },
        BuiltinCommand { title_zh: "系统发行版信息", title_en: "OS release", command: "cat /etc/os-release", desc_zh: "显示系统发行版信息", desc_en: "Show OS release info", distro: "common" },
        BuiltinCommand { title_zh: "运行时间", title_en: "Uptime", command: "uptime", desc_zh: "显示系统运行时间和负载", desc_en: "Show system uptime and load", distro: "common" },
        BuiltinCommand { title_zh: "在线用户", title_en: "Who logged in", command: "who", desc_zh: "显示当前登录用户", desc_en: "Show logged in users", distro: "common" },
        BuiltinCommand { title_zh: "用户活动", title_en: "Who am I", command: "w", desc_zh: "显示登录用户及其活动", desc_en: "Show who is logged in and doing what", distro: "common" },
        BuiltinCommand { title_zh: "最近登录", title_en: "Last logins", command: "last -n 20", desc_zh: "显示最近20次登录", desc_en: "Show last 20 logins", distro: "common" },
        BuiltinCommand { title_zh: "环境变量", title_en: "Environment", command: "env", desc_zh: "显示所有环境变量", desc_en: "Show all environment variables", distro: "common" },
        BuiltinCommand { title_zh: "区域设置", title_en: "Set locale", command: "locale", desc_zh: "显示当前区域设置", desc_en: "Show current locale settings", distro: "common" },
        BuiltinCommand { title_zh: "定时任务列表", title_en: "Cron list", command: "crontab -l", desc_zh: "列出定时任务", desc_en: "List cron jobs", distro: "common" },
        BuiltinCommand { title_zh: "编辑定时任务", title_en: "Cron edit", command: "crontab -e", desc_zh: "编辑定时任务", desc_en: "Edit cron jobs", distro: "common" },
        BuiltinCommand { title_zh: "内核参数", title_en: "Sysctl params", command: "sysctl -a | grep ", desc_zh: "显示内核参数", desc_en: "Show kernel parameters", distro: "common" },
        BuiltinCommand { title_zh: "资源限制", title_en: "Ulimit", command: "ulimit -a", desc_zh: "显示用户资源限制", desc_en: "Show user resource limits", distro: "common" },
        BuiltinCommand { title_zh: "内核环形缓冲区", title_en: "Dmesg", command: "dmesg | tail -30", desc_zh: "显示最近的内核消息", desc_en: "Show recent kernel ring buffer", distro: "common" },

        // ── Common: Iptables防火墙 ──
        BuiltinCommand { title_zh: "防火墙规则", title_en: "Iptables list", command: "sudo iptables -L -n -v", desc_zh: "列出所有防火墙规则", desc_en: "List all firewall rules", distro: "common" },
        BuiltinCommand { title_zh: "NAT规则", title_en: "Iptables NAT", command: "sudo iptables -t nat -L -n -v", desc_zh: "列出NAT规则", desc_en: "List NAT rules", distro: "common" },
        BuiltinCommand { title_zh: "允许端口", title_en: "Iptables allow port", command: "sudo iptables -A INPUT -p tcp --dport  -j ACCEPT", desc_zh: "允许TCP端口通过防火墙", desc_en: "Allow TCP port", distro: "common" },
        BuiltinCommand { title_zh: "封禁IP", title_en: "Iptables block IP", command: "sudo iptables -A INPUT -s  -j DROP", desc_zh: "封禁指定IP地址", desc_en: "Block an IP address", distro: "common" },
        BuiltinCommand { title_zh: "导出防火墙规则", title_en: "Iptables save", command: "sudo iptables-save", desc_zh: "导出当前防火墙规则", desc_en: "Dump current iptables rules", distro: "common" },

        // ── Common: Git版本控制 ──
        BuiltinCommand { title_zh: "克隆仓库", title_en: "Git clone", command: "git clone ", desc_zh: "克隆远程仓库", desc_en: "Clone a repository", distro: "common" },
        BuiltinCommand { title_zh: "仓库状态", title_en: "Git status", command: "git status", desc_zh: "查看工作区状态", desc_en: "Show working tree status", distro: "common" },
        BuiltinCommand { title_zh: "暂存所有更改", title_en: "Git add all", command: "git add -A", desc_zh: "暂存所有更改", desc_en: "Stage all changes", distro: "common" },
        BuiltinCommand { title_zh: "暂存文件", title_en: "Git add file", command: "git add ", desc_zh: "暂存指定文件", desc_en: "Stage a file", distro: "common" },
        BuiltinCommand { title_zh: "提交更改", title_en: "Git commit", command: "git commit -m ''", desc_zh: "提交暂存的更改", desc_en: "Commit staged changes", distro: "common" },
        BuiltinCommand { title_zh: "推送到远程", title_en: "Git push", command: "git push", desc_zh: "推送提交到远程仓库", desc_en: "Push commits to remote", distro: "common" },
        BuiltinCommand { title_zh: "强制推送", title_en: "Git push force", command: "git push --force", desc_zh: "强制推送到远程仓库", desc_en: "Force push to remote", distro: "common" },
        BuiltinCommand { title_zh: "拉取更新", title_en: "Git pull", command: "git pull", desc_zh: "从远程拉取并合并", desc_en: "Pull and merge from remote", distro: "common" },
        BuiltinCommand { title_zh: "获取远程更新", title_en: "Git fetch", command: "git fetch --all", desc_zh: "获取所有远程仓库更新", desc_en: "Fetch all remotes", distro: "common" },
        BuiltinCommand { title_zh: "查看未暂存更改", title_en: "Git diff", command: "git diff", desc_zh: "显示未暂存的更改", desc_en: "Show unstaged changes", distro: "common" },
        BuiltinCommand { title_zh: "查看已暂存更改", title_en: "Git diff staged", command: "git diff --cached", desc_zh: "显示已暂存的更改", desc_en: "Show staged changes", distro: "common" },
        BuiltinCommand { title_zh: "提交历史", title_en: "Git log", command: "git log --oneline -20", desc_zh: "显示最近20条提交", desc_en: "Show last 20 commits", distro: "common" },
        BuiltinCommand { title_zh: "提交图谱", title_en: "Git log graph", command: "git log --oneline --graph --all", desc_zh: "显示提交图谱", desc_en: "Show commit graph", distro: "common" },
        BuiltinCommand { title_zh: "分支列表", title_en: "Git branch list", command: "git branch -a", desc_zh: "列出所有分支", desc_en: "List all branches", distro: "common" },
        BuiltinCommand { title_zh: "创建分支", title_en: "Git branch create", command: "git checkout -b ", desc_zh: "创建并切换到新分支", desc_en: "Create and switch to branch", distro: "common" },
        BuiltinCommand { title_zh: "切换分支", title_en: "Git checkout", command: "git checkout ", desc_zh: "切换到指定分支", desc_en: "Switch branch", distro: "common" },
        BuiltinCommand { title_zh: "合并分支", title_en: "Git merge", command: "git merge ", desc_zh: "将分支合并到当前分支", desc_en: "Merge branch into current", distro: "common" },
        BuiltinCommand { title_zh: "暂存更改", title_en: "Git stash", command: "git stash", desc_zh: "暂存当前更改", desc_en: "Stash current changes", distro: "common" },
        BuiltinCommand { title_zh: "恢复暂存", title_en: "Git stash pop", command: "git stash pop", desc_zh: "恢复并移除最近的暂存", desc_en: "Apply and remove last stash", distro: "common" },
        BuiltinCommand { title_zh: "软重置", title_en: "Git reset soft", command: "git reset --soft HEAD~1", desc_zh: "撤销上次提交，保留更改在暂存区", desc_en: "Undo last commit, keep changes staged", distro: "common" },
        BuiltinCommand { title_zh: "硬重置", title_en: "Git reset hard", command: "git reset --hard HEAD~1", desc_zh: "撤销上次提交，丢弃所有更改", desc_en: "Undo last commit, discard changes", distro: "common" },
        BuiltinCommand { title_zh: "远程仓库列表", title_en: "Git remote list", command: "git remote -v", desc_zh: "列出远程仓库", desc_en: "List remote repositories", distro: "common" },
        BuiltinCommand { title_zh: "创建标签", title_en: "Git tag", command: "git tag ", desc_zh: "创建标签", desc_en: "Create a tag", distro: "common" },
        BuiltinCommand { title_zh: "查看提交详情", title_en: "Git show", command: "git show ", desc_zh: "显示提交详情", desc_en: "Show commit details", distro: "common" },
        BuiltinCommand { title_zh: "变基", title_en: "Git rebase", command: "git rebase ", desc_zh: "将当前分支变基到目标分支", desc_en: "Rebase current branch onto target", distro: "common" },
        BuiltinCommand { title_zh: "交互式变基", title_en: "Git rebase interactive", command: "git rebase -i HEAD~5", desc_zh: "交互式变基最近5个提交", desc_en: "Interactive rebase last 5 commits", distro: "common" },
        BuiltinCommand { title_zh: "继续变基", title_en: "Git rebase continue", command: "git rebase --continue", desc_zh: "解决冲突后继续变基", desc_en: "Continue rebase after resolving conflicts", distro: "common" },
        BuiltinCommand { title_zh: "中止变基", title_en: "Git rebase abort", command: "git rebase --abort", desc_zh: "中止当前变基操作", desc_en: "Abort the current rebase", distro: "common" },
        BuiltinCommand { title_zh: "摘取提交", title_en: "Git cherry-pick", command: "git cherry-pick ", desc_zh: "将指定提交应用到当前分支", desc_en: "Apply specific commit to current branch", distro: "common" },
        BuiltinCommand { title_zh: "撤销提交", title_en: "Git revert", command: "git revert ", desc_zh: "创建新提交来撤销指定提交", desc_en: "Create new commit to undo a commit", distro: "common" },
        BuiltinCommand { title_zh: "追溯文件修改", title_en: "Git blame", command: "git blame ", desc_zh: "显示文件每行的修改者和提交", desc_en: "Show who modified each line", distro: "common" },
        BuiltinCommand { title_zh: "添加子模块", title_en: "Git submodule add", command: "git submodule add ", desc_zh: "添加Git子模块", desc_en: "Add a git submodule", distro: "common" },
        BuiltinCommand { title_zh: "初始化子模块", title_en: "Git submodule init", command: "git submodule init", desc_zh: "初始化子模块", desc_en: "Initialize submodules", distro: "common" },
        BuiltinCommand { title_zh: "更新子模块", title_en: "Git submodule update", command: "git submodule update --remote", desc_zh: "更新子模块到最新提交", desc_en: "Update submodules to latest commits", distro: "common" },
        BuiltinCommand { title_zh: "清理未跟踪文件", title_en: "Git clean", command: "git clean -fd", desc_zh: "删除未跟踪的文件和目录", desc_en: "Remove untracked files and directories", distro: "common" },
        BuiltinCommand { title_zh: "清理预览", title_en: "Git clean dry-run", command: "git clean -fdn", desc_zh: "预览将要删除的未跟踪文件", desc_en: "Preview untracked files to be deleted", distro: "common" },
        BuiltinCommand { title_zh: "恢复文件", title_en: "Git restore", command: "git restore ", desc_zh: "恢复工作区文件到暂存区状态", desc_en: "Restore working tree file", distro: "common" },
        BuiltinCommand { title_zh: "取消暂存", title_en: "Git restore staged", command: "git restore --staged ", desc_zh: "取消暂存（保留工作区修改）", desc_en: "Unstage file (keep working tree changes)", distro: "common" },
        BuiltinCommand { title_zh: "切换分支", title_en: "Git switch", command: "git switch ", desc_zh: "切换分支（新命令）", desc_en: "Switch branch (new command)", distro: "common" },
        BuiltinCommand { title_zh: "创建并切换分支", title_en: "Git switch create", command: "git switch -c ", desc_zh: "创建新分支并切换", desc_en: "Create and switch to new branch", distro: "common" },
        BuiltinCommand { title_zh: "暂存列表", title_en: "Git stash list", command: "git stash list", desc_zh: "列出所有暂存条目", desc_en: "List all stash entries", distro: "common" },
        BuiltinCommand { title_zh: "删除暂存", title_en: "Git stash drop", command: "git stash drop", desc_zh: "删除最近的暂存条目", desc_en: "Drop the latest stash entry", distro: "common" },
        BuiltinCommand { title_zh: "查看引用日志", title_en: "Git reflog", command: "git reflog", desc_zh: "查看本地引用操作历史", desc_en: "Show local reference log", distro: "common" },
        BuiltinCommand { title_zh: "跟踪文件历史", title_en: "Git log follow", command: "git log --follow -p ", desc_zh: "跟踪文件的完整历史（含重命名）", desc_en: "Follow file history including renames", distro: "common" },
        BuiltinCommand { title_zh: "删除远程分支", title_en: "Git delete remote branch", command: "git push origin --delete ", desc_zh: "删除远程仓库分支", desc_en: "Delete remote branch", distro: "common" },
        BuiltinCommand { title_zh: "删除本地分支", title_en: "Git delete branch", command: "git branch -d ", desc_zh: "删除已合并的本地分支", desc_en: "Delete merged local branch", distro: "common" },
        BuiltinCommand { title_zh: "修改上次提交信息", title_en: "Git amend", command: "git commit --amend -m ''", desc_zh: "修改最近一次提交的描述信息", desc_en: "Amend last commit message", distro: "common" },
        BuiltinCommand { title_zh: "二分查找问题", title_en: "Git bisect", command: "git bisect start", desc_zh: "启动二分查找定位问题提交", desc_en: "Start binary search for buggy commit", distro: "common" },
        BuiltinCommand { title_zh: "提交摘要", title_en: "Git shortlog", command: "git shortlog -sn", desc_zh: "按作者统计提交数量", desc_en: "Show commit count by author", distro: "common" },
        BuiltinCommand { title_zh: "设置远程上游", title_en: "Git set upstream", command: "git push -u origin ", desc_zh: "推送并设置上游跟踪分支", desc_en: "Push and set upstream tracking branch", distro: "common" },
        BuiltinCommand { title_zh: "标签列表", title_en: "Git tag list", command: "git tag -l", desc_zh: "列出所有标签", desc_en: "List all tags", distro: "common" },
        BuiltinCommand { title_zh: "推送标签", title_en: "Git push tags", command: "git push origin --tags", desc_zh: "推送所有标签到远程", desc_en: "Push all tags to remote", distro: "common" },
        BuiltinCommand { title_zh: "查看文件指定行", title_en: "Git log with line", command: "git log -L start,end:", desc_zh: "查看文件指定行范围的修改历史", desc_en: "Show history of specific line range", distro: "common" },

        // ── Common: Web服务器 ──
        BuiltinCommand { title_zh: "Nginx测试配置", title_en: "Nginx test config", command: "sudo nginx -t", desc_zh: "测试Nginx配置是否正确", desc_en: "Test nginx configuration", distro: "common" },
        BuiltinCommand { title_zh: "Nginx重载配置", title_en: "Nginx reload", command: "sudo nginx -s reload", desc_zh: "重载Nginx配置", desc_en: "Reload nginx configuration", distro: "common" },
        BuiltinCommand { title_zh: "Nginx重启", title_en: "Nginx restart", command: "sudo systemctl restart nginx", desc_zh: "重启Nginx服务", desc_en: "Restart nginx service", distro: "common" },
        BuiltinCommand { title_zh: "Apache测试配置", title_en: "Apache test config", command: "sudo apachectl configtest", desc_zh: "测试Apache配置是否正确", desc_en: "Test Apache configuration", distro: "common" },
        BuiltinCommand { title_zh: "Apache重启", title_en: "Apache restart", command: "sudo systemctl restart apache2", desc_zh: "重启Apache服务", desc_en: "Restart Apache service", distro: "common" },
        BuiltinCommand { title_zh: "Nginx状态", title_en: "Nginx status", command: "sudo systemctl status nginx", desc_zh: "查看Nginx服务状态", desc_en: "Show nginx service status", distro: "common" },
        BuiltinCommand { title_zh: "Nginx停止", title_en: "Nginx stop", command: "sudo nginx -s stop", desc_zh: "停止Nginx服务", desc_en: "Stop nginx service", distro: "common" },
        BuiltinCommand { title_zh: "Nginx错误日志", title_en: "Nginx error log", command: "tail -f /var/log/nginx/error.log", desc_zh: "实时查看Nginx错误日志", desc_en: "Follow nginx error log", distro: "common" },
        BuiltinCommand { title_zh: "Nginx访问日志", title_en: "Nginx access log", command: "tail -f /var/log/nginx/access.log", desc_zh: "实时查看Nginx访问日志", desc_en: "Follow nginx access log", distro: "common" },
        BuiltinCommand { title_zh: "续签SSL证书", title_en: "Certbot renew", command: "sudo certbot renew", desc_zh: "续签Let's Encrypt SSL证书", desc_en: "Renew Let's Encrypt SSL certificate", distro: "common" },
        BuiltinCommand { title_zh: "Apache启用模块", title_en: "Apache enable module", command: "sudo a2enmod ", desc_zh: "启用Apache模块", desc_en: "Enable Apache module", distro: "common" },
        BuiltinCommand { title_zh: "Apache禁用模块", title_en: "Apache disable module", command: "sudo a2dismod ", desc_zh: "禁用Apache模块", desc_en: "Disable Apache module", distro: "common" },
        BuiltinCommand { title_zh: "Apache状态", title_en: "Apache status", command: "sudo systemctl status apache2", desc_zh: "查看Apache服务状态", desc_en: "Show Apache service status", distro: "common" },
        BuiltinCommand { title_zh: "Apache错误日志", title_en: "Apache error log", command: "tail -f /var/log/apache2/error.log", desc_zh: "实时查看Apache错误日志", desc_en: "Follow Apache error log", distro: "common" },

        // ── Common: Dev tools ──
        BuiltinCommand { title_zh: "Python HTTP服务器", title_en: "Python HTTP server", command: "python3 -m http.server 8080", desc_zh: "在8080端口启动简易HTTP服务器", desc_en: "Start simple HTTP server on port 8080", distro: "common" },
        BuiltinCommand { title_zh: "Pip安装包", title_en: "Pip install", command: "pip install ", desc_zh: "安装Python包", desc_en: "Install Python package", distro: "common" },
        BuiltinCommand { title_zh: "Pip已安装列表", title_en: "Pip list", command: "pip list", desc_zh: "列出已安装的Python包", desc_en: "List installed Python packages", distro: "common" },
        BuiltinCommand { title_zh: "Pip导出依赖", title_en: "Pip freeze", command: "pip freeze > requirements.txt", desc_zh: "导出已安装包列表到requirements.txt", desc_en: "Export installed packages", distro: "common" },
        BuiltinCommand { title_zh: "Python版本", title_en: "Python version", command: "python3 --version", desc_zh: "查看Python版本", desc_en: "Show Python version", distro: "common" },
        BuiltinCommand { title_zh: "Pip安装依赖", title_en: "Pip install from file", command: "pip install -r requirements.txt", desc_zh: "从requirements.txt安装依赖", desc_en: "Install dependencies from requirements.txt", distro: "common" },
        BuiltinCommand { title_zh: "Pip卸载包", title_en: "Pip uninstall", command: "pip uninstall ", desc_zh: "卸载Python包", desc_en: "Uninstall Python package", distro: "common" },
        BuiltinCommand { title_zh: "Pip查看包信息", title_en: "Pip show", command: "pip show ", desc_zh: "查看已安装包的详细信息", desc_en: "Show detailed info of installed package", distro: "common" },
        BuiltinCommand { title_zh: "Pip检查依赖", title_en: "Pip check", command: "pip check", desc_zh: "检查依赖冲突", desc_en: "Check for dependency conflicts", distro: "common" },
        BuiltinCommand { title_zh: "创建虚拟环境", title_en: "Python venv", command: "python3 -m venv ", desc_zh: "创建Python虚拟环境", desc_en: "Create Python virtual environment", distro: "common" },
        BuiltinCommand { title_zh: "激活虚拟环境", title_en: "Activate venv", command: "source venv/bin/activate", desc_zh: "激活Python虚拟环境", desc_en: "Activate Python virtual environment", distro: "common" },
        BuiltinCommand { title_zh: "Python执行代码", title_en: "Python inline", command: "python3 -c ''", desc_zh: "执行一行Python代码", desc_en: "Execute inline Python code", distro: "common" },
        BuiltinCommand { title_zh: "Python格式化JSON", title_en: "Python JSON pretty", command: "python3 -m json.tool ", desc_zh: "使用Python美化JSON输出", desc_en: "Pretty-print JSON with Python", distro: "common" },
        BuiltinCommand { title_zh: "Pip升级包", title_en: "Pip upgrade", command: "pip install --upgrade ", desc_zh: "升级Python包到最新版本", desc_en: "Upgrade Python package to latest", distro: "common" },
        BuiltinCommand { title_zh: "Pip过期包列表", title_en: "Pip list outdated", command: "pip list --outdated", desc_zh: "列出可升级的包", desc_en: "List upgradable packages", distro: "common" },
        BuiltinCommand { title_zh: "Pip可编辑安装", title_en: "Pip editable install", command: "pip install -e .", desc_zh: "以可编辑模式安装当前项目", desc_en: "Install current project in editable mode", distro: "common" },
        BuiltinCommand { title_zh: "Pytest运行测试", title_en: "Pytest run", command: "pytest -v", desc_zh: "运行pytest测试（详细输出）", desc_en: "Run pytest tests (verbose)", distro: "common" },
        BuiltinCommand { title_zh: "NPM安装依赖", title_en: "NPM install", command: "npm install", desc_zh: "安装Node.js依赖", desc_en: "Install Node.js dependencies", distro: "common" },
        BuiltinCommand { title_zh: "NPM运行脚本", title_en: "NPM run", command: "npm run ", desc_zh: "运行npm脚本", desc_en: "Run npm script", distro: "common" },
        BuiltinCommand { title_zh: "NPM启动应用", title_en: "NPM start", command: "npm start", desc_zh: "启动Node.js应用", desc_en: "Start Node.js application", distro: "common" },
        BuiltinCommand { title_zh: "NPM构建项目", title_en: "NPM build", command: "npm run build", desc_zh: "构建Node.js项目", desc_en: "Build Node.js project", distro: "common" },
        BuiltinCommand { title_zh: "Node版本", title_en: "Node version", command: "node -v", desc_zh: "查看Node.js版本", desc_en: "Show Node.js version", distro: "common" },
        BuiltinCommand { title_zh: "NPM初始化", title_en: "NPM init", command: "npm init -y", desc_zh: "快速初始化package.json", desc_en: "Initialize package.json quickly", distro: "common" },
        BuiltinCommand { title_zh: "NPM卸载包", title_en: "NPM uninstall", command: "npm uninstall ", desc_zh: "卸载Node.js包", desc_en: "Uninstall Node.js package", distro: "common" },
        BuiltinCommand { title_zh: "NPM更新包", title_en: "NPM update", command: "npm update", desc_zh: "更新所有已安装的包", desc_en: "Update all installed packages", distro: "common" },
        BuiltinCommand { title_zh: "NPM已安装列表", title_en: "NPM list", command: "npm list --depth=0", desc_zh: "列出顶层已安装的包", desc_en: "List top-level installed packages", distro: "common" },
        BuiltinCommand { title_zh: "NPM安全审计", title_en: "NPM audit", command: "npm audit", desc_zh: "检查已知安全漏洞", desc_en: "Check for known vulnerabilities", distro: "common" },
        BuiltinCommand { title_zh: "NPM修复漏洞", title_en: "NPM audit fix", command: "npm audit fix", desc_zh: "自动修复安全漏洞", desc_en: "Auto-fix security vulnerabilities", distro: "common" },
        BuiltinCommand { title_zh: "NPM过期包检查", title_en: "NPM outdated", command: "npm outdated", desc_zh: "检查过期未更新的包", desc_en: "Check for outdated packages", distro: "common" },
        BuiltinCommand { title_zh: "NPM全局安装", title_en: "NPM global install", command: "npm install -g ", desc_zh: "全局安装Node.js包", desc_en: "Install Node.js package globally", distro: "common" },
        BuiltinCommand { title_zh: "NPM查看全局包", title_en: "NPM global list", command: "npm list -g --depth=0", desc_zh: "列出全局安装的包", desc_en: "List globally installed packages", distro: "common" },
        BuiltinCommand { title_zh: "NPX执行命令", title_en: "NPX run", command: "npx ", desc_zh: "执行npm包命令（无需全局安装）", desc_en: "Run npm package command without install", distro: "common" },
        BuiltinCommand { title_zh: "Node执行代码", title_en: "Node eval", command: "node -e ''", desc_zh: "执行一行Node.js代码", desc_en: "Execute inline Node.js code", distro: "common" },
        BuiltinCommand { title_zh: "NPM查看包信息", title_en: "NPM info", command: "npm info ", desc_zh: "查看npm包的详细信息", desc_en: "View npm package details", distro: "common" },
        BuiltinCommand { title_zh: "NPM开发模式启动", title_en: "NPM run dev", command: "npm run dev", desc_zh: "以开发模式启动项目", desc_en: "Start project in dev mode", distro: "common" },
        BuiltinCommand { title_zh: "NPM运行测试", title_en: "NPM test", command: "npm test", desc_zh: "运行测试", desc_en: "Run tests", distro: "common" },
        BuiltinCommand { title_zh: "NPM发布包", title_en: "NPM publish", command: "npm publish", desc_zh: "发布包到npm仓库", desc_en: "Publish package to npm registry", distro: "common" },
        BuiltinCommand { title_zh: "Node调试模式", title_en: "Node inspect", command: "node --inspect ", desc_zh: "以调试模式启动Node.js", desc_en: "Start Node.js in debug mode", distro: "common" },
        BuiltinCommand { title_zh: "NPM清理缓存", title_en: "NPM cache clean", command: "npm cache clean --force", desc_zh: "清理npm缓存", desc_en: "Clean npm cache", distro: "common" },
        BuiltinCommand { title_zh: "NVM安装版本", title_en: "NVM install", command: "nvm install ", desc_zh: "安装指定Node.js版本", desc_en: "Install specified Node.js version", distro: "common" },
        BuiltinCommand { title_zh: "NVM切换版本", title_en: "NVM use", command: "nvm use ", desc_zh: "切换Node.js版本", desc_en: "Switch Node.js version", distro: "common" },
        BuiltinCommand { title_zh: "Yarn安装依赖", title_en: "Yarn install", command: "yarn install", desc_zh: "使用Yarn安装依赖", desc_en: "Install dependencies with Yarn", distro: "common" },
        BuiltinCommand { title_zh: "Yarn添加包", title_en: "Yarn add", command: "yarn add ", desc_zh: "使用Yarn添加依赖包", desc_en: "Add package with Yarn", distro: "common" },
        BuiltinCommand { title_zh: "Yarn运行脚本", title_en: "Yarn run", command: "yarn ", desc_zh: "运行package.json中的脚本", desc_en: "Run script from package.json", distro: "common" },
        BuiltinCommand { title_zh: "PNPM安装依赖", title_en: "PNPM install", command: "pnpm install", desc_zh: "使用PNPM安装依赖", desc_en: "Install dependencies with PNPM", distro: "common" },
        BuiltinCommand { title_zh: "PNPM添加包", title_en: "PNPM add", command: "pnpm add ", desc_zh: "使用PNPM添加依赖包", desc_en: "Add package with PNPM", distro: "common" },
        BuiltinCommand { title_zh: "JQ格式化JSON", title_en: "JQ parse JSON", command: "jq '.' ", desc_zh: "美化输出JSON文件", desc_en: "Pretty-print JSON file", distro: "common" },
        BuiltinCommand { title_zh: "JQ提取字段", title_en: "JQ extract field", command: "jq '.field' ", desc_zh: "从JSON中提取指定字段", desc_en: "Extract field from JSON", distro: "common" },
        BuiltinCommand { title_zh: "JQ遍历数组", title_en: "JQ iterate array", command: "jq '.[]' ", desc_zh: "遍历JSON数组中的每个元素", desc_en: "Iterate over JSON array elements", distro: "common" },
        BuiltinCommand { title_zh: "JQ过滤元素", title_en: "JQ filter", command: "jq '.[] | select(.field > 0)' ", desc_zh: "按条件过滤JSON数组", desc_en: "Filter JSON array by condition", distro: "common" },
        BuiltinCommand { title_zh: "JQ原始输出", title_en: "JQ raw output", command: "jq -r '.field' ", desc_zh: "输出不带引号的原始值", desc_en: "Output raw values without quotes", distro: "common" },
        BuiltinCommand { title_zh: "JQ紧凑输出", title_en: "JQ compact", command: "jq -c '.' ", desc_zh: "紧凑输出JSON（单行）", desc_en: "Output compact JSON (single line)", distro: "common" },
        BuiltinCommand { title_zh: "JQ获取键名", title_en: "JQ keys", command: "jq 'keys' ", desc_zh: "获取JSON对象的所有键名", desc_en: "Get all keys of JSON object", distro: "common" },
        BuiltinCommand { title_zh: "JQ计算长度", title_en: "JQ length", command: "jq 'length' ", desc_zh: "计算数组长度或对象属性数", desc_en: "Get array length or object key count", distro: "common" },
        BuiltinCommand { title_zh: "JQ映射变换", title_en: "JQ map", command: "jq 'map(.field)' ", desc_zh: "对数组每个元素提取字段", desc_en: "Extract field from each array element", distro: "common" },
        BuiltinCommand { title_zh: "JQ排序", title_en: "JQ sort_by", command: "jq 'sort_by(.field)' ", desc_zh: "按指定字段排序数组", desc_en: "Sort array by specified field", distro: "common" },
        BuiltinCommand { title_zh: "JQ分组", title_en: "JQ group_by", command: "jq 'group_by(.field)' ", desc_zh: "按指定字段对数组分组", desc_en: "Group array by specified field", distro: "common" },
        BuiltinCommand { title_zh: "JQ去重", title_en: "JQ unique", command: "jq 'unique' ", desc_zh: "去除数组中的重复元素", desc_en: "Remove duplicate elements from array", distro: "common" },
        BuiltinCommand { title_zh: "JQ键值对", title_en: "JQ to_entries", command: "jq 'to_entries' ", desc_zh: "将对象转为键值对数组", desc_en: "Convert object to key-value array", distro: "common" },
        BuiltinCommand { title_zh: "JQ从键值对还原", title_en: "JQ from_entries", command: "jq 'from_entries' ", desc_zh: "将键值对数组还原为对象", desc_en: "Convert key-value array to object", distro: "common" },
        BuiltinCommand { title_zh: "JQ提取嵌套字段", title_en: "JQ nested extract", command: "jq '.data.list[].name' ", desc_zh: "从嵌套JSON中提取深层字段", desc_en: "Extract deep nested field from JSON", distro: "common" },
        BuiltinCommand { title_zh: "JQ统计分组数量", title_en: "JQ group count", command: "jq 'group_by(.field) | map({key: .[0].field, count: length})' ", desc_zh: "按字段分组并统计每组数量", desc_en: "Group by field and count each group", distro: "common" },
        BuiltinCommand { title_zh: "JQ字符串拼接", title_en: "JQ join", command: "jq -r '.[] | .field' | paste -sd, -", desc_zh: "提取字段并用逗号拼接", desc_en: "Extract fields and join with comma", distro: "common" },

        // ── Common: Java ──
        BuiltinCommand { title_zh: "Java版本", title_en: "Java version", command: "java -version", desc_zh: "查看Java版本", desc_en: "Show Java version", distro: "common" },
        BuiltinCommand { title_zh: "Java运行JAR", title_en: "Java run JAR", command: "java -jar ", desc_zh: "运行JAR包", desc_en: "Run JAR file", distro: "common" },
        BuiltinCommand { title_zh: "Java编译", title_en: "Java compile", command: "javac ", desc_zh: "编译Java源文件", desc_en: "Compile Java source file", distro: "common" },
        BuiltinCommand { title_zh: "Java指定类路径运行", title_en: "Java run with classpath", command: "java -cp  com.example.Main", desc_zh: "指定类路径运行Java程序", desc_en: "Run Java with specified classpath", distro: "common" },
        BuiltinCommand { title_zh: "Java设置内存", title_en: "Java run with memory", command: "java -Xms512m -Xmx2g -jar ", desc_zh: "指定JVM初始和最大堆内存运行", desc_en: "Run Java with specified heap memory", distro: "common" },
        BuiltinCommand { title_zh: "Java系统属性", title_en: "Java system property", command: "java -Dproperty=value -jar ", desc_zh: "设置JVM系统属性运行", desc_en: "Run Java with system property", distro: "common" },
        BuiltinCommand { title_zh: "Java远程调试", title_en: "Java remote debug", command: "java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005 -jar ", desc_zh: "以远程调试模式启动Java程序", desc_en: "Start Java in remote debug mode", distro: "common" },
        BuiltinCommand { title_zh: "Java编译到目录", title_en: "Javac output dir", command: "javac -d out/ ", desc_zh: "编译Java文件到指定输出目录", desc_en: "Compile Java files to output directory", distro: "common" },
        BuiltinCommand { title_zh: "创建JAR包", title_en: "Jar create", command: "jar -cvf app.jar -C out/ .", desc_zh: "将class文件打包为JAR", desc_en: "Package class files into JAR", distro: "common" },
        BuiltinCommand { title_zh: "查看JAR内容", title_en: "Jar list", command: "jar -tf ", desc_zh: "列出JAR包中的文件", desc_en: "List files in JAR archive", distro: "common" },
        BuiltinCommand { title_zh: "解压JAR包", title_en: "Jar extract", command: "jar -xf ", desc_zh: "解压JAR包", desc_en: "Extract JAR archive", distro: "common" },
        BuiltinCommand { title_zh: "Java进程列表", title_en: "JPS list", command: "jps -lv", desc_zh: "列出所有Java进程及参数", desc_en: "List all Java processes with args", distro: "common" },
        BuiltinCommand { title_zh: "Java线程转储", title_en: "JStack dump", command: "jstack -l ", desc_zh: "导出Java进程的线程堆栈", desc_en: "Dump thread stacks of Java process", distro: "common" },
        BuiltinCommand { title_zh: "Java堆内存信息", title_en: "JMap heap info", command: "jmap -heap ", desc_zh: "查看Java进程堆内存使用详情", desc_en: "Show Java heap memory details", distro: "common" },
        BuiltinCommand { title_zh: "Java堆转储", title_en: "JMap heap dump", command: "jmap -dump:format=b,file=heap.hprof ", desc_zh: "导出Java堆内存到文件", desc_en: "Dump Java heap to file", distro: "common" },
        BuiltinCommand { title_zh: "Java GC统计", title_en: "JStat GC", command: "jstat -gc ", desc_zh: "查看Java进程GC统计信息", desc_en: "Show Java GC statistics", distro: "common" },
        BuiltinCommand { title_zh: "Java生成密钥", title_en: "Keytool genkey", command: "keytool -genkeypair -alias mykey -keyalg RSA -keysize 2048 -validity 365", desc_zh: "生成RSA密钥对", desc_en: "Generate RSA key pair", distro: "common" },
        BuiltinCommand { title_zh: "Java查看证书", title_en: "Keytool list", command: "keytool -list -v -keystore ", desc_zh: "查看密钥库中的证书", desc_en: "List certificates in keystore", distro: "common" },
        BuiltinCommand { title_zh: "Java查看所有进程详情", title_en: "JCmd help", command: "jcmd ", desc_zh: "查看Java进程支持的诊断命令", desc_en: "List available diagnostic commands for Java process", distro: "common" },
        BuiltinCommand { title_zh: "Java查看GC信息", title_en: "JCmd GC info", command: "jcmd  GC.heap_info", desc_zh: "通过jcmd查看堆内存信息", desc_en: "View heap info via jcmd", distro: "common" },
        BuiltinCommand { title_zh: "Java反编译", title_en: "Javap decompile", command: "javap -c ", desc_zh: "反编译查看class文件字节码", desc_en: "Decompile class file bytecode", distro: "common" },
        BuiltinCommand { title_zh: "Java查看JVM标志", title_en: "JInfo flags", command: "jinfo -flags ", desc_zh: "查看Java进程的JVM标志", desc_en: "Show JVM flags of Java process", distro: "common" },
        BuiltinCommand { title_zh: "Maven编译", title_en: "Maven compile", command: "mvn compile", desc_zh: "编译Maven项目", desc_en: "Compile Maven project", distro: "common" },
        BuiltinCommand { title_zh: "Maven打包", title_en: "Maven package", command: "mvn package -DskipTests", desc_zh: "打包Maven项目（跳过测试）", desc_en: "Package Maven project (skip tests)", distro: "common" },
        BuiltinCommand { title_zh: "Maven清理打包", title_en: "Maven clean package", command: "mvn clean package", desc_zh: "清理并打包Maven项目", desc_en: "Clean and package Maven project", distro: "common" },
        BuiltinCommand { title_zh: "Maven运行测试", title_en: "Maven test", command: "mvn test", desc_zh: "运行Maven测试", desc_en: "Run Maven tests", distro: "common" },
        BuiltinCommand { title_zh: "Maven清理安装", title_en: "Maven clean install", command: "mvn clean install -DskipTests", desc_zh: "清理、编译、打包并安装到本地仓库", desc_en: "Clean, compile, package and install to local repo", distro: "common" },
        BuiltinCommand { title_zh: "Maven安装到本地", title_en: "Maven install", command: "mvn install -DskipTests", desc_zh: "安装到本地Maven仓库", desc_en: "Install to local Maven repository", distro: "common" },
        BuiltinCommand { title_zh: "Maven发布", title_en: "Maven deploy", command: "mvn deploy -DskipTests", desc_zh: "发布到远程Maven仓库", desc_en: "Deploy to remote Maven repository", distro: "common" },
        BuiltinCommand { title_zh: "Maven依赖树", title_en: "Maven dependency tree", command: "mvn dependency:tree", desc_zh: "查看项目完整依赖树", desc_en: "Show full dependency tree", distro: "common" },
        BuiltinCommand { title_zh: "Maven解析依赖", title_en: "Maven dependency resolve", command: "mvn dependency:resolve", desc_zh: "下载并解析所有依赖", desc_en: "Download and resolve all dependencies", distro: "common" },
        BuiltinCommand { title_zh: "Maven分析依赖", title_en: "Maven dependency analyze", command: "mvn dependency:analyze", desc_zh: "分析未使用和缺失的依赖", desc_en: "Analyze unused and missing dependencies", distro: "common" },
        BuiltinCommand { title_zh: "Spring Boot运行", title_en: "Spring Boot run", command: "mvn spring-boot:run", desc_zh: "启动Spring Boot应用", desc_en: "Start Spring Boot application", distro: "common" },
        BuiltinCommand { title_zh: "Maven生成项目", title_en: "Maven archetype generate", command: "mvn archetype:generate", desc_zh: "从模板生成新Maven项目", desc_en: "Generate new project from archetype", distro: "common" },
        BuiltinCommand { title_zh: "Maven执行主类", title_en: "Maven exec java", command: "mvn exec:java -Dexec.mainClass=", desc_zh: "通过Maven运行指定主类", desc_en: "Run specified main class via Maven", distro: "common" },
        BuiltinCommand { title_zh: "Maven查看有效POM", title_en: "Maven effective POM", command: "mvn help:effective-pom", desc_zh: "查看合并后的有效POM配置", desc_en: "Show merged effective POM", distro: "common" },
        BuiltinCommand { title_zh: "Maven版本更新检查", title_en: "Maven versions check", command: "mvn versions:display-dependency-updates", desc_zh: "检查依赖是否有新版本可用", desc_en: "Check for available dependency updates", distro: "common" },
        BuiltinCommand { title_zh: "Maven查看插件帮助", title_en: "Maven plugin help", command: "mvn help:describe -Dplugin=", desc_zh: "查看Maven插件的详细帮助", desc_en: "Show detailed help for Maven plugin", distro: "common" },
        BuiltinCommand { title_zh: "Maven跳过测试打包", title_en: "Maven skip tests", command: "mvn clean package -Dmaven.test.skip=true", desc_zh: "完全跳过测试（不编译不执行）", desc_en: "Skip tests entirely (no compile, no run)", distro: "common" },
        BuiltinCommand { title_zh: "Gradle编译", title_en: "Gradle build", command: "gradle build", desc_zh: "编译Gradle项目", desc_en: "Build Gradle project", distro: "common" },
        BuiltinCommand { title_zh: "Gradle运行", title_en: "Gradle run", command: "gradle run", desc_zh: "运行Gradle项目", desc_en: "Run Gradle project", distro: "common" },
        BuiltinCommand { title_zh: "Gradle清理", title_en: "Gradle clean", command: "gradle clean", desc_zh: "清理Gradle构建产物", desc_en: "Clean Gradle build artifacts", distro: "common" },
        BuiltinCommand { title_zh: "Gradle运行测试", title_en: "Gradle test", command: "gradle test", desc_zh: "运行Gradle项目测试", desc_en: "Run Gradle project tests", distro: "common" },
        BuiltinCommand { title_zh: "Gradle清理构建", title_en: "Gradle clean build", command: "gradle clean build", desc_zh: "清理并重新构建Gradle项目", desc_en: "Clean and rebuild Gradle project", distro: "common" },
        BuiltinCommand { title_zh: "Gradle查看任务", title_en: "Gradle tasks", command: "gradle tasks --all", desc_zh: "列出所有可用的Gradle任务", desc_en: "List all available Gradle tasks", distro: "common" },
        BuiltinCommand { title_zh: "Gradle查看依赖", title_en: "Gradle dependencies", command: "gradle dependencies", desc_zh: "查看项目依赖树", desc_en: "Show project dependency tree", distro: "common" },
        BuiltinCommand { title_zh: "Gradle查看属性", title_en: "Gradle properties", command: "gradle properties", desc_zh: "查看项目所有属性", desc_en: "Show all project properties", distro: "common" },
        BuiltinCommand { title_zh: "Gradle生成Wrapper", title_en: "Gradle wrapper", command: "gradle wrapper", desc_zh: "生成Gradle Wrapper文件", desc_en: "Generate Gradle Wrapper files", distro: "common" },
        BuiltinCommand { title_zh: "Spring Boot运行(Gradle)", title_en: "Spring Boot run Gradle", command: "gradle bootRun", desc_zh: "启动Spring Boot应用(Gradle)", desc_en: "Start Spring Boot application (Gradle)", distro: "common" },
        BuiltinCommand { title_zh: "Gradle刷新依赖", title_en: "Gradle refresh deps", command: "gradle build --refresh-dependencies", desc_zh: "强制刷新所有依赖", desc_en: "Force refresh all dependencies", distro: "common" },
        BuiltinCommand { title_zh: "Gradle查看项目结构", title_en: "Gradle projects", command: "gradle projects", desc_zh: "查看多项目构建的项目结构", desc_en: "Show multi-project build structure", distro: "common" },
        BuiltinCommand { title_zh: "Gradle跳过测试构建", title_en: "Gradle build skip test", command: "gradle build -x test", desc_zh: "构建项目但跳过测试", desc_en: "Build project excluding tests", distro: "common" },
        BuiltinCommand { title_zh: "Gradle Wrapper构建", title_en: "Gradlew build", command: "./gradlew build", desc_zh: "使用Wrapper构建项目", desc_en: "Build project using Gradle Wrapper", distro: "common" },

        // ── Common: Go ──
        BuiltinCommand { title_zh: "Go版本", title_en: "Go version", command: "go version", desc_zh: "查看Go版本", desc_en: "Show Go version", distro: "common" },
        BuiltinCommand { title_zh: "Go运行", title_en: "Go run", command: "go run ", desc_zh: "编译并运行Go程序", desc_en: "Compile and run Go program", distro: "common" },
        BuiltinCommand { title_zh: "Go编译", title_en: "Go build", command: "go build ", desc_zh: "编译Go项目", desc_en: "Build Go project", distro: "common" },
        BuiltinCommand { title_zh: "Go测试", title_en: "Go test", command: "go test ./...", desc_zh: "运行所有Go测试", desc_en: "Run all Go tests", distro: "common" },
        BuiltinCommand { title_zh: "Go格式化", title_en: "Go fmt", command: "go fmt ./...", desc_zh: "格式化Go代码", desc_en: "Format Go code", distro: "common" },
        BuiltinCommand { title_zh: "Go获取依赖", title_en: "Go mod tidy", command: "go mod tidy", desc_zh: "整理Go模块依赖", desc_en: "Tidy Go module dependencies", distro: "common" },
        BuiltinCommand { title_zh: "Go安装包", title_en: "Go install", command: "go install ", desc_zh: "编译安装Go包", desc_en: "Compile and install Go package", distro: "common" },
        BuiltinCommand { title_zh: "Go环境变量", title_en: "Go env", command: "go env", desc_zh: "查看Go环境变量配置", desc_en: "Show Go environment variables", distro: "common" },
        BuiltinCommand { title_zh: "Go静态检查", title_en: "Go vet", command: "go vet ./...", desc_zh: "对Go代码进行静态分析", desc_en: "Run static analysis on Go code", distro: "common" },
        BuiltinCommand { title_zh: "Go初始化模块", title_en: "Go mod init", command: "go mod init ", desc_zh: "初始化新的Go模块", desc_en: "Initialize new Go module", distro: "common" },
        BuiltinCommand { title_zh: "Go下载依赖", title_en: "Go mod download", command: "go mod download", desc_zh: "下载模块依赖到缓存", desc_en: "Download module dependencies to cache", distro: "common" },
        BuiltinCommand { title_zh: "Go查看依赖图", title_en: "Go mod graph", command: "go mod graph", desc_zh: "查看模块依赖关系图", desc_en: "Show module dependency graph", distro: "common" },
        BuiltinCommand { title_zh: "Go查看文档", title_en: "Go doc", command: "go doc ", desc_zh: "查看Go包或函数文档", desc_en: "Show Go package or function documentation", distro: "common" },
        BuiltinCommand { title_zh: "Go列出包", title_en: "Go list", command: "go list ./...", desc_zh: "列出当前模块的所有包", desc_en: "List all packages in current module", distro: "common" },
        BuiltinCommand { title_zh: "Go生成代码", title_en: "Go generate", command: "go generate ./...", desc_zh: "运行代码生成指令", desc_en: "Run code generation directives", distro: "common" },
        BuiltinCommand { title_zh: "Go竞态检测", title_en: "Go race detect", command: "go test -race ./...", desc_zh: "运行测试并启用竞态检测", desc_en: "Run tests with race detection", distro: "common" },
        BuiltinCommand { title_zh: "Go基准测试", title_en: "Go benchmark", command: "go test -bench=. ./...", desc_zh: "运行Go基准测试", desc_en: "Run Go benchmark tests", distro: "common" },
        BuiltinCommand { title_zh: "Go覆盖率", title_en: "Go coverage", command: "go test -cover ./...", desc_zh: "运行测试并生成覆盖率报告", desc_en: "Run tests with coverage report", distro: "common" },
        BuiltinCommand { title_zh: "Go依赖固化", title_en: "Go mod vendor", command: "go mod vendor", desc_zh: "将依赖复制到vendor目录", desc_en: "Copy dependencies to vendor directory", distro: "common" },
        BuiltinCommand { title_zh: "Go详细测试", title_en: "Go test verbose", command: "go test -v ./...", desc_zh: "运行测试并显示详细输出", desc_en: "Run tests with verbose output", distro: "common" },

        // ── Common: Kotlin ──
        BuiltinCommand { title_zh: "Kotlin版本", title_en: "Kotlin version", command: "kotlinc -version", desc_zh: "查看Kotlin编译器版本", desc_en: "Show Kotlin compiler version", distro: "common" },
        BuiltinCommand { title_zh: "Kotlin编译", title_en: "Kotlin compile", command: "kotlinc ", desc_zh: "编译Kotlin源文件", desc_en: "Compile Kotlin source file", distro: "common" },
        BuiltinCommand { title_zh: "Kotlin运行", title_en: "Kotlin run", command: "kotlin ", desc_zh: "运行Kotlin程序", desc_en: "Run Kotlin program", distro: "common" },
        BuiltinCommand { title_zh: "Kotlin运行脚本", title_en: "Kotlin run script", command: "kotlinc -script ", desc_zh: "运行Kotlin脚本文件", desc_en: "Run Kotlin script file", distro: "common" },
        BuiltinCommand { title_zh: "Kotlin编译为JAR", title_en: "Kotlin compile JAR", command: "kotlinc  -include-runtime -d ", desc_zh: "编译Kotlin为包含运行时的JAR", desc_en: "Compile Kotlin with runtime into JAR", distro: "common" },
        BuiltinCommand { title_zh: "Kotlin运行JAR", title_en: "Kotlin run JAR", command: "kotlin -jar ", desc_zh: "运行Kotlin JAR包", desc_en: "Run Kotlin JAR file", distro: "common" },
        BuiltinCommand { title_zh: "Kotlin交互式Shell", title_en: "Kotlin REPL", command: "kotlinc -nowarn", desc_zh: "启动Kotlin交互式Shell", desc_en: "Start Kotlin interactive REPL", distro: "common" },

        // ── Common: PHP ──
        BuiltinCommand { title_zh: "PHP版本", title_en: "PHP version", command: "php -v", desc_zh: "查看PHP版本", desc_en: "Show PHP version", distro: "common" },
        BuiltinCommand { title_zh: "PHP运行脚本", title_en: "PHP run", command: "php ", desc_zh: "运行PHP脚本", desc_en: "Run PHP script", distro: "common" },
        BuiltinCommand { title_zh: "PHP内置服务器", title_en: "PHP built-in server", command: "php -S localhost:8080", desc_zh: "启动PHP内置开发服务器", desc_en: "Start PHP built-in dev server", distro: "common" },
        BuiltinCommand { title_zh: "PHP语法检查", title_en: "PHP lint", command: "php -l ", desc_zh: "检查PHP文件语法", desc_en: "Check PHP syntax", distro: "common" },
        BuiltinCommand { title_zh: "PHP交互式Shell", title_en: "PHP interactive", command: "php -a", desc_zh: "启动PHP交互式Shell", desc_en: "Start PHP interactive shell", distro: "common" },
        BuiltinCommand { title_zh: "Composer安装依赖", title_en: "Composer install", command: "composer install", desc_zh: "安装PHP依赖包", desc_en: "Install PHP dependencies", distro: "common" },
        BuiltinCommand { title_zh: "Composer更新依赖", title_en: "Composer update", command: "composer update", desc_zh: "更新PHP依赖包", desc_en: "Update PHP dependencies", distro: "common" },
        BuiltinCommand { title_zh: "Composer安装包", title_en: "Composer require", command: "composer require ", desc_zh: "安装PHP包", desc_en: "Install a PHP package", distro: "common" },
        BuiltinCommand { title_zh: "Composer卸载包", title_en: "Composer remove", command: "composer remove ", desc_zh: "卸载PHP包", desc_en: "Remove a PHP package", distro: "common" },
        BuiltinCommand { title_zh: "Composer查看已安装", title_en: "Composer show", command: "composer show", desc_zh: "列出已安装的PHP包", desc_en: "List installed PHP packages", distro: "common" },
        BuiltinCommand { title_zh: "Composer初始化项目", title_en: "Composer init", command: "composer init", desc_zh: "初始化Composer项目", desc_en: "Initialize Composer project", distro: "common" },
        BuiltinCommand { title_zh: "Composer自动加载", title_en: "Composer dump-autoload", command: "composer dump-autoload", desc_zh: "重新生成自动加载文件", desc_en: "Regenerate autoload files", distro: "common" },
        BuiltinCommand { title_zh: "PHP查看配置路径", title_en: "PHP ini path", command: "php --ini", desc_zh: "显示php.ini配置文件路径", desc_en: "Show php.ini configuration file path", distro: "common" },
        BuiltinCommand { title_zh: "PHP已加载模块", title_en: "PHP modules", command: "php -m", desc_zh: "列出所有已加载的PHP模块", desc_en: "List all loaded PHP modules", distro: "common" },
        BuiltinCommand { title_zh: "Composer验证配置", title_en: "Composer validate", command: "composer validate", desc_zh: "验证composer.json是否合法", desc_en: "Validate composer.json", distro: "common" },
        BuiltinCommand { title_zh: "Composer自更新", title_en: "Composer self-update", command: "composer self-update", desc_zh: "将Composer升级到最新版本", desc_en: "Update Composer to latest version", distro: "common" },
        BuiltinCommand { title_zh: "Composer过期包", title_en: "Composer outdated", command: "composer outdated", desc_zh: "列出可升级的PHP包", desc_en: "List upgradable PHP packages", distro: "common" },
        BuiltinCommand { title_zh: "Composer诊断", title_en: "Composer diagnose", command: "composer diagnose", desc_zh: "诊断Composer常见问题", desc_en: "Diagnose common Composer issues", distro: "common" },
        BuiltinCommand { title_zh: "Composer查看包详情", title_en: "Composer show package", command: "composer show ", desc_zh: "查看指定包的详细信息", desc_en: "Show details of a specific package", distro: "common" },
        BuiltinCommand { title_zh: "PHP代码规范检查", title_en: "PHP lint all", command: "find . -name '*.php' -exec php -l {} \\;", desc_zh: "批量检查PHP文件语法", desc_en: "Batch check PHP syntax", distro: "common" },

        // ── Common: Rust ──
        BuiltinCommand { title_zh: "Cargo版本", title_en: "Cargo version", command: "cargo --version", desc_zh: "查看Cargo版本", desc_en: "Show Cargo version", distro: "common" },
        BuiltinCommand { title_zh: "Cargo新建项目", title_en: "Cargo new", command: "cargo new ", desc_zh: "创建新Rust项目", desc_en: "Create new Rust project", distro: "common" },
        BuiltinCommand { title_zh: "Cargo编译", title_en: "Cargo build", command: "cargo build", desc_zh: "编译Rust项目", desc_en: "Build Rust project", distro: "common" },
        BuiltinCommand { title_zh: "Cargo发布编译", title_en: "Cargo build release", command: "cargo build --release", desc_zh: "以release模式编译Rust项目", desc_en: "Build Rust project in release mode", distro: "common" },
        BuiltinCommand { title_zh: "Cargo运行", title_en: "Cargo run", command: "cargo run", desc_zh: "编译并运行Rust项目", desc_en: "Build and run Rust project", distro: "common" },
        BuiltinCommand { title_zh: "Cargo测试", title_en: "Cargo test", command: "cargo test", desc_zh: "运行Rust测试", desc_en: "Run Rust tests", distro: "common" },
        BuiltinCommand { title_zh: "Cargo文档生成", title_en: "Cargo doc", command: "cargo doc --open", desc_zh: "生成并打开Rust文档", desc_en: "Generate and open Rust docs", distro: "common" },
        BuiltinCommand { title_zh: "Cargo检查", title_en: "Cargo check", command: "cargo check", desc_zh: "快速检查Rust代码", desc_en: "Quick check Rust code", distro: "common" },
        BuiltinCommand { title_zh: "Cargo格式化", title_en: "Cargo fmt", command: "cargo fmt", desc_zh: "格式化Rust代码", desc_en: "Format Rust code", distro: "common" },
        BuiltinCommand { title_zh: "Cargo代码检查", title_en: "Cargo clippy", command: "cargo clippy", desc_zh: "Rust代码静态检查", desc_en: "Rust linter (clippy)", distro: "common" },
        BuiltinCommand { title_zh: "Cargo添加依赖", title_en: "Cargo add", command: "cargo add ", desc_zh: "添加Rust依赖", desc_en: "Add Rust dependency", distro: "common" },
        BuiltinCommand { title_zh: "Cargo更新依赖", title_en: "Cargo update", command: "cargo update", desc_zh: "更新Rust依赖", desc_en: "Update Rust dependencies", distro: "common" },
        BuiltinCommand { title_zh: "Cargo清理构建", title_en: "Cargo clean", command: "cargo clean", desc_zh: "清理Rust构建产物", desc_en: "Clean Rust build artifacts", distro: "common" },
        BuiltinCommand { title_zh: "Rustup版本", title_en: "Rustup version", command: "rustup --version", desc_zh: "查看Rustup版本", desc_en: "Show Rustup version", distro: "common" },
        BuiltinCommand { title_zh: "Rustup更新", title_en: "Rustup update", command: "rustup update", desc_zh: "更新Rust工具链", desc_en: "Update Rust toolchain", distro: "common" },
        BuiltinCommand { title_zh: "Rustup安装工具链", title_en: "Rustup install", command: "rustup install ", desc_zh: "安装指定Rust工具链", desc_en: "Install Rust toolchain", distro: "common" },
        BuiltinCommand { title_zh: "Rustup已安装工具链", title_en: "Rustup toolchain list", command: "rustup toolchain list", desc_zh: "列出已安装的Rust工具链", desc_en: "List installed Rust toolchains", distro: "common" },
        BuiltinCommand { title_zh: "Rustc版本", title_en: "Rustc version", command: "rustc --version", desc_zh: "查看Rust编译器版本", desc_en: "Show Rust compiler version", distro: "common" },
        BuiltinCommand { title_zh: "Cargo安装二进制", title_en: "Cargo install", command: "cargo install ", desc_zh: "安装Rust二进制工具", desc_en: "Install Rust binary tool", distro: "common" },
        BuiltinCommand { title_zh: "Cargo发布", title_en: "Cargo publish", command: "cargo publish", desc_zh: "发布包到crates.io", desc_en: "Publish package to crates.io", distro: "common" },
        BuiltinCommand { title_zh: "Cargo依赖树", title_en: "Cargo tree", command: "cargo tree", desc_zh: "查看项目依赖树", desc_en: "Show project dependency tree", distro: "common" },
        BuiltinCommand { title_zh: "Cargo基准测试", title_en: "Cargo bench", command: "cargo bench", desc_zh: "运行Rust基准测试", desc_en: "Run Rust benchmark tests", distro: "common" },
        BuiltinCommand { title_zh: "Cargo运行release", title_en: "Cargo run release", command: "cargo run --release", desc_zh: "以release模式编译并运行", desc_en: "Build and run in release mode", distro: "common" },
        BuiltinCommand { title_zh: "Cargo运行示例", title_en: "Cargo run example", command: "cargo run --example ", desc_zh: "运行项目中的示例", desc_en: "Run an example in the project", distro: "common" },
        BuiltinCommand { title_zh: "Cargo测试指定模块", title_en: "Cargo test specific", command: "cargo test ", desc_zh: "运行指定名称的测试", desc_en: "Run tests matching name", distro: "common" },
        BuiltinCommand { title_zh: "Cargo升级依赖", title_en: "Cargo upgrade", command: "cargo upgrade", desc_zh: "将所有依赖升级到最新版本", desc_en: "Upgrade all dependencies to latest", distro: "common" },
        BuiltinCommand { title_zh: "Cargo搜索包", title_en: "Cargo search", command: "cargo search ", desc_zh: "在crates.io搜索Rust包", desc_en: "Search Rust packages on crates.io", distro: "common" },

        // ── Common: File operations ──
        BuiltinCommand { title_zh: "创建软链接", title_en: "Create symlink", command: "ln -s  link_name", desc_zh: "创建符号链接", desc_en: "Create symbolic link", distro: "common" },
        BuiltinCommand { title_zh: "删除软链接", title_en: "Remove symlink", command: "unlink ", desc_zh: "移除符号链接", desc_en: "Remove a symbolic link", distro: "common" },
        BuiltinCommand { title_zh: "目录树", title_en: "Tree view", command: "tree -L 2 -a", desc_zh: "显示目录树（2层）", desc_en: "Show directory tree (2 levels)", distro: "common" },
        BuiltinCommand { title_zh: "目录大小排序", title_en: "Disk usage sort", command: "du -sh * | sort -rh | head -10", desc_zh: "显示目录中最大的10个项目", desc_en: "Top 10 largest items in directory", distro: "common" },
        BuiltinCommand { title_zh: "查找大文件", title_en: "Find large files", command: "find / -type f -size +100M 2>/dev/null", desc_zh: "查找大于100MB的文件", desc_en: "Find files larger than 100MB", distro: "common" },
        BuiltinCommand { title_zh: "查找今日修改文件", title_en: "Find modified today", command: "find . -mtime -1 -type f", desc_zh: "查找最近24小时内修改的文件", desc_en: "Find files modified in last 24h", distro: "common" },
        BuiltinCommand { title_zh: "文件类型识别", title_en: "File type", command: "file ", desc_zh: "识别文件类型", desc_en: "Identify file type", distro: "common" },
        BuiltinCommand { title_zh: "MD5校验", title_en: "MD5 checksum", command: "md5sum ", desc_zh: "计算MD5校验值", desc_en: "Calculate MD5 checksum", distro: "common" },
        BuiltinCommand { title_zh: "SHA256校验", title_en: "SHA256 checksum", command: "sha256sum ", desc_zh: "计算SHA256校验值", desc_en: "Calculate SHA256 checksum", distro: "common" },

        // ── Docker: Container lifecycle ──
        BuiltinCommand { title_zh: "Docker运行中容器", title_en: "Docker ps", command: "docker ps", desc_zh: "列出运行中的容器", desc_en: "List running containers", distro: "common" },
        BuiltinCommand { title_zh: "Docker所有容器", title_en: "Docker ps all", command: "docker ps -a", desc_zh: "列出所有容器（包括已停止）", desc_en: "List all containers (including stopped)", distro: "common" },
        BuiltinCommand { title_zh: "Docker后台运行", title_en: "Docker run", command: "docker run -d --name  ", desc_zh: "后台运行容器", desc_en: "Run container in background", distro: "common" },
        BuiltinCommand { title_zh: "Docker端口映射运行", title_en: "Docker run with port", command: "docker run -d -p 8080:80 --name  ", desc_zh: "运行容器并映射端口", desc_en: "Run container with port mapping", distro: "common" },
        BuiltinCommand { title_zh: "Docker挂载卷运行", title_en: "Docker run with volume", command: "docker run -d -v /host:/container --name  ", desc_zh: "运行容器并挂载数据卷", desc_en: "Run container with volume mount", distro: "common" },
        BuiltinCommand { title_zh: "Docker交互式运行", title_en: "Docker run interactive", command: "docker run -it  /bin/bash", desc_zh: "交互式运行容器", desc_en: "Run container interactively", distro: "common" },
        BuiltinCommand { title_zh: "Docker临时运行", title_en: "Docker run rm", command: "docker run --rm ", desc_zh: "运行容器，退出后自动删除", desc_en: "Run container and remove on exit", distro: "common" },
        BuiltinCommand { title_zh: "Docker启动容器", title_en: "Docker start", command: "docker start ", desc_zh: "启动已停止的容器", desc_en: "Start a stopped container", distro: "common" },
        BuiltinCommand { title_zh: "Docker停止容器", title_en: "Docker stop", command: "docker stop ", desc_zh: "停止运行中的容器", desc_en: "Stop a running container", distro: "common" },
        BuiltinCommand { title_zh: "Docker重启容器", title_en: "Docker restart", command: "docker restart ", desc_zh: "重启容器", desc_en: "Restart a container", distro: "common" },
        BuiltinCommand { title_zh: "Docker强制终止", title_en: "Docker kill", command: "docker kill ", desc_zh: "强制终止容器", desc_en: "Force kill a container", distro: "common" },
        BuiltinCommand { title_zh: "Docker删除容器", title_en: "Docker rm", command: "docker rm ", desc_zh: "删除已停止的容器", desc_en: "Remove a stopped container", distro: "common" },
        BuiltinCommand { title_zh: "Docker强制删除", title_en: "Docker rm force", command: "docker rm -f ", desc_zh: "强制删除容器", desc_en: "Force remove a container", distro: "common" },
        BuiltinCommand { title_zh: "Docker清理停止容器", title_en: "Docker rm all stopped", command: "docker container prune", desc_zh: "清理所有已停止的容器", desc_en: "Remove all stopped containers", distro: "common" },

        // ── Docker: Inspection ──
        BuiltinCommand { title_zh: "Docker容器日志", title_en: "Docker logs", command: "docker logs ", desc_zh: "查看容器日志", desc_en: "Show container logs", distro: "common" },
        BuiltinCommand { title_zh: "Docker跟踪日志", title_en: "Docker logs follow", command: "docker logs -f ", desc_zh: "实时跟踪容器日志", desc_en: "Follow container logs", distro: "common" },
        BuiltinCommand { title_zh: "Docker最近日志", title_en: "Docker logs tail", command: "docker logs --tail 100 ", desc_zh: "查看最近100行日志", desc_en: "Show last 100 lines of logs", distro: "common" },
        BuiltinCommand { title_zh: "Docker容器详情", title_en: "Docker inspect", command: "docker inspect ", desc_zh: "查看容器详细信息（JSON）", desc_en: "Inspect container details (JSON)", distro: "common" },
        BuiltinCommand { title_zh: "Docker进入Bash", title_en: "Docker exec", command: "docker exec -it  /bin/bash", desc_zh: "进入容器的Bash终端", desc_en: "Enter container shell", distro: "common" },
        BuiltinCommand { title_zh: "Docker进入Sh", title_en: "Docker exec sh", command: "docker exec -it  /bin/sh", desc_zh: "进入容器的Sh终端", desc_en: "Enter container shell (sh)", distro: "common" },
        BuiltinCommand { title_zh: "Docker执行命令", title_en: "Docker exec command", command: "docker exec  ", desc_zh: "在容器中执行命令", desc_en: "Run command in container", distro: "common" },
        BuiltinCommand { title_zh: "Docker容器进程", title_en: "Docker top", command: "docker top ", desc_zh: "查看容器内进程", desc_en: "Show processes in container", distro: "common" },
        BuiltinCommand { title_zh: "Docker资源监控", title_en: "Docker stats", command: "docker stats", desc_zh: "实时显示容器资源使用情况", desc_en: "Show live container resource usage", distro: "common" },
        BuiltinCommand { title_zh: "Docker资源快照", title_en: "Docker stats no-stream", command: "docker stats --no-stream", desc_zh: "显示容器资源使用快照", desc_en: "Show container resource usage (snapshot)", distro: "common" },
        BuiltinCommand { title_zh: "Docker文件变更", title_en: "Docker diff", command: "docker diff ", desc_zh: "查看容器文件系统变更", desc_en: "Show filesystem changes in container", distro: "common" },
        BuiltinCommand { title_zh: "Docker端口映射", title_en: "Docker port", command: "docker port ", desc_zh: "查看容器端口映射", desc_en: "Show container port mappings", distro: "common" },

        // ── Docker: Images ──
        BuiltinCommand { title_zh: "Docker镜像列表", title_en: "Docker images", command: "docker images", desc_zh: "列出所有Docker镜像", desc_en: "List docker images", distro: "common" },
        BuiltinCommand { title_zh: "Docker拉取镜像", title_en: "Docker pull", command: "docker pull ", desc_zh: "从仓库拉取镜像", desc_en: "Pull an image from registry", distro: "common" },
        BuiltinCommand { title_zh: "Docker构建镜像", title_en: "Docker build", command: "docker build -t  .", desc_zh: "从Dockerfile构建镜像", desc_en: "Build image from Dockerfile", distro: "common" },
        BuiltinCommand { title_zh: "Docker无缓存构建", title_en: "Docker build no cache", command: "docker build --no-cache -t  .", desc_zh: "不使用缓存构建镜像", desc_en: "Build image without cache", distro: "common" },
        BuiltinCommand { title_zh: "Docker标签", title_en: "Docker tag", command: "docker tag   ", desc_zh: "为镜像打标签", desc_en: "Tag an image", distro: "common" },
        BuiltinCommand { title_zh: "Docker推送镜像", title_en: "Docker push", command: "docker push ", desc_zh: "推送镜像到仓库", desc_en: "Push image to registry", distro: "common" },
        BuiltinCommand { title_zh: "Docker删除镜像", title_en: "Docker rmi", command: "docker rmi ", desc_zh: "删除镜像", desc_en: "Remove an image", distro: "common" },
        BuiltinCommand { title_zh: "Docker清理镜像", title_en: "Docker image prune", command: "docker image prune -a", desc_zh: "清理未使用的镜像", desc_en: "Remove unused images", distro: "common" },
        BuiltinCommand { title_zh: "Docker导出镜像", title_en: "Docker save", command: "docker save -o image.tar ", desc_zh: "保存镜像为tar文件", desc_en: "Save image to tar file", distro: "common" },
        BuiltinCommand { title_zh: "Docker导入镜像", title_en: "Docker load", command: "docker load -i image.tar", desc_zh: "从tar文件加载镜像", desc_en: "Load image from tar file", distro: "common" },
        BuiltinCommand { title_zh: "Docker镜像历史", title_en: "Docker history", command: "docker history ", desc_zh: "查看镜像层历史", desc_en: "Show image layer history", distro: "common" },

        // ── Docker: Network & Volume ──
        BuiltinCommand { title_zh: "Docker网络列表", title_en: "Docker network ls", command: "docker network ls", desc_zh: "列出Docker网络", desc_en: "List docker networks", distro: "common" },
        BuiltinCommand { title_zh: "Docker创建网络", title_en: "Docker network create", command: "docker network create ", desc_zh: "创建Docker网络", desc_en: "Create a docker network", distro: "common" },
        BuiltinCommand { title_zh: "Docker网络详情", title_en: "Docker network inspect", command: "docker network inspect ", desc_zh: "查看网络详细信息", desc_en: "Inspect network details", distro: "common" },
        BuiltinCommand { title_zh: "Docker数据卷列表", title_en: "Docker volume ls", command: "docker volume ls", desc_zh: "列出Docker数据卷", desc_en: "List docker volumes", distro: "common" },
        BuiltinCommand { title_zh: "Docker创建数据卷", title_en: "Docker volume create", command: "docker volume create ", desc_zh: "创建Docker数据卷", desc_en: "Create a docker volume", distro: "common" },
        BuiltinCommand { title_zh: "Docker复制文件到容器", title_en: "Docker cp to container", command: "docker cp  :/path/", desc_zh: "复制文件到容器中", desc_en: "Copy file into container", distro: "common" },
        BuiltinCommand { title_zh: "Docker从容器复制文件", title_en: "Docker cp from container", command: "docker cp :/path/file .", desc_zh: "从容器中复制文件", desc_en: "Copy file from container", distro: "common" },
        BuiltinCommand { title_zh: "Docker提交容器", title_en: "Docker commit", command: "docker commit  ", desc_zh: "将容器变更提交为新镜像", desc_en: "Create image from container changes", distro: "common" },
        BuiltinCommand { title_zh: "Docker登录仓库", title_en: "Docker login", command: "docker login", desc_zh: "登录Docker仓库", desc_en: "Login to docker registry", distro: "common" },

        // ── Docker: Compose ──
        BuiltinCommand { title_zh: "Compose后台启动", title_en: "Docker compose up", command: "docker compose up -d", desc_zh: "后台启动Compose服务", desc_en: "Start compose services in background", distro: "common" },
        BuiltinCommand { title_zh: "Compose构建启动", title_en: "Docker compose up build", command: "docker compose up -d --build", desc_zh: "重新构建并启动Compose服务", desc_en: "Rebuild and start compose services", distro: "common" },
        BuiltinCommand { title_zh: "Compose停止删除", title_en: "Docker compose down", command: "docker compose down", desc_zh: "停止并删除Compose服务", desc_en: "Stop and remove compose services", distro: "common" },
        BuiltinCommand { title_zh: "Compose停止删除卷", title_en: "Docker compose down volumes", command: "docker compose down -v", desc_zh: "停止服务并删除数据卷", desc_en: "Stop services and remove volumes", distro: "common" },
        BuiltinCommand { title_zh: "Compose服务列表", title_en: "Docker compose ps", command: "docker compose ps", desc_zh: "列出Compose服务", desc_en: "List compose services", distro: "common" },
        BuiltinCommand { title_zh: "Compose跟踪日志", title_en: "Docker compose logs", command: "docker compose logs -f ", desc_zh: "实时跟踪Compose服务日志", desc_en: "Follow compose service logs", distro: "common" },
        BuiltinCommand { title_zh: "Compose构建", title_en: "Docker compose build", command: "docker compose build", desc_zh: "构建Compose服务", desc_en: "Build compose services", distro: "common" },
        BuiltinCommand { title_zh: "Compose拉取镜像", title_en: "Docker compose pull", command: "docker compose pull", desc_zh: "拉取Compose服务镜像", desc_en: "Pull compose service images", distro: "common" },
        BuiltinCommand { title_zh: "Compose重启服务", title_en: "Docker compose restart", command: "docker compose restart ", desc_zh: "重启Compose服务", desc_en: "Restart a compose service", distro: "common" },
        BuiltinCommand { title_zh: "Compose进入终端", title_en: "Docker compose exec", command: "docker compose exec  /bin/bash", desc_zh: "进入Compose服务的Bash终端", desc_en: "Enter compose service shell", distro: "common" },
        BuiltinCommand { title_zh: "Compose验证配置", title_en: "Docker compose config", command: "docker compose config", desc_zh: "验证并查看Compose配置", desc_en: "Validate and view compose config", distro: "common" },

        // ── Docker: System ──
        BuiltinCommand { title_zh: "Docker磁盘占用", title_en: "Docker system df", command: "docker system df", desc_zh: "查看Docker磁盘使用情况", desc_en: "Show docker disk usage", distro: "common" },
        BuiltinCommand { title_zh: "Docker全面清理", title_en: "Docker prune", command: "docker system prune -af", desc_zh: "清理所有未使用的Docker数据", desc_en: "Remove all unused docker data", distro: "common" },
        BuiltinCommand { title_zh: "Docker清理含数据卷", title_en: "Docker prune volumes", command: "docker system prune --volumes -af", desc_zh: "清理未使用数据（含数据卷）", desc_en: "Remove unused data including volumes", distro: "common" },
        BuiltinCommand { title_zh: "Docker系统信息", title_en: "Docker info", command: "docker info", desc_zh: "查看Docker系统信息", desc_en: "Show docker system info", distro: "common" },
        BuiltinCommand { title_zh: "Docker版本", title_en: "Docker version", command: "docker version", desc_zh: "查看Docker版本", desc_en: "Show docker version", distro: "common" },

        // ── Ubuntu/Debian specific ──
        BuiltinCommand { title_zh: "APT更新源", title_en: "APT update", command: "sudo apt update", desc_zh: "更新软件包列表", desc_en: "Update package lists", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT升级", title_en: "APT upgrade", command: "sudo apt upgrade -y", desc_zh: "升级所有软件包", desc_en: "Upgrade all packages", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT安装", title_en: "APT install", command: "sudo apt install -y ", desc_zh: "安装软件包", desc_en: "Install a package", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT卸载", title_en: "APT remove", command: "sudo apt remove ", desc_zh: "卸载软件包", desc_en: "Remove a package", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT搜索", title_en: "APT search", command: "apt search ", desc_zh: "搜索软件包", desc_en: "Search for packages", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT清理依赖", title_en: "APT autoremove", command: "sudo apt autoremove -y", desc_zh: "清理不再需要的依赖", desc_en: "Remove unused dependencies", distro: "ubuntu" },
        BuiltinCommand { title_zh: "DPKG查询包", title_en: "DPKG list", command: "dpkg -l | grep ", desc_zh: "查询已安装的软件包", desc_en: "List installed packages", distro: "ubuntu" },
        BuiltinCommand { title_zh: "UFW防火墙状态", title_en: "UFW status", command: "sudo ufw status verbose", desc_zh: "查看防火墙状态", desc_en: "Show firewall status", distro: "ubuntu" },
        BuiltinCommand { title_zh: "UFW放行端口", title_en: "UFW allow", command: "sudo ufw allow ", desc_zh: "在防火墙中放行端口", desc_en: "Allow port in firewall", distro: "ubuntu" },
        BuiltinCommand { title_zh: "系统日志跟踪", title_en: "Tail syslog", command: "tail -f /var/log/syslog", desc_zh: "实时跟踪系统日志", desc_en: "Follow system log", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT完整升级", title_en: "APT full upgrade", command: "sudo apt full-upgrade -y", desc_zh: "完整升级（含依赖处理）", desc_en: "Full upgrade with dependency handling", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT彻底卸载", title_en: "APT purge", command: "sudo apt purge ", desc_zh: "卸载软件包及配置文件", desc_en: "Remove package with config files", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT缓存搜索", title_en: "APT cache search", command: "apt-cache search ", desc_zh: "搜索软件包缓存", desc_en: "Search package cache", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT包详情", title_en: "APT show info", command: "apt-cache show ", desc_zh: "查看软件包详细信息", desc_en: "Show package details", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT已安装列表", title_en: "APT list installed", command: "apt list --installed", desc_zh: "列出所有已安装的软件包", desc_en: "List all installed packages", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT可升级列表", title_en: "APT list upgradable", command: "apt list --upgradable", desc_zh: "列出可升级的软件包", desc_en: "List upgradable packages", distro: "ubuntu" },
        BuiltinCommand { title_zh: "DPKG重新配置", title_en: "DPKG reconfigure", command: "sudo dpkg-reconfigure ", desc_zh: "重新配置已安装的软件包", desc_en: "Reconfigure an installed package", distro: "ubuntu" },
        BuiltinCommand { title_zh: "添加PPA源", title_en: "Add PPA", command: "sudo add-apt-repository ppa:", desc_zh: "添加PPA软件源", desc_en: "Add a PPA repository", distro: "ubuntu" },
        BuiltinCommand { title_zh: "Snap安装", title_en: "Snap install", command: "sudo snap install ", desc_zh: "安装Snap软件包", desc_en: "Install a snap package", distro: "ubuntu" },
        BuiltinCommand { title_zh: "Snap列表", title_en: "Snap list", command: "snap list", desc_zh: "列出已安装的Snap软件包", desc_en: "List installed snap packages", distro: "ubuntu" },
        BuiltinCommand { title_zh: "Ubuntu版本升级", title_en: "Release upgrade", command: "sudo do-release-upgrade", desc_zh: "升级到下一个Ubuntu版本", desc_en: "Upgrade to next Ubuntu release", distro: "ubuntu" },
        BuiltinCommand { title_zh: "UFW禁止端口", title_en: "UFW deny", command: "sudo ufw deny ", desc_zh: "在防火墙中禁止端口", desc_en: "Deny port in firewall", distro: "ubuntu" },
        BuiltinCommand { title_zh: "UFW删除规则", title_en: "UFW delete rule", command: "sudo ufw delete ", desc_zh: "删除防火墙规则", desc_en: "Delete a firewall rule", distro: "ubuntu" },
        BuiltinCommand { title_zh: "UFW启用", title_en: "UFW enable", command: "sudo ufw enable", desc_zh: "启用UFW防火墙", desc_en: "Enable UFW firewall", distro: "ubuntu" },
        BuiltinCommand { title_zh: "重启服务(sysvinit)", title_en: "Service restart", command: "sudo service  restart", desc_zh: "重启服务（sysvinit方式）", desc_en: "Restart service (sysvinit)", distro: "ubuntu" },
        BuiltinCommand { title_zh: "内核日志", title_en: "Dmesg kernel log", command: "dmesg -T | tail -30", desc_zh: "查看最近的内核消息", desc_en: "Show recent kernel messages", distro: "ubuntu" },
        BuiltinCommand { title_zh: "认证日志", title_en: "Auth log", command: "tail -f /var/log/auth.log", desc_zh: "实时跟踪认证日志", desc_en: "Follow authentication log", distro: "ubuntu" },
        BuiltinCommand { title_zh: "安装DEB包", title_en: "DPKG install deb", command: "sudo dpkg -i ", desc_zh: "安装本地deb软件包", desc_en: "Install local deb package", distro: "ubuntu" },
        BuiltinCommand { title_zh: "修复依赖", title_en: "APT fix broken", command: "sudo apt --fix-broken install", desc_zh: "修复损坏的依赖关系", desc_en: "Fix broken dependencies", distro: "ubuntu" },
        BuiltinCommand { title_zh: "锁定包版本", title_en: "APT mark hold", command: "sudo apt-mark hold ", desc_zh: "阻止软件包被升级", desc_en: "Prevent package from being upgraded", distro: "ubuntu" },
        BuiltinCommand { title_zh: "解锁包版本", title_en: "APT mark unhold", command: "sudo apt-mark unhold ", desc_zh: "解除包版本锁定", desc_en: "Allow package to be upgraded again", distro: "ubuntu" },
        BuiltinCommand { title_zh: "查看文件归属包", title_en: "DPKG owns file", command: "dpkg -S ", desc_zh: "查看文件属于哪个已安装的软件包", desc_en: "Find which installed package owns a file", distro: "ubuntu" },
        BuiltinCommand { title_zh: "查看包安装文件", title_en: "DPKG list files", command: "dpkg -L ", desc_zh: "列出软件包安装的所有文件", desc_en: "List all files installed by package", distro: "ubuntu" },
        BuiltinCommand { title_zh: "APT下载包", title_en: "APT download", command: "apt download ", desc_zh: "只下载deb包不安装", desc_en: "Download deb package without installing", distro: "ubuntu" },

        // ── CentOS/RHEL specific ──
        BuiltinCommand { title_zh: "YUM更新", title_en: "YUM update", command: "sudo yum update -y", desc_zh: "更新所有软件包", desc_en: "Update all packages", distro: "centos" },
        BuiltinCommand { title_zh: "YUM安装", title_en: "YUM install", command: "sudo yum install -y ", desc_zh: "安装软件包", desc_en: "Install a package", distro: "centos" },
        BuiltinCommand { title_zh: "YUM卸载", title_en: "YUM remove", command: "sudo yum remove ", desc_zh: "卸载软件包", desc_en: "Remove a package", distro: "centos" },
        BuiltinCommand { title_zh: "YUM搜索", title_en: "YUM search", command: "yum search ", desc_zh: "搜索软件包", desc_en: "Search for packages", distro: "centos" },
        BuiltinCommand { title_zh: "DNF更新", title_en: "DNF update", command: "sudo dnf update -y", desc_zh: "更新所有软件包（DNF）", desc_en: "Update all packages (DNF)", distro: "centos" },
        BuiltinCommand { title_zh: "DNF安装", title_en: "DNF install", command: "sudo dnf install -y ", desc_zh: "安装软件包（DNF）", desc_en: "Install a package (DNF)", distro: "centos" },
        BuiltinCommand { title_zh: "RPM查询", title_en: "RPM query", command: "rpm -qa | grep ", desc_zh: "查询已安装的软件包", desc_en: "Query installed packages", distro: "centos" },
        BuiltinCommand { title_zh: "Firewalld状态", title_en: "Firewalld status", command: "sudo firewall-cmd --state", desc_zh: "查看防火墙状态", desc_en: "Show firewall status", distro: "centos" },
        BuiltinCommand { title_zh: "Firewalld规则列表", title_en: "Firewalld list", command: "sudo firewall-cmd --list-all", desc_zh: "列出所有防火墙规则", desc_en: "List all firewall rules", distro: "centos" },
        BuiltinCommand { title_zh: "Firewalld开放端口", title_en: "Firewalld add port", command: "sudo firewall-cmd --permanent --add-port=/tcp", desc_zh: "在防火墙中开放端口", desc_en: "Open port in firewall", distro: "centos" },
        BuiltinCommand { title_zh: "系统日志跟踪", title_en: "Tail messages", command: "tail -f /var/log/messages", desc_zh: "实时跟踪系统日志", desc_en: "Follow system log", distro: "centos" },
        BuiltinCommand { title_zh: "SELinux状态", title_en: "SELinux status", command: "getenforce", desc_zh: "查看SELinux状态", desc_en: "Show SELinux status", distro: "centos" },
        BuiltinCommand { title_zh: "YUM清理缓存", title_en: "YUM clean cache", command: "sudo yum clean all", desc_zh: "清理YUM缓存", desc_en: "Clean yum cache", distro: "centos" },
        BuiltinCommand { title_zh: "YUM重建缓存", title_en: "YUM makecache", command: "sudo yum makecache", desc_zh: "重建YUM软件包缓存", desc_en: "Rebuild yum package cache", distro: "centos" },
        BuiltinCommand { title_zh: "YUM已安装列表", title_en: "YUM list installed", command: "yum list installed | grep ", desc_zh: "列出已安装的软件包", desc_en: "List installed packages", distro: "centos" },
        BuiltinCommand { title_zh: "YUM包详情", title_en: "YUM info", command: "yum info ", desc_zh: "查看软件包详细信息", desc_en: "Show package details", distro: "centos" },
        BuiltinCommand { title_zh: "YUM操作历史", title_en: "YUM history", command: "yum history", desc_zh: "查看YUM事务历史", desc_en: "Show yum transaction history", distro: "centos" },
        BuiltinCommand { title_zh: "DNF卸载", title_en: "DNF remove", command: "sudo dnf remove ", desc_zh: "卸载软件包（DNF）", desc_en: "Remove a package (DNF)", distro: "centos" },
        BuiltinCommand { title_zh: "DNF搜索", title_en: "DNF search", command: "dnf search ", desc_zh: "搜索软件包（DNF）", desc_en: "Search for packages (DNF)", distro: "centos" },
        BuiltinCommand { title_zh: "DNF清理缓存", title_en: "DNF clean", command: "sudo dnf clean all", desc_zh: "清理DNF缓存", desc_en: "Clean dnf cache", distro: "centos" },
        BuiltinCommand { title_zh: "DNF已安装列表", title_en: "DNF list installed", command: "dnf list installed | grep ", desc_zh: "列出已安装的软件包（DNF）", desc_en: "List installed packages (DNF)", distro: "centos" },
        BuiltinCommand { title_zh: "RPM安装", title_en: "RPM install", command: "sudo rpm -ivh ", desc_zh: "安装RPM软件包", desc_en: "Install RPM package", distro: "centos" },
        BuiltinCommand { title_zh: "RPM验证", title_en: "RPM verify", command: "rpm -V ", desc_zh: "验证已安装包的文件", desc_en: "Verify installed package files", distro: "centos" },
        BuiltinCommand { title_zh: "Chkconfig服务列表", title_en: "Chkconfig list", command: "chkconfig --list", desc_zh: "列出服务运行级别设置", desc_en: "List service runlevel settings", distro: "centos" },
        BuiltinCommand { title_zh: "Firewalld重载", title_en: "Firewalld reload", command: "sudo firewall-cmd --reload", desc_zh: "重载防火墙规则", desc_en: "Reload firewall rules", distro: "centos" },
        BuiltinCommand { title_zh: "Firewalld开放服务", title_en: "Firewalld add service", command: "sudo firewall-cmd --permanent --add-service=", desc_zh: "在防火墙中开放服务", desc_en: "Allow service in firewall", distro: "centos" },
        BuiltinCommand { title_zh: "Firewalld关闭端口", title_en: "Firewalld remove port", command: "sudo firewall-cmd --permanent --remove-port=/tcp", desc_zh: "在防火墙中关闭端口", desc_en: "Close port in firewall", distro: "centos" },
        BuiltinCommand { title_zh: "SELinux设为强制", title_en: "SELinux set enforcing", command: "sudo setenforce 1", desc_zh: "将SELinux设为强制模式", desc_en: "Set SELinux to enforcing mode", distro: "centos" },
        BuiltinCommand { title_zh: "SELinux设为宽容", title_en: "SELinux set permissive", command: "sudo setenforce 0", desc_zh: "将SELinux设为宽容模式", desc_en: "Set SELinux to permissive mode", distro: "centos" },
        BuiltinCommand { title_zh: "SELinux上下文", title_en: "SELinux context", command: "ls -laZ ", desc_zh: "查看SELinux安全上下文", desc_en: "Show SELinux security context", distro: "centos" },
        BuiltinCommand { title_zh: "恢复SELinux上下文", title_en: "Restorecon", command: "sudo restorecon -Rv ", desc_zh: "恢复SELinux文件上下文", desc_en: "Restore SELinux file contexts", distro: "centos" },
        BuiltinCommand { title_zh: "生成SELinux策略", title_en: "Audit2allow", command: "sudo grep  /var/log/audit/audit.log | audit2allow -M mypol", desc_zh: "从拒绝日志生成SELinux策略", desc_en: "Generate SELinux policy from denials", distro: "centos" },
        BuiltinCommand { title_zh: "安全日志", title_en: "Secure log", command: "tail -f /var/log/secure", desc_zh: "实时跟踪安全认证日志", desc_en: "Follow security/authentication log", distro: "centos" },
        BuiltinCommand { title_zh: "CentOS版本", title_en: "CentOS release", command: "cat /etc/centos-release", desc_zh: "查看CentOS版本", desc_en: "Show CentOS version", distro: "centos" },
        BuiltinCommand { title_zh: "文件归属包", title_en: "RPM owns file", command: "rpm -qf ", desc_zh: "查看文件属于哪个已安装的包", desc_en: "Find which installed package owns a file", distro: "centos" },
        BuiltinCommand { title_zh: "包安装文件", title_en: "RPM list files", command: "rpm -ql ", desc_zh: "列出软件包安装的所有文件", desc_en: "List all files in an installed package", distro: "centos" },

        // ── Arch Linux ──
        BuiltinCommand { title_zh: "Pacman同步源", title_en: "Pacman sync", command: "sudo pacman -Sy", desc_zh: "同步软件包数据库", desc_en: "Synchronize package databases", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman更新", title_en: "Pacman update", command: "sudo pacman -Syu", desc_zh: "更新所有软件包", desc_en: "Update all packages", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman安装", title_en: "Pacman install", command: "sudo pacman -S ", desc_zh: "安装软件包", desc_en: "Install a package", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman卸载", title_en: "Pacman remove", command: "sudo pacman -Rns ", desc_zh: "卸载软件包及依赖", desc_en: "Remove package with dependencies", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman搜索", title_en: "Pacman search", command: "pacman -Ss ", desc_zh: "搜索软件包", desc_en: "Search for packages", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman包信息", title_en: "Pacman info", command: "pacman -Si ", desc_zh: "查看软件包信息", desc_en: "Show package info", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman已安装列表", title_en: "Pacman list installed", command: "pacman -Qe", desc_zh: "列出显式安装的软件包", desc_en: "List explicitly installed packages", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman孤立包", title_en: "Pacman orphans", command: "pacman -Qdtq", desc_zh: "列出孤立的软件包", desc_en: "List orphan packages", distro: "arch" },
        BuiltinCommand { title_zh: "Pacman清理缓存", title_en: "Pacman cache clean", command: "sudo pacman -Sc", desc_zh: "清理软件包缓存", desc_en: "Clean package cache", distro: "arch" },
        BuiltinCommand { title_zh: "AUR安装", title_en: "AUR install", command: "yay -S ", desc_zh: "使用yay安装AUR软件包", desc_en: "Install AUR package with yay", distro: "arch" },
        BuiltinCommand { title_zh: "查看包文件列表", title_en: "Pacman list files", command: "pacman -Ql ", desc_zh: "列出软件包安装的所有文件", desc_en: "List all files installed by package", distro: "arch" },
        BuiltinCommand { title_zh: "文件归属包", title_en: "Pacman owns file", command: "pacman -Qo ", desc_zh: "查看文件属于哪个软件包", desc_en: "Show which package owns a file", distro: "arch" },
        BuiltinCommand { title_zh: "清理旧版缓存", title_en: "Pacman paccache", command: "sudo paccache -r", desc_zh: "清理软件包缓存（保留最近3版）", desc_en: "Clean package cache (keep last 3)", distro: "arch" },

        // ── Alpine Linux ──
        BuiltinCommand { title_zh: "APK更新源", title_en: "APK update", command: "sudo apk update", desc_zh: "更新软件包索引", desc_en: "Update package index", distro: "alpine" },
        BuiltinCommand { title_zh: "APK升级", title_en: "APK upgrade", command: "sudo apk upgrade", desc_zh: "升级所有软件包", desc_en: "Upgrade all packages", distro: "alpine" },
        BuiltinCommand { title_zh: "APK安装", title_en: "APK install", command: "sudo apk add ", desc_zh: "安装软件包", desc_en: "Install a package", distro: "alpine" },
        BuiltinCommand { title_zh: "APK卸载", title_en: "APK remove", command: "sudo apk del ", desc_zh: "卸载软件包", desc_en: "Remove a package", distro: "alpine" },
        BuiltinCommand { title_zh: "APK搜索", title_en: "APK search", command: "apk search ", desc_zh: "搜索软件包", desc_en: "Search for packages", distro: "alpine" },
        BuiltinCommand { title_zh: "APK已安装列表", title_en: "APK list installed", command: "apk info", desc_zh: "列出已安装的软件包", desc_en: "List installed packages", distro: "alpine" },
        BuiltinCommand { title_zh: "OpenRC服务状态", title_en: "RC-service status", command: "rc-status", desc_zh: "查看OpenRC服务状态", desc_en: "Show OpenRC service status", distro: "alpine" },
        BuiltinCommand { title_zh: "OpenRC启动服务", title_en: "RC-service start", command: "sudo rc-service  start", desc_zh: "启动OpenRC服务", desc_en: "Start an OpenRC service", distro: "alpine" },
        BuiltinCommand { title_zh: "OpenRC开机自启", title_en: "RC-update add", command: "sudo rc-update add  default", desc_zh: "设置OpenRC服务开机自启", desc_en: "Enable service at boot (OpenRC)", distro: "alpine" },
        BuiltinCommand { title_zh: "APK无缓存安装", title_en: "APK no-cache", command: "sudo apk add --no-cache ", desc_zh: "安装包但不缓存索引", desc_en: "Install package without caching index", distro: "alpine" },
        BuiltinCommand { title_zh: "APK包详情", title_en: "APK info", command: "apk info -a ", desc_zh: "查看软件包详细信息", desc_en: "Show package details", distro: "alpine" },
        BuiltinCommand { title_zh: "OpenRC停止服务", title_en: "RC-service stop", command: "sudo rc-service  stop", desc_zh: "停止OpenRC服务", desc_en: "Stop an OpenRC service", distro: "alpine" },
        BuiltinCommand { title_zh: "Alpine版本", title_en: "Alpine release", command: "cat /etc/alpine-release", desc_zh: "查看Alpine版本", desc_en: "Show Alpine version", distro: "alpine" },
    ]
}

// ── CommandAssist Engine ──

pub struct CommandAssistEngine {
    trie: Mutex<TrieNode>,
    cache: Mutex<LruCache>,
    weights_cache: Mutex<WeightsLruCache>,
    pool: SqlitePool,
}

impl CommandAssistEngine {
    pub fn new(pool: SqlitePool) -> Arc<Self> {
        let engine = Arc::new(Self {
            trie: Mutex::new(TrieNode::default()),
            cache: Mutex::new(LruCache::new(128)),
            weights_cache: Mutex::new(WeightsLruCache::new(500)),
            pool,
        });
        engine
    }

    /// Rebuild the Trie index from user snippets + built-in commands.
    pub async fn rebuild_index(&self, user_snippets: &[super::store::Snippet], locale: &str, enabled_categories: &[String]) -> anyhow::Result<()> {
        let mut trie = TrieNode::default();
        let is_zh = locale == "zh";

        // Insert user snippets — index by command prefix (lowercase)
        for s in user_snippets {
            let entry = TrieEntry {
                id: s.id.clone(),
                title: s.title.clone(),
                command: s.command.clone(),
                description: s.description.clone(),
                source: "user".to_string(),
                distro: None,
                category: None,
            };
            // Index by command (lowercased) for prefix matching
            let key = s.command.to_lowercase();
            trie.insert(&key, entry.clone());
            // Also index by title (lowercased) for matching by name
            let title_key = s.title.to_lowercase();
            trie.insert(&title_key, entry);
        }

        // Insert built-in commands (skip app commands whose category is not enabled)
        for cmd in builtin_commands() {
            if let Some(cat) = command_category(cmd.command) {
                if !enabled_categories.iter().any(|c| c.as_str() == cat) {
                    continue;
                }
            }
            let title = if is_zh { cmd.title_zh } else { cmd.title_en };
            let desc = if is_zh { cmd.desc_zh } else { cmd.desc_en };
            let entry = TrieEntry {
                id: format!("builtin:{}", cmd.command),
                title: title.to_string(),
                command: cmd.command.to_string(),
                description: Some(desc.to_string()),
                source: "system".to_string(),
                distro: Some(cmd.distro.to_string()),
                category: Some(match command_category(cmd.command) {
                    Some(c) => c.to_string(),
                    None => if cmd.distro == "common" { "system".to_string() } else { cmd.distro.to_string() },
                }),
            };
            let key = cmd.command.to_lowercase();
            trie.insert(&key, entry.clone());
            // Also index by both zh/en titles for matching
            let title_zh_key = cmd.title_zh.to_lowercase();
            let title_en_key = cmd.title_en.to_lowercase();
            trie.insert(&title_zh_key, entry.clone());
            trie.insert(&title_en_key, entry);
        }

        *self.trie.lock() = trie;
        self.cache.lock().clear();

        // Reload weights into memory cache
        let weights = self.load_weights().await;
        let mut wc = self.weights_cache.lock();
        wc.clear();
        for (k, v) in weights {
            wc.insert(k, v);
        }

        Ok(())
    }

    /// Search candidates by prefix query.
    pub async fn search(
        &self,
        query: &str,
        os_type: Option<&str>,
        page: u32,
    ) -> SearchResult {
        let page_size: usize = 10;
        let query_lower = query.to_lowercase();

        // Check cache (full result set, we paginate in memory)
        let cache_key = format!("{}:{}", query_lower, os_type.unwrap_or(""));
        {
            let mut cache = self.cache.lock();
            if let Some(cached) = cache.get(&cache_key) {
                let total = cached.len();
                let offset = (page as usize) * page_size;
                let items: Vec<CandidateItem> = cached
                    .iter()
                    .skip(offset)
                    .take(page_size)
                    .cloned()
                    .collect();
                let has_more = offset + items.len() < total;
                return SearchResult { items, total, page, has_more };
            }
        }

        // Search Trie — clone results out of lock scope
        let matched_entries: Vec<TrieEntry> = {
            let trie = self.trie.lock();
            let raw_entries = trie.search_prefix(&query_lower);

            // Deduplicate by command string (keep first occurrence)
            let mut seen = std::collections::HashSet::new();
            raw_entries
                .into_iter()
                .filter(|e| seen.insert(e.command.clone()))
                .cloned()
                .collect()
        };

        // Build candidates with weights + OS priority
        let mut candidates: Vec<CandidateItem> = matched_entries
            .into_iter()
            .map(|e| {
                let weight = self.weights_cache.lock().get(&e.id).unwrap_or(0.0);
                CandidateItem {
                    id: e.id.clone(),
                    title: e.title.clone(),
                    command: e.command.clone(),
                    description: e.description.clone(),
                    source: e.source.clone(),
                    distro: e.distro.clone(),
                    weight,
                    category: e.category.clone(),
                }
            })
            .collect();

        // Sort: matching OS first, then by weight desc, then by command length asc
        let os_lower = os_type.map(|s| s.to_lowercase());
        candidates.sort_by(|a, b| {
            // OS match priority
            let a_os_match = match (&a.distro, &os_lower) {
                (Some(d), Some(os)) => d.to_lowercase().contains(os) || d == "common",
                (None, _) => true, // user snippets always match
                (Some(d), None) => d == "common",
            };
            let b_os_match = match (&b.distro, &os_lower) {
                (Some(d), Some(os)) => d.to_lowercase().contains(os) || d == "common",
                (None, _) => true,
                (Some(d), None) => d == "common",
            };

            b_os_match
                .cmp(&a_os_match)
                .then_with(|| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal))
                .then_with(|| a.command.len().cmp(&b.command.len()))
        });

        // Cache the full sorted result
        let total = candidates.len();
        {
            let mut cache = self.cache.lock();
            cache.put(cache_key, candidates.clone());
        }

        // Paginate
        let offset = (page as usize) * page_size;
        let items: Vec<CandidateItem> = candidates
            .into_iter()
            .skip(offset)
            .take(page_size)
            .collect();
        let has_more = offset + items.len() < total;

        SearchResult { items, total, page, has_more }
    }

    /// Update weight for a selected candidate (called on confirm/backfill).
    pub async fn update_weight(&self, key: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        // Get current score from memory cache
        let old_score = self.weights_cache.lock().get(key).unwrap_or(0.0);
        let new_score = old_score * 0.9 + 1.0;

        sqlx::query(
            "INSERT INTO snippet_weights (snippet_key, score, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(snippet_key) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(new_score)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        // Update memory cache and invalidate search cache
        self.weights_cache.lock().insert(key.to_string(), new_score);
        self.cache.lock().clear();

        Ok(())
    }

    /// Reset all weights.
    pub async fn reset_weights(&self) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM snippet_weights")
            .execute(&self.pool)
            .await?;
        self.weights_cache.lock().clear();
        self.cache.lock().clear();
        Ok(())
    }

    /// Load all weights into a HashMap.
    async fn load_weights(&self) -> HashMap<String, f64> {
        let rows: Vec<(String, f64)> = sqlx::query_as(
            "SELECT snippet_key, score FROM snippet_weights",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();

        rows.into_iter().collect()
    }

    /// Return all candidates with current weights, deduplicated by id.
    pub async fn get_all(&self) -> Vec<CandidateItem> {
        let all_entries: Vec<TrieEntry> = {
            let trie = self.trie.lock();
            let mut stack: Vec<&TrieNode> = vec![&*trie];
            let mut entries: Vec<&TrieEntry> = Vec::new();
            while let Some(node) = stack.pop() {
                entries.extend(node.entries.iter());
                for child in node.children.values() {
                    stack.push(child);
                }
            }
            let mut seen = std::collections::HashSet::new();
            entries
                .into_iter()
                .filter(|e| seen.insert(e.id.clone()))
                .cloned()
                .collect()
        };

        all_entries
            .into_iter()
            .map(|e| {
                let weight = self.weights_cache.lock().get(&e.id).unwrap_or(0.0);
                CandidateItem {
                    id: e.id,
                    title: e.title,
                    command: e.command,
                    description: e.description,
                    source: e.source,
                    distro: e.distro,
                    weight,
                    category: e.category,
                }
            })
            .collect()
    }
}
