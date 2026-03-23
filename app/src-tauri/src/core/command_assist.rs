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

// ── Built-in Commands ──

struct BuiltinCommand {
    title: &'static str,
    command: &'static str,
    description: &'static str,
    distro: &'static str, // "common" | "ubuntu" | "centos"
}

fn builtin_commands() -> Vec<BuiltinCommand> {
    vec![
        // ── Common (all distros) ──
        BuiltinCommand { title: "List files", command: "ls -la", description: "List all files with details", distro: "common" },
        BuiltinCommand { title: "List files human-readable", command: "ls -lah", description: "List files with human-readable sizes", distro: "common" },
        BuiltinCommand { title: "Disk usage", command: "df -h", description: "Show disk space usage", distro: "common" },
        BuiltinCommand { title: "Directory size", command: "du -sh *", description: "Show size of each item in current directory", distro: "common" },
        BuiltinCommand { title: "Free memory", command: "free -h", description: "Show memory usage", distro: "common" },
        BuiltinCommand { title: "Process list", command: "ps aux", description: "Show all running processes", distro: "common" },
        BuiltinCommand { title: "Top processes", command: "top -bn1 | head -20", description: "Show top processes (one snapshot)", distro: "common" },
        BuiltinCommand { title: "Find file", command: "find / -name ", description: "Find file by name", distro: "common" },
        BuiltinCommand { title: "Grep recursive", command: "grep -rn '' .", description: "Search text in files recursively", distro: "common" },
        BuiltinCommand { title: "Tail log", command: "tail -f /var/log/syslog", description: "Follow log file", distro: "common" },
        BuiltinCommand { title: "Network connections", command: "ss -tulnp", description: "Show listening ports", distro: "common" },
        BuiltinCommand { title: "Network interfaces", command: "ip addr", description: "Show network interfaces", distro: "common" },
        BuiltinCommand { title: "Ping host", command: "ping -c 4 ", description: "Ping a host 4 times", distro: "common" },
        BuiltinCommand { title: "DNS lookup", command: "dig ", description: "DNS lookup for a domain", distro: "common" },
        BuiltinCommand { title: "Curl GET", command: "curl -s ", description: "HTTP GET request", distro: "common" },
        BuiltinCommand { title: "Download file", command: "wget -O ", description: "Download file with wget", distro: "common" },
        BuiltinCommand { title: "Tar compress", command: "tar -czf archive.tar.gz ", description: "Create gzip compressed archive", distro: "common" },
        BuiltinCommand { title: "Tar extract", command: "tar -xzf ", description: "Extract gzip archive", distro: "common" },
        BuiltinCommand { title: "File permissions", command: "chmod 755 ", description: "Set file permissions", distro: "common" },
        BuiltinCommand { title: "Change owner", command: "chown user:group ", description: "Change file ownership", distro: "common" },
        BuiltinCommand { title: "System info", command: "uname -a", description: "Show system information", distro: "common" },
        BuiltinCommand { title: "Uptime", command: "uptime", description: "Show system uptime and load", distro: "common" },
        BuiltinCommand { title: "Who is logged in", command: "who", description: "Show logged in users", distro: "common" },
        BuiltinCommand { title: "Environment variables", command: "env", description: "Show all environment variables", distro: "common" },
        BuiltinCommand { title: "Cron jobs", command: "crontab -l", description: "List cron jobs", distro: "common" },
        BuiltinCommand { title: "SSH key generate", command: "ssh-keygen -t ed25519 -C ''", description: "Generate ED25519 SSH key", distro: "common" },
        BuiltinCommand { title: "SCP upload", command: "scp local_file user@host:/path/", description: "Copy file to remote host", distro: "common" },
        BuiltinCommand { title: "Rsync sync", command: "rsync -avz --progress ", description: "Sync files with rsync", distro: "common" },
        BuiltinCommand { title: "Kill process", command: "kill -9 ", description: "Force kill a process by PID", distro: "common" },
        BuiltinCommand { title: "Kill by name", command: "pkill -f ", description: "Kill processes by name pattern", distro: "common" },
        BuiltinCommand { title: "System date", command: "date '+%Y-%m-%d %H:%M:%S'", description: "Show current date and time", distro: "common" },
        BuiltinCommand { title: "Watch command", command: "watch -n 2 ", description: "Run command every 2 seconds", distro: "common" },
        BuiltinCommand { title: "History search", command: "history | grep ", description: "Search command history", distro: "common" },
        BuiltinCommand { title: "Redirect output", command: "command > output.log 2>&1", description: "Redirect stdout and stderr to file", distro: "common" },
        BuiltinCommand { title: "Background job", command: "nohup command &", description: "Run command in background", distro: "common" },
        BuiltinCommand { title: "Screen session", command: "screen -S session_name", description: "Create named screen session", distro: "common" },
        BuiltinCommand { title: "Tmux session", command: "tmux new -s session_name", description: "Create named tmux session", distro: "common" },
        BuiltinCommand { title: "Systemctl status", command: "systemctl status ", description: "Check service status", distro: "common" },
        BuiltinCommand { title: "Systemctl restart", command: "systemctl restart ", description: "Restart a service", distro: "common" },
        BuiltinCommand { title: "Systemctl enable", command: "systemctl enable ", description: "Enable service at boot", distro: "common" },
        BuiltinCommand { title: "Journal logs", command: "journalctl -u  -f", description: "Follow service logs", distro: "common" },
        BuiltinCommand { title: "Iptables list", command: "iptables -L -n -v", description: "List firewall rules", distro: "common" },
        BuiltinCommand { title: "Mount list", command: "mount | column -t", description: "Show mounted filesystems", distro: "common" },
        BuiltinCommand { title: "Lsblk devices", command: "lsblk -f", description: "List block devices with filesystem", distro: "common" },
        BuiltinCommand { title: "IOstat", command: "iostat -x 1 3", description: "Disk I/O statistics", distro: "common" },
        BuiltinCommand { title: "Vmstat", command: "vmstat 1 5", description: "Virtual memory statistics", distro: "common" },

        // ── Docker ──
        BuiltinCommand { title: "Docker ps", command: "docker ps -a", description: "List all containers", distro: "common" },
        BuiltinCommand { title: "Docker images", command: "docker images", description: "List docker images", distro: "common" },
        BuiltinCommand { title: "Docker logs", command: "docker logs -f ", description: "Follow container logs", distro: "common" },
        BuiltinCommand { title: "Docker exec", command: "docker exec -it  /bin/bash", description: "Enter container shell", distro: "common" },
        BuiltinCommand { title: "Docker compose up", command: "docker compose up -d", description: "Start compose services", distro: "common" },
        BuiltinCommand { title: "Docker compose down", command: "docker compose down", description: "Stop compose services", distro: "common" },
        BuiltinCommand { title: "Docker stats", command: "docker stats --no-stream", description: "Show container resource usage", distro: "common" },
        BuiltinCommand { title: "Docker prune", command: "docker system prune -af", description: "Remove unused docker data", distro: "common" },

        // ── Ubuntu/Debian specific ──
        BuiltinCommand { title: "APT update", command: "sudo apt update", description: "Update package lists", distro: "ubuntu" },
        BuiltinCommand { title: "APT upgrade", command: "sudo apt upgrade -y", description: "Upgrade all packages", distro: "ubuntu" },
        BuiltinCommand { title: "APT install", command: "sudo apt install -y ", description: "Install a package", distro: "ubuntu" },
        BuiltinCommand { title: "APT remove", command: "sudo apt remove ", description: "Remove a package", distro: "ubuntu" },
        BuiltinCommand { title: "APT search", command: "apt search ", description: "Search for packages", distro: "ubuntu" },
        BuiltinCommand { title: "APT autoremove", command: "sudo apt autoremove -y", description: "Remove unused dependencies", distro: "ubuntu" },
        BuiltinCommand { title: "DPKG list", command: "dpkg -l | grep ", description: "List installed packages", distro: "ubuntu" },
        BuiltinCommand { title: "UFW status", command: "sudo ufw status verbose", description: "Show firewall status", distro: "ubuntu" },
        BuiltinCommand { title: "UFW allow", command: "sudo ufw allow ", description: "Allow port in firewall", distro: "ubuntu" },
        BuiltinCommand { title: "Tail syslog", command: "tail -f /var/log/syslog", description: "Follow system log", distro: "ubuntu" },

        // ── CentOS/RHEL specific ──
        BuiltinCommand { title: "YUM update", command: "sudo yum update -y", description: "Update all packages", distro: "centos" },
        BuiltinCommand { title: "YUM install", command: "sudo yum install -y ", description: "Install a package", distro: "centos" },
        BuiltinCommand { title: "YUM remove", command: "sudo yum remove ", description: "Remove a package", distro: "centos" },
        BuiltinCommand { title: "YUM search", command: "yum search ", description: "Search for packages", distro: "centos" },
        BuiltinCommand { title: "DNF update", command: "sudo dnf update -y", description: "Update all packages (DNF)", distro: "centos" },
        BuiltinCommand { title: "DNF install", command: "sudo dnf install -y ", description: "Install a package (DNF)", distro: "centos" },
        BuiltinCommand { title: "RPM query", command: "rpm -qa | grep ", description: "Query installed packages", distro: "centos" },
        BuiltinCommand { title: "Firewalld status", command: "sudo firewall-cmd --state", description: "Show firewall status", distro: "centos" },
        BuiltinCommand { title: "Firewalld list", command: "sudo firewall-cmd --list-all", description: "List all firewall rules", distro: "centos" },
        BuiltinCommand { title: "Firewalld add port", command: "sudo firewall-cmd --permanent --add-port=/tcp", description: "Open port in firewall", distro: "centos" },
        BuiltinCommand { title: "Tail messages", command: "tail -f /var/log/messages", description: "Follow system log", distro: "centos" },
        BuiltinCommand { title: "SELinux status", command: "getenforce", description: "Show SELinux status", distro: "centos" },
    ]
}

// ── CommandAssist Engine ──

pub struct CommandAssistEngine {
    trie: Mutex<TrieNode>,
    cache: Mutex<LruCache>,
    pool: SqlitePool,
}

impl CommandAssistEngine {
    pub fn new(pool: SqlitePool) -> Arc<Self> {
        let engine = Arc::new(Self {
            trie: Mutex::new(TrieNode::default()),
            cache: Mutex::new(LruCache::new(128)),
            pool,
        });
        engine
    }

    /// Rebuild the Trie index from user snippets + built-in commands.
    pub async fn rebuild_index(&self, user_snippets: &[super::store::Snippet]) -> anyhow::Result<()> {
        let mut trie = TrieNode::default();

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
            let entry = TrieEntry {
                id: format!("builtin:{}", cmd.command),
                title: cmd.title.to_string(),
                command: cmd.command.to_string(),
                description: Some(cmd.description.to_string()),
                source: "system".to_string(),
                distro: Some(cmd.distro.to_string()),
            };
            let key = cmd.command.to_lowercase();
            trie.insert(&key, entry.clone());
            let title_key = cmd.title.to_lowercase();
            trie.insert(&title_key, entry);
        }

        *self.trie.lock() = trie;
        self.cache.lock().clear();

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

        // Load weights from DB asynchronously
        let weights = self.load_weights().await;

        // Build candidates with weights + OS priority
        let mut candidates: Vec<CandidateItem> = matched_entries
            .into_iter()
            .map(|e| {
                let weight = weights.get(&e.id).copied().unwrap_or(0.0);
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

        // Get current score
        let current: Option<(f64,)> = sqlx::query_as(
            "SELECT score FROM snippet_weights WHERE snippet_key = ?",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;

        let old_score = current.map(|(s,)| s).unwrap_or(0.0);
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

        // Invalidate cache since weights changed
        self.cache.lock().clear();

        Ok(())
    }

    /// Reset all weights.
    pub async fn reset_weights(&self) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM snippet_weights")
            .execute(&self.pool)
            .await?;
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
}
