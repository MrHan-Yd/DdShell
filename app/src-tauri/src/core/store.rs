use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{FromRow, SqlitePool};
use std::path::Path;
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
pub struct Snippet {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
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
            "CREATE TABLE IF NOT EXISTS snippets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                command TEXT NOT NULL,
                description TEXT,
                tags TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
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
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO hosts (id, name, host, port, username, auth_type, group_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(host)
        .bind(port)
        .bind(username)
        .bind(auth_type)
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

        sqlx::query(
            "UPDATE hosts SET name=?, host=?, port=?, username=?, auth_type=?, group_id=?, is_favorite=?, sort_order=?, updated_at=? WHERE id=?",
        )
        .bind(&name)
        .bind(&host_addr)
        .bind(port)
        .bind(&username)
        .bind(&auth_type)
        .bind(&group_id)
        .bind(is_favorite)
        .bind(sort_order)
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
        sqlx::query("UPDATE hosts SET group_id = NULL WHERE group_id = ?")
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

    // ── Snippet CRUD ──

    pub async fn create_snippet(
        &self,
        title: &str,
        command: &str,
        description: Option<&str>,
        tags: Option<&str>,
    ) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO snippets (id, title, command, description, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(title)
        .bind(command)
        .bind(description)
        .bind(tags)
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
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        let current: Snippet = sqlx::query_as(
            "SELECT id, title, command, description, tags, sort_order, created_at, updated_at FROM snippets WHERE id = ?",
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

        sqlx::query(
            "UPDATE snippets SET title=?, command=?, description=?, tags=?, updated_at=? WHERE id=?",
        )
        .bind(&title)
        .bind(&command)
        .bind(&description)
        .bind(&tags)
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
            "SELECT id, title, command, description, tags, sort_order, created_at, updated_at FROM snippets ORDER BY sort_order, title",
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
}
