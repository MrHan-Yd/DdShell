use std::io::BufRead;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

// ── Data models ──

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_type: String,
    pub secret_ref: Option<String>,
    pub group_id: Option<String>,
    pub sort_order: i64,
    pub is_favorite: bool,
    pub last_connected_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HostGroup {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SnippetGroup {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
    pub group_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryItem {
    pub id: String,
    pub session_id: String,
    pub host_id: String,
    pub command: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    pub port: i64,
    pub key_type: String,
    pub fingerprint: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FavoritePath {
    pub id: String,
    pub session_id: String,
    pub path: String,
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RecentPath {
    pub id: String,
    pub session_id: String,
    pub path: String,
    pub accessed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TerminalBookmark {
    pub id: String,
    pub host_id: String,
    pub path: String,
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigEntry {
    pub host: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<i64>,
    pub proxy_jump: Option<String>,
    pub identity_file: Option<String>,
}

// ── Database ──

#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn init(app_data_dir: &Path) -> anyhow::Result<Self> {
        std::fs::create_dir_all(app_data_dir)?;
        let db_path = app_data_dir.join("shell.db");
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await?;

        let db = Self { pool };
        db.migrate().await?;
        Ok(db)
    }

    /// Expose the underlying connection pool (e.g. for CommandAssistEngine).
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS host_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS hosts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL,
                secret_ref TEXT,
                group_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                last_connected_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (group_id) REFERENCES host_groups(id) ON DELETE SET NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS snippet_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS snippets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                command TEXT NOT NULL,
                description TEXT,
                tags TEXT,
                group_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        // Migrate: add group_id column if missing (existing databases)
        let has_group_id: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('snippets') WHERE name = 'group_id'",
        )
        .fetch_one(&self.pool)
        .await
        .unwrap_or(false);
        if !has_group_id {
            sqlx::query("ALTER TABLE snippets ADD COLUMN group_id TEXT")
                .execute(&self.pool)
                .await?;
        }

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS command_history (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                host_id TEXT NOT NULL,
                command TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_command_history_host ON command_history(host_id, created_at DESC)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS known_hosts (
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                key_type TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (host, port)
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS favorite_paths (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                path TEXT NOT NULL,
                label TEXT,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS recent_paths (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                path TEXT NOT NULL,
                accessed_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_recent_paths_session_path ON recent_paths(session_id, path)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS snippet_weights (
                snippet_key TEXT PRIMARY KEY,
                score REAL NOT NULL DEFAULT 0.0,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS terminal_bookmarks (
                id TEXT PRIMARY KEY,
                host_id TEXT NOT NULL,
                path TEXT NOT NULL,
                label TEXT,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // ── Host CRUD ──

    pub async fn create_host(
        &self,
        name: &str,
        host: &str,
        port: i64,
        username: &str,
        auth_type: &str,
        group_id: Option<&str>,
        password: Option<&str>,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO hosts (id, name, host, port, username, auth_type, secret_ref, group_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(host)
        .bind(port)
        .bind(username)
        .bind(auth_type)
        .bind(password)
        .bind(group_id)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    pub async fn update_host(
        &self,
        id: &str,
        name: Option<&str>,
        host: Option<&str>,
        port: Option<i64>,
        username: Option<&str>,
        auth_type: Option<&str>,
        group_id: Option<Option<&str>>,
        is_favorite: Option<bool>,
        sort_order: Option<i64>,
        secret_ref: Option<Option<&str>>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let current = self
            .get_host(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Host not found"))?;

        let name = name.map(|s| s.to_string()).unwrap_or(current.name);
        let host_addr = host.map(|s| s.to_string()).unwrap_or(current.host);
        let port = port.unwrap_or(current.port);
        let username = username.map(|s| s.to_string()).unwrap_or(current.username);
        let auth_type = auth_type
            .map(|s| s.to_string())
            .unwrap_or(current.auth_type);
        let group_id = group_id
            .map(|g| g.map(|s| s.to_string()))
            .unwrap_or(current.group_id);
        let is_favorite = is_favorite.unwrap_or(current.is_favorite);
        let sort_order = sort_order.unwrap_or(current.sort_order);
        let secret_ref = secret_ref
            .map(|s| s.map(|v| v.to_string()))
            .unwrap_or(current.secret_ref);

        sqlx::query(
            "UPDATE hosts SET name=?, host=?, port=?, username=?, auth_type=?, group_id=?, is_favorite=?, sort_order=?, secret_ref=?, updated_at=? WHERE id=?",
        )
        .bind(&name)
        .bind(&host_addr)
        .bind(port)
        .bind(&username)
        .bind(&auth_type)
        .bind(&group_id)
        .bind(is_favorite)
        .bind(sort_order)
        .bind(&secret_ref)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn delete_host(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM hosts WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_hosts(&self) -> anyhow::Result<Vec<Host>> {
        let rows: Vec<Host> = sqlx::query_as(
            "SELECT id, name, host, port, username, auth_type, secret_ref, group_id, sort_order, is_favorite, last_connected_at, created_at, updated_at FROM hosts ORDER BY sort_order, name",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn get_host(&self, id: &str) -> anyhow::Result<Option<Host>> {
        let row: Option<Host> = sqlx::query_as(
            "SELECT id, name, host, port, username, auth_type, secret_ref, group_id, sort_order, is_favorite, last_connected_at, created_at, updated_at FROM hosts WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row)
    }

    // ── Group CRUD ──

    pub async fn create_group(
        &self,
        name: &str,
        parent_id: Option<&str>,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO host_groups (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(parent_id)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    pub async fn update_group(&self, id: &str, name: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query("UPDATE host_groups SET name=?, updated_at=? WHERE id=?")
            .bind(name)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn delete_group(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM hosts WHERE group_id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        sqlx::query("DELETE FROM host_groups WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn list_groups(&self) -> anyhow::Result<Vec<HostGroup>> {
        let rows: Vec<HostGroup> = sqlx::query_as(
            "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM host_groups ORDER BY sort_order, name",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    // ── Snippet Group CRUD ──

    pub async fn create_snippet_group(&self, name: &str) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO snippet_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    pub async fn update_snippet_group(&self, id: &str, name: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query("UPDATE snippet_groups SET name=?, updated_at=? WHERE id=?")
            .bind(name)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn delete_snippet_group(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM snippets WHERE group_id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        sqlx::query("DELETE FROM snippet_groups WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn list_snippet_groups(&self) -> anyhow::Result<Vec<SnippetGroup>> {
        let rows: Vec<SnippetGroup> = sqlx::query_as(
            "SELECT id, name, sort_order, created_at, updated_at FROM snippet_groups ORDER BY sort_order, name",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    // ── Snippet CRUD ──

    pub async fn create_snippet(
        &self,
        title: &str,
        command: &str,
        description: Option<&str>,
        tags: Option<&str>,
        group_id: Option<&str>,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO snippets (id, title, command, description, tags, group_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(title)
        .bind(command)
        .bind(description)
        .bind(tags)
        .bind(group_id)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    pub async fn update_snippet(
        &self,
        id: &str,
        title: Option<&str>,
        command: Option<&str>,
        description: Option<Option<&str>>,
        tags: Option<Option<&str>>,
        group_id: Option<Option<&str>>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        let current: Snippet = sqlx::query_as(
            "SELECT id, title, command, description, tags, group_id, sort_order, created_at, updated_at FROM snippets WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Snippet not found"))?;

        let title = title.map(|s| s.to_string()).unwrap_or(current.title);
        let command = command.map(|s| s.to_string()).unwrap_or(current.command);
        let description = description
            .map(|d| d.map(|s| s.to_string()))
            .unwrap_or(current.description);
        let tags = tags
            .map(|t| t.map(|s| s.to_string()))
            .unwrap_or(current.tags);
        let group_id = group_id
            .map(|g| g.map(|s| s.to_string()))
            .unwrap_or(current.group_id);

        sqlx::query(
            "UPDATE snippets SET title=?, command=?, description=?, tags=?, group_id=?, updated_at=? WHERE id=?",
        )
        .bind(&title)
        .bind(&command)
        .bind(&description)
        .bind(&tags)
        .bind(&group_id)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn delete_snippet(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM snippets WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_snippets(&self) -> anyhow::Result<Vec<Snippet>> {
        let rows: Vec<Snippet> = sqlx::query_as(
            "SELECT id, title, command, description, tags, group_id, sort_order, created_at, updated_at FROM snippets ORDER BY sort_order, title",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    // ── Settings ──

    pub async fn get_setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM settings WHERE key = ?")
                .bind(key)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|r| r.0))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // ── Command History ──

    pub async fn insert_command(
        &self,
        session_id: &str,
        host_id: &str,
        command: &str,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO command_history (id, session_id, host_id, command, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(session_id)
        .bind(host_id)
        .bind(command)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    pub async fn list_commands(
        &self,
        host_id: Option<&str>,
        query: Option<&str>,
        limit: i64,
    ) -> anyhow::Result<Vec<CommandHistoryItem>> {
        let rows: Vec<CommandHistoryItem> = match (host_id, query) {
            (Some(hid), Some(q)) => {
                let pattern = format!("%{}%", q);
                sqlx::query_as(
                    "SELECT id, session_id, host_id, command, created_at FROM command_history WHERE host_id = ? AND command LIKE ? ORDER BY created_at ASC LIMIT ?",
                )
                .bind(hid)
                .bind(&pattern)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
            (Some(hid), None) => {
                sqlx::query_as(
                    "SELECT id, session_id, host_id, command, created_at FROM command_history WHERE host_id = ? ORDER BY created_at ASC LIMIT ?",
                )
                .bind(hid)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
            (None, Some(q)) => {
                let pattern = format!("%{}%", q);
                sqlx::query_as(
                    "SELECT id, session_id, host_id, command, created_at FROM command_history WHERE command LIKE ? ORDER BY created_at ASC LIMIT ?",
                )
                .bind(&pattern)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
            (None, None) => {
                sqlx::query_as(
                    "SELECT id, session_id, host_id, command, created_at FROM command_history ORDER BY created_at ASC LIMIT ?",
                )
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
        };

        Ok(rows)
    }

    pub async fn clear_commands(&self, host_id: Option<&str>) -> anyhow::Result<()> {
        match host_id {
            Some(hid) => {
                sqlx::query("DELETE FROM command_history WHERE host_id = ?")
                    .bind(hid)
                    .execute(&self.pool)
                    .await?;
            }
            None => {
                sqlx::query("DELETE FROM command_history")
                    .execute(&self.pool)
                    .await?;
            }
        }
        Ok(())
    }

    // ── Known Hosts ──

    pub async fn get_known_host(
        &self,
        host: &str,
        port: i64,
    ) -> anyhow::Result<Option<KnownHost>> {
        let row: Option<KnownHost> = sqlx::query_as(
            "SELECT host, port, key_type, fingerprint, created_at FROM known_hosts WHERE host = ? AND port = ?",
        )
        .bind(host)
        .bind(port)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn save_known_host(
        &self,
        host: &str,
        port: i64,
        key_type: &str,
        fingerprint: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO known_hosts (host, port, key_type, fingerprint, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(host, port) DO UPDATE SET key_type = excluded.key_type, fingerprint = excluded.fingerprint, created_at = excluded.created_at",
        )
        .bind(host)
        .bind(port)
        .bind(key_type)
        .bind(fingerprint)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── Favorite Paths ──

    pub async fn add_favorite_path(
        &self,
        session_id: &str,
        path: &str,
        label: Option<&str>,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO favorite_paths (id, session_id, path, label, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(session_id)
        .bind(path)
        .bind(label)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    pub async fn remove_favorite_path(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM favorite_paths WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_favorite_paths(&self, session_id: &str) -> anyhow::Result<Vec<FavoritePath>> {
        let rows: Vec<FavoritePath> = sqlx::query_as(
            "SELECT id, session_id, path, label, created_at FROM favorite_paths WHERE session_id = ? ORDER BY created_at",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    // ── Recent Paths ──

    pub async fn add_recent_path(
        &self,
        session_id: &str,
        path: &str,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Upsert: if the same session_id + path already exists, update accessed_at.
        // The unique index idx_recent_paths_session_path enforces uniqueness on (session_id, path).
        sqlx::query(
            "INSERT INTO recent_paths (id, session_id, path, accessed_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id, path) DO UPDATE SET accessed_at = excluded.accessed_at",
        )
        .bind(&id)
        .bind(session_id)
        .bind(path)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        // Return the actual id (could be old row if conflict)
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM recent_paths WHERE session_id = ? AND path = ?",
        )
        .bind(session_id)
        .bind(path)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.0).unwrap_or(id))
    }

    pub async fn list_recent_paths(
        &self,
        session_id: &str,
        limit: i64,
    ) -> anyhow::Result<Vec<RecentPath>> {
        let rows: Vec<RecentPath> = sqlx::query_as(
            "SELECT id, session_id, path, accessed_at FROM recent_paths WHERE session_id = ? ORDER BY accessed_at DESC LIMIT ?",
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    // ── Terminal Bookmarks ──

    pub async fn add_terminal_bookmark(
        &self,
        host_id: &str,
        path: &str,
        label: Option<&str>,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO terminal_bookmarks (id, host_id, path, label, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(host_id)
        .bind(path)
        .bind(label)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    pub async fn remove_terminal_bookmark(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM terminal_bookmarks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_terminal_bookmarks(
        &self,
        host_id: &str,
    ) -> anyhow::Result<Vec<TerminalBookmark>> {
        let rows: Vec<TerminalBookmark> = sqlx::query_as(
            "SELECT id, host_id, path, label, created_at FROM terminal_bookmarks WHERE host_id = ? ORDER BY created_at",
        )
        .bind(host_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn update_terminal_bookmark(
        &self,
        id: &str,
        path: &str,
        label: Option<&str>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE terminal_bookmarks SET path = ?, label = ? WHERE id = ?",
        )
        .bind(path)
        .bind(label)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ── SSH Config Parser ──

pub fn parse_ssh_config() -> anyhow::Result<(Vec<SshConfigEntry>, Vec<String>)> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Could not determine home directory"))?;
    let config_path = home.join(".ssh").join("config");

    if !config_path.exists() {
        return Ok((Vec::new(), Vec::new()));
    }

    let file = std::fs::File::open(&config_path)?;
    let reader = std::io::BufReader::new(file);

    let mut entries: Vec<SshConfigEntry> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // Temporary state for current host block
    let mut current_host: Option<String> = None;
    let mut current_hostname: Option<String> = None;
    let mut current_user: Option<String> = None;
    let mut current_port: Option<i64> = None;
    let mut current_proxy_jump: Option<String> = None;
    let mut current_identity_file: Option<String> = None;

    let flush_entry = |host: &Option<String>,
                       hostname: &Option<String>,
                       user: &Option<String>,
                       port: &Option<i64>,
                       proxy_jump: &Option<String>,
                       identity_file: &Option<String>,
                       entries: &mut Vec<SshConfigEntry>,
                       _errors: &mut Vec<String>| {
        if let Some(ref h) = host {
            // Skip wildcard hosts
            if h.contains('*') || h.contains('?') {
                return;
            }
            entries.push(SshConfigEntry {
                host: h.clone(),
                host_name: hostname.clone(),
                user: user.clone(),
                port: *port,
                proxy_jump: proxy_jump.clone(),
                identity_file: identity_file.clone(),
            });
        }
    };

    for (line_num, line_result) in reader.lines().enumerate() {
        let line = match line_result {
            Ok(l) => l,
            Err(e) => {
                errors.push(format!("Line {}: read error: {}", line_num + 1, e));
                continue;
            }
        };

        let trimmed = line.trim();

        // Skip empty lines and comments
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Split into keyword and value
        let (keyword, value) = if let Some(eq_pos) = trimmed.find('=') {
            let k = trimmed[..eq_pos].trim();
            let v = trimmed[eq_pos + 1..].trim();
            (k, v)
        } else {
            let mut parts = trimmed.splitn(2, char::is_whitespace);
            let k = parts.next().unwrap_or("").trim();
            let v = parts.next().unwrap_or("").trim();
            (k, v)
        };

        match keyword.to_lowercase().as_str() {
            "host" => {
                // Flush previous entry
                flush_entry(
                    &current_host,
                    &current_hostname,
                    &current_user,
                    &current_port,
                    &current_proxy_jump,
                    &current_identity_file,
                    &mut entries,
                    &mut errors,
                );

                // Start new entry
                current_host = Some(value.to_string());
                current_hostname = None;
                current_user = None;
                current_port = None;
                current_proxy_jump = None;
                current_identity_file = None;
            }
            "hostname" => {
                current_hostname = Some(value.to_string());
            }
            "user" => {
                current_user = Some(value.to_string());
            }
            "port" => {
                match value.parse::<i64>() {
                    Ok(p) => current_port = Some(p),
                    Err(_) => {
                        errors.push(format!(
                            "Line {}: invalid port value '{}'",
                            line_num + 1,
                            value
                        ));
                    }
                }
            }
            "proxyjump" => {
                current_proxy_jump = Some(value.to_string());
            }
            "identityfile" => {
                // Expand ~ to home directory
                let expanded = if let Some(stripped) = value.strip_prefix("~/") {
                    if let Some(ref home) = dirs::home_dir() {
                        home.join(stripped).to_string_lossy().to_string()
                    } else {
                        value.to_string()
                    }
                } else {
                    value.to_string()
                };
                current_identity_file = Some(expanded);
            }
            _ => {
                // Ignore other directives
            }
        }
    }

    // Flush last entry
    flush_entry(
        &current_host,
        &current_hostname,
        &current_user,
        &current_port,
        &current_proxy_jump,
        &current_identity_file,
        &mut entries,
        &mut errors,
    );

    Ok((entries, errors))
}
