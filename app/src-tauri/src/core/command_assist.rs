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
    pub source: String,         // "user" | "system"
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
    AppCommandCategory {
        id: "git",
        prefixes: &["git "],
    },
    AppCommandCategory {
        id: "docker",
        prefixes: &["docker "],
    },
    AppCommandCategory {
        id: "webServer",
        prefixes: &[
            "sudo nginx",
            "sudo systemctl restart nginx",
            "sudo apachectl",
            "sudo systemctl restart apache2",
        ],
    },
    AppCommandCategory {
        id: "python",
        prefixes: &["python3", "pip "],
    },
    AppCommandCategory {
        id: "node",
        prefixes: &["npm ", "node "],
    },
    AppCommandCategory {
        id: "java",
        prefixes: &["java ", "javac "],
    },
    AppCommandCategory {
        id: "maven",
        prefixes: &["mvn "],
    },
    AppCommandCategory {
        id: "gradle",
        prefixes: &["gradle "],
    },
    AppCommandCategory {
        id: "go",
        prefixes: &["go "],
    },
    AppCommandCategory {
        id: "jq",
        prefixes: &["jq "],
    },
    AppCommandCategory {
        id: "kotlin",
        prefixes: &["kotlinc ", "kotlin "],
    },
    AppCommandCategory {
        id: "php",
        prefixes: &["php ", "composer "],
    },
    AppCommandCategory {
        id: "rust",
        prefixes: &["cargo ", "rustc ", "rustup "],
    },
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

/// Built-in command data, embedded at compile time from `data/commands/*.json`.
#[derive(Debug, Deserialize)]
struct BuiltinCommand {
    title_zh: String,
    title_en: String,
    command: String,
    desc_zh: String,
    desc_en: String,
    distro: String, // "common" | "ubuntu" | "centos" | "arch" | "alpine"
}

/// Embedded JSON data files: (file name, contents).
const BUILTIN_COMMAND_SOURCES: &[(&str, &str)] = &[
    (
        "linux-core.json",
        include_str!("../../data/commands/linux-core.json"),
    ),
    (
        "linux-network.json",
        include_str!("../../data/commands/linux-network.json"),
    ),
    (
        "linux-system.json",
        include_str!("../../data/commands/linux-system.json"),
    ),
    ("git.json", include_str!("../../data/commands/git.json")),
    (
        "dev-tools.json",
        include_str!("../../data/commands/dev-tools.json"),
    ),
    (
        "docker.json",
        include_str!("../../data/commands/docker.json"),
    ),
    (
        "distro.json",
        include_str!("../../data/commands/distro.json"),
    ),
];

fn builtin_commands() -> Vec<BuiltinCommand> {
    BUILTIN_COMMAND_SOURCES
        .iter()
        .flat_map(|(name, json)| {
            serde_json::from_str::<Vec<BuiltinCommand>>(json).unwrap_or_else(|e| {
                panic!("embedded builtin command data {name} is corrupted: {e}")
            })
        })
        .collect()
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
    pub async fn rebuild_index(
        &self,
        user_snippets: &[super::store::Snippet],
        locale: &str,
        enabled_categories: &[String],
    ) -> anyhow::Result<()> {
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
            if let Some(cat) = command_category(&cmd.command) {
                if !enabled_categories.iter().any(|c| c.as_str() == cat) {
                    continue;
                }
            }
            let title = if is_zh { &cmd.title_zh } else { &cmd.title_en };
            let desc = if is_zh { &cmd.desc_zh } else { &cmd.desc_en };
            let entry = TrieEntry {
                id: format!("builtin:{}", cmd.command),
                title: title.to_string(),
                command: cmd.command.to_string(),
                description: Some(desc.to_string()),
                source: "system".to_string(),
                distro: Some(cmd.distro.to_string()),
                category: Some(match command_category(&cmd.command) {
                    Some(c) => c.to_string(),
                    None => {
                        if cmd.distro == "common" {
                            "system".to_string()
                        } else {
                            cmd.distro.to_string()
                        }
                    }
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
    pub async fn search(&self, query: &str, os_type: Option<&str>, page: u32) -> SearchResult {
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
                return SearchResult {
                    items,
                    total,
                    page,
                    has_more,
                };
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
                .then_with(|| {
                    b.weight
                        .partial_cmp(&a.weight)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
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

        SearchResult {
            items,
            total,
            page,
            has_more,
        }
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
        let rows: Vec<(String, f64)> =
            sqlx::query_as("SELECT snippet_key, score FROM snippet_weights")
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

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_command_json_parses() {
        for (name, json) in BUILTIN_COMMAND_SOURCES {
            let parsed = serde_json::from_str::<Vec<BuiltinCommand>>(json);
            assert!(parsed.is_ok(), "failed to parse {name}: {:?}", parsed.err());
            assert!(!parsed.unwrap().is_empty(), "{name} must not be empty");
        }
    }

    #[test]
    fn builtin_command_total_count() {
        assert_eq!(builtin_commands().len(), 2223);
    }

    #[test]
    fn builtin_command_strings_are_unique() {
        // id generation `builtin:{command}` requires globally unique command strings.
        let mut seen = std::collections::HashSet::new();
        for cmd in builtin_commands() {
            assert!(
                seen.insert(cmd.command.clone()),
                "duplicate builtin command: {:?}",
                cmd.command
            );
        }
    }

    #[test]
    fn builtin_command_distro_values_are_known() {
        const KNOWN: &[&str] = &["common", "ubuntu", "centos", "arch", "alpine"];
        for cmd in builtin_commands() {
            assert!(
                KNOWN.contains(&cmd.distro.as_str()),
                "unknown distro {:?} for command {:?}",
                cmd.distro,
                cmd.command
            );
        }
    }

    #[test]
    fn builtin_command_fields_are_non_empty() {
        for cmd in builtin_commands() {
            assert!(
                !cmd.title_zh.is_empty(),
                "empty title_zh for {:?}",
                cmd.command
            );
            assert!(
                !cmd.title_en.is_empty(),
                "empty title_en for {:?}",
                cmd.command
            );
            assert!(!cmd.command.is_empty(), "empty command string");
            assert!(
                !cmd.desc_zh.is_empty(),
                "empty desc_zh for {:?}",
                cmd.command
            );
            assert!(
                !cmd.desc_en.is_empty(),
                "empty desc_en for {:?}",
                cmd.command
            );
        }
    }
}
