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
        BuiltinCommand { title_zh: "查看前N行", title_en: "Head N lines", command: "head -n 20 ", desc_zh: "显示文件前N行", desc_en: "Show first N lines", distro: "common" },
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
        // ── Common: 进程管理 ──
        BuiltinCommand { title_zh: "进程列表", title_en: "Process list", command: "ps aux", desc_zh: "显示所有运行中的进程", desc_en: "Show all running processes", distro: "common" },
        BuiltinCommand { title_zh: "进程列表（BSD格式）", title_en: "Process list BSD", command: "ps -ef", desc_zh: "显示所有进程（System V风格）", desc_en: "Show all processes (System V style)", distro: "common" },
        BuiltinCommand { title_zh: "进程树", title_en: "Process tree", command: "ps auxf", desc_zh: "以树形结构显示进程", desc_en: "Show processes in tree format", distro: "common" },
        BuiltinCommand { title_zh: "按名称查找进程", title_en: "Find PID", command: "pgrep -l ", desc_zh: "按名称查找进程PID", desc_en: "Find process PIDs by name", distro: "common" },
        BuiltinCommand { title_zh: "资源占用排行", title_en: "Top processes", command: "top -bn1 | head -20", desc_zh: "显示资源占用最高的进程（快照）", desc_en: "Show top processes (one snapshot)", distro: "common" },
        BuiltinCommand { title_zh: "交互式进程查看", title_en: "Htop", command: "htop", desc_zh: "交互式进程查看器", desc_en: "Interactive process viewer", distro: "common" },
        // ── Common: 文件查找 ──
        BuiltinCommand { title_zh: "全局查找文件", title_en: "Find file", command: "find / -name ", desc_zh: "按名称全局查找文件", desc_en: "Find file by name", distro: "common" },
        BuiltinCommand { title_zh: "当前目录查找", title_en: "Find in current dir", command: "find . -name ", desc_zh: "在当前目录中查找文件", desc_en: "Find file in current directory", distro: "common" },
        BuiltinCommand { title_zh: "查找普通文件", title_en: "Find by type", command: "find . -type f -name ", desc_zh: "只查找普通文件", desc_en: "Find only regular files", distro: "common" },
        BuiltinCommand { title_zh: "查找目录", title_en: "Find directory", command: "find . -type d -name ", desc_zh: "只查找目录", desc_en: "Find only directories", distro: "common" },
        BuiltinCommand { title_zh: "查找并执行命令", title_en: "Find and exec", command: "find . -name '' -exec {} \\;", desc_zh: "查找文件并执行命令", desc_en: "Find files and execute command", distro: "common" },
        BuiltinCommand { title_zh: "查找并删除", title_en: "Find and delete", command: "find . -name '' -delete", desc_zh: "查找并删除匹配的文件", desc_en: "Find and delete matching files", distro: "common" },
        // ── Common: 文本搜索 ──
        BuiltinCommand { title_zh: "搜索文本", title_en: "Grep text", command: "grep  file", desc_zh: "在文件中搜索文本", desc_en: "Search text in a file", distro: "common" },
        BuiltinCommand { title_zh: "忽略大小写搜索", title_en: "Grep case-insensitive", command: "grep -i  file", desc_zh: "忽略大小写搜索文本", desc_en: "Search text case-insensitively", distro: "common" },
        BuiltinCommand { title_zh: "反向匹配", title_en: "Grep invert match", command: "grep -v  file", desc_zh: "显示不匹配的行", desc_en: "Show lines NOT matching pattern", distro: "common" },
        BuiltinCommand { title_zh: "递归搜索", title_en: "Grep recursive", command: "grep -rn '' .", desc_zh: "递归搜索文件中的文本", desc_en: "Search text in files recursively", distro: "common" },
        BuiltinCommand { title_zh: "带上下文搜索", title_en: "Grep with context", command: "grep -C 3  file", desc_zh: "搜索并显示上下3行", desc_en: "Search with 3 lines of context", distro: "common" },
        BuiltinCommand { title_zh: "跟踪日志", title_en: "Tail log", command: "tail -f /var/log/syslog", desc_zh: "实时跟踪系统日志", desc_en: "Follow log file", distro: "common" },
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
        // ── Common: 系统信息 ──
        BuiltinCommand { title_zh: "系统信息", title_en: "System info", command: "uname -a", desc_zh: "显示系统信息", desc_en: "Show system information", distro: "common" },
        BuiltinCommand { title_zh: "运行时间", title_en: "Uptime", command: "uptime", desc_zh: "显示系统运行时间和负载", desc_en: "Show system uptime and load", distro: "common" },
        BuiltinCommand { title_zh: "在线用户", title_en: "Who is logged in", command: "who", desc_zh: "显示当前登录用户", desc_en: "Show logged in users", distro: "common" },
        BuiltinCommand { title_zh: "环境变量", title_en: "Environment variables", command: "env", desc_zh: "显示所有环境变量", desc_en: "Show all environment variables", distro: "common" },
        BuiltinCommand { title_zh: "定时任务", title_en: "Cron jobs", command: "crontab -l", desc_zh: "列出定时任务", desc_en: "List cron jobs", distro: "common" },
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
        BuiltinCommand { title_zh: "Screen会话", title_en: "Screen session", command: "screen -S session_name", desc_zh: "创建命名的screen会话", desc_en: "Create named screen session", distro: "common" },
        BuiltinCommand { title_zh: "Tmux会话", title_en: "Tmux session", command: "tmux new -s session_name", desc_zh: "创建命名的tmux会话", desc_en: "Create named tmux session", distro: "common" },
        BuiltinCommand { title_zh: "服务状态", title_en: "Systemctl status", command: "systemctl status ", desc_zh: "查看服务状态", desc_en: "Check service status", distro: "common" },
        BuiltinCommand { title_zh: "重启服务", title_en: "Systemctl restart", command: "systemctl restart ", desc_zh: "重启服务", desc_en: "Restart a service", distro: "common" },
        BuiltinCommand { title_zh: "开机自启", title_en: "Systemctl enable", command: "systemctl enable ", desc_zh: "设置服务开机自启", desc_en: "Enable service at boot", distro: "common" },
        BuiltinCommand { title_zh: "跟踪服务日志", title_en: "Journal logs", command: "journalctl -u  -f", desc_zh: "实时跟踪服务日志", desc_en: "Follow service logs", distro: "common" },
        BuiltinCommand { title_zh: "防火墙规则", title_en: "Iptables list", command: "iptables -L -n -v", desc_zh: "列出防火墙规则", desc_en: "List firewall rules", distro: "common" },
        BuiltinCommand { title_zh: "已挂载文件系统", title_en: "Mount list", command: "mount | column -t", desc_zh: "显示已挂载的文件系统", desc_en: "Show mounted filesystems", distro: "common" },
        BuiltinCommand { title_zh: "块设备列表", title_en: "Lsblk devices", command: "lsblk -f", desc_zh: "列出块设备及文件系统", desc_en: "List block devices with filesystem", distro: "common" },
        BuiltinCommand { title_zh: "磁盘IO统计", title_en: "IOstat", command: "iostat -x 1 3", desc_zh: "磁盘I/O统计信息", desc_en: "Disk I/O statistics", distro: "common" },
        BuiltinCommand { title_zh: "虚拟内存统计", title_en: "Vmstat", command: "vmstat 1 5", desc_zh: "虚拟内存统计信息", desc_en: "Virtual memory statistics", distro: "common" },

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

        // ── Common: 其他压缩格式 ──
        BuiltinCommand { title_zh: "Zip压缩", title_en: "Zip compress", command: "zip -r archive.zip ", desc_zh: "创建zip归档", desc_en: "Create zip archive", distro: "common" },
        BuiltinCommand { title_zh: "解压Zip", title_en: "Unzip", command: "unzip -o ", desc_zh: "解压zip归档", desc_en: "Extract zip archive", distro: "common" },
        BuiltinCommand { title_zh: "Bzip2压缩", title_en: "Bzip2 compress", command: "tar -cjf archive.tar.bz2 ", desc_zh: "创建bzip2归档", desc_en: "Create bzip2 archive", distro: "common" },
        BuiltinCommand { title_zh: "XZ压缩", title_en: "XZ compress", command: "tar -cJf archive.tar.xz ", desc_zh: "创建xz归档", desc_en: "Create xz archive", distro: "common" },

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

        // ── Common: Journalctl日志 ──
        BuiltinCommand { title_zh: "跟踪所有日志", title_en: "Journal follow", command: "journalctl -f", desc_zh: "实时跟踪所有系统日志", desc_en: "Follow all journal logs", distro: "common" },
        BuiltinCommand { title_zh: "跟踪服务日志", title_en: "Journal service", command: "journalctl -u  -f", desc_zh: "实时跟踪指定服务日志", desc_en: "Follow service logs", distro: "common" },
        BuiltinCommand { title_zh: "最近日志", title_en: "Journal recent", command: "journalctl -n 50 --no-pager", desc_zh: "显示最近50条日志", desc_en: "Show last 50 journal entries", distro: "common" },
        BuiltinCommand { title_zh: "最近一小时日志", title_en: "Journal since", command: "journalctl --since '1 hour ago'", desc_zh: "显示最近一小时的日志", desc_en: "Show logs from last hour", distro: "common" },
        BuiltinCommand { title_zh: "今天的日志", title_en: "Journal today", command: "journalctl --since today", desc_zh: "显示今天的日志", desc_en: "Show today's logs", distro: "common" },
        BuiltinCommand { title_zh: "本次启动日志", title_en: "Journal boot", command: "journalctl -b", desc_zh: "显示本次启动以来的日志", desc_en: "Show logs from current boot", distro: "common" },
        BuiltinCommand { title_zh: "内核日志", title_en: "Journal kernel", command: "journalctl -k", desc_zh: "显示内核消息", desc_en: "Show kernel messages", distro: "common" },
        BuiltinCommand { title_zh: "日志磁盘占用", title_en: "Journal disk usage", command: "journalctl --disk-usage", desc_zh: "显示日志的磁盘占用", desc_en: "Show journal disk usage", distro: "common" },

        // ── Common: 系统控制 ──
        BuiltinCommand { title_zh: "重启系统", title_en: "Reboot system", command: "sudo reboot", desc_zh: "重启系统", desc_en: "Reboot the system", distro: "common" },
        BuiltinCommand { title_zh: "立即关机", title_en: "Shutdown now", command: "sudo shutdown -h now", desc_zh: "立即关闭系统", desc_en: "Shutdown immediately", distro: "common" },
        BuiltinCommand { title_zh: "5分钟后关机", title_en: "Shutdown in 5min", command: "sudo shutdown -h +5", desc_zh: "5分钟后关闭系统", desc_en: "Shutdown in 5 minutes", distro: "common" },
        BuiltinCommand { title_zh: "取消关机", title_en: "Cancel shutdown", command: "sudo shutdown -c", desc_zh: "取消计划中的关机", desc_en: "Cancel scheduled shutdown", distro: "common" },
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

        // ── Common: Web服务器 ──
        BuiltinCommand { title_zh: "Nginx测试配置", title_en: "Nginx test config", command: "sudo nginx -t", desc_zh: "测试Nginx配置是否正确", desc_en: "Test nginx configuration", distro: "common" },
        BuiltinCommand { title_zh: "Nginx重载配置", title_en: "Nginx reload", command: "sudo nginx -s reload", desc_zh: "重载Nginx配置", desc_en: "Reload nginx configuration", distro: "common" },
        BuiltinCommand { title_zh: "Nginx重启", title_en: "Nginx restart", command: "sudo systemctl restart nginx", desc_zh: "重启Nginx服务", desc_en: "Restart nginx service", distro: "common" },
        BuiltinCommand { title_zh: "Apache测试配置", title_en: "Apache test config", command: "sudo apachectl configtest", desc_zh: "测试Apache配置是否正确", desc_en: "Test Apache configuration", distro: "common" },
        BuiltinCommand { title_zh: "Apache重启", title_en: "Apache restart", command: "sudo systemctl restart apache2", desc_zh: "重启Apache服务", desc_en: "Restart Apache service", distro: "common" },

        // ── Common: Dev tools ──
        BuiltinCommand { title_zh: "Python HTTP服务器", title_en: "Python HTTP server", command: "python3 -m http.server 8080", desc_zh: "在8080端口启动简易HTTP服务器", desc_en: "Start simple HTTP server on port 8080", distro: "common" },
        BuiltinCommand { title_zh: "Pip安装包", title_en: "Pip install", command: "pip install ", desc_zh: "安装Python包", desc_en: "Install Python package", distro: "common" },
        BuiltinCommand { title_zh: "Pip已安装列表", title_en: "Pip list", command: "pip list", desc_zh: "列出已安装的Python包", desc_en: "List installed Python packages", distro: "common" },
        BuiltinCommand { title_zh: "Pip导出依赖", title_en: "Pip freeze", command: "pip freeze > requirements.txt", desc_zh: "导出已安装包列表到requirements.txt", desc_en: "Export installed packages", distro: "common" },
        BuiltinCommand { title_zh: "NPM安装依赖", title_en: "NPM install", command: "npm install", desc_zh: "安装Node.js依赖", desc_en: "Install Node.js dependencies", distro: "common" },
        BuiltinCommand { title_zh: "NPM运行脚本", title_en: "NPM run", command: "npm run ", desc_zh: "运行npm脚本", desc_en: "Run npm script", distro: "common" },
        BuiltinCommand { title_zh: "NPM启动应用", title_en: "NPM start", command: "npm start", desc_zh: "启动Node.js应用", desc_en: "Start Node.js application", distro: "common" },
        BuiltinCommand { title_zh: "NPM构建项目", title_en: "NPM build", command: "npm run build", desc_zh: "构建Node.js项目", desc_en: "Build Node.js project", distro: "common" },
        BuiltinCommand { title_zh: "Node版本", title_en: "Node version", command: "node -v", desc_zh: "查看Node.js版本", desc_en: "Show Node.js version", distro: "common" },
        BuiltinCommand { title_zh: "JQ格式化JSON", title_en: "JQ parse JSON", command: "jq '.' ", desc_zh: "美化输出JSON文件", desc_en: "Pretty-print JSON file", distro: "common" },
        BuiltinCommand { title_zh: "JQ提取字段", title_en: "JQ extract field", command: "jq '.field' ", desc_zh: "从JSON中提取指定字段", desc_en: "Extract field from JSON", distro: "common" },

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
    pub async fn rebuild_index(&self, user_snippets: &[super::store::Snippet], locale: &str) -> anyhow::Result<()> {
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
            };
            // Index by command (lowercased) for prefix matching
            let key = s.command.to_lowercase();
            trie.insert(&key, entry.clone());
            // Also index by title (lowercased) for matching by name
            let title_key = s.title.to_lowercase();
            trie.insert(&title_key, entry);
        }

        // Insert built-in commands
        for cmd in builtin_commands() {
            let title = if is_zh { cmd.title_zh } else { cmd.title_en };
            let desc = if is_zh { cmd.desc_zh } else { cmd.desc_en };
            let entry = TrieEntry {
                id: format!("builtin:{}", cmd.command),
                title: title.to_string(),
                command: cmd.command.to_string(),
                description: Some(desc.to_string()),
                source: "system".to_string(),
                distro: Some(cmd.distro.to_string()),
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
                }
            })
            .collect()
    }
}
