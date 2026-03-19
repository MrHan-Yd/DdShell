use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::Serialize;
use uuid::Uuid;

use crate::core::ssh::SessionManager;

// ── Data Structures ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub timestamp: u64,
    pub uptime: String,
    pub server_time: String,
    pub load: LoadInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub network: NetworkInfo,
    pub processes: Vec<ProcessInfo>,
    pub disks: Vec<DiskInfo>,
    pub session_health: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadInfo {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub usage_percent: f64,
    pub core_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_mb: u64,
    pub used_mb: u64,
    pub free_mb: u64,
    pub cache_mb: u64,
    pub usage_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub user: String,
    pub cpu_percent: f64,
    pub mem_percent: f64,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub filesystem: String,
    pub mount: String,
    pub total: String,
    pub used: String,
    pub available: String,
    pub usage_percent: f64,
}

// ── Collector State ──

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CollectorState {
    Running,
    Stopped,
    Error,
}

struct CollectorInner {
    session_id: String,
    interval_secs: u64,
    state: CollectorState,
    cancel: bool,
    /// Ring buffer: max 1800 entries (~60 min at 2s interval)
    snapshots: VecDeque<MetricsSnapshot>,
    /// Last network bytes for delta calculation
    last_net: Option<(u64, u64, u64)>, // (timestamp_ms, rx_total, tx_total)
}

/// Manages system metrics collectors per session
#[derive(Clone)]
pub struct MetricsManager {
    collectors: Arc<Mutex<HashMap<String, Arc<Mutex<CollectorInner>>>>>,
}

impl MetricsManager {
    pub fn new() -> Self {
        Self {
            collectors: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a collector for a session
    pub fn start(
        &self,
        session_id: &str,
        interval_secs: u64,
    ) -> String {
        let collector_id = Uuid::new_v4().to_string();
        let inner = Arc::new(Mutex::new(CollectorInner {
            session_id: session_id.to_string(),
            interval_secs,
            state: CollectorState::Running,
            cancel: false,
            snapshots: VecDeque::with_capacity(1800),
            last_net: None,
        }));

        self.collectors
            .lock()
            .insert(collector_id.clone(), inner);

        collector_id
    }

    /// Stop a collector
    pub fn stop(&self, collector_id: &str) {
        if let Some(inner) = self.collectors.lock().get(collector_id) {
            let mut inner = inner.lock();
            inner.cancel = true;
            inner.state = CollectorState::Stopped;
        }
    }

    /// Remove a collector
    #[allow(dead_code)]
    pub fn remove(&self, collector_id: &str) {
        self.collectors.lock().remove(collector_id);
    }

    /// Check if collector should continue
    pub fn should_continue(&self, collector_id: &str) -> bool {
        self.collectors
            .lock()
            .get(collector_id)
            .map(|inner| !inner.lock().cancel)
            .unwrap_or(false)
    }

    /// Get the session_id and interval for a collector
    pub fn get_config(&self, collector_id: &str) -> Option<(String, u64)> {
        self.collectors
            .lock()
            .get(collector_id)
            .map(|inner| {
                let inner = inner.lock();
                (inner.session_id.clone(), inner.interval_secs)
            })
    }

    /// Mark a collector as errored
    pub fn mark_error(&self, collector_id: &str) {
        if let Some(inner) = self.collectors.lock().get(collector_id) {
            let mut inner = inner.lock();
            inner.state = CollectorState::Error;
            inner.cancel = true;
        }
    }

    /// Push a snapshot to the collector's ring buffer
    pub fn push_snapshot(&self, collector_id: &str, snapshot: MetricsSnapshot) {
        if let Some(inner) = self.collectors.lock().get(collector_id) {
            let mut inner = inner.lock();
            if inner.snapshots.len() >= 1800 {
                inner.snapshots.pop_front();
            }
            inner.snapshots.push_back(snapshot);
        }
    }

    /// Get the latest snapshot from a collector
    pub fn latest_snapshot(&self, collector_id: &str) -> Option<MetricsSnapshot> {
        self.collectors
            .lock()
            .get(collector_id)
            .and_then(|inner| inner.lock().snapshots.back().cloned())
    }

    /// Get all snapshots for a collector
    pub fn all_snapshots(&self, collector_id: &str) -> Vec<MetricsSnapshot> {
        self.collectors
            .lock()
            .get(collector_id)
            .map(|inner| inner.lock().snapshots.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get the collector state
    #[allow(dead_code)]
    pub fn state(&self, collector_id: &str) -> Option<CollectorState> {
        self.collectors
            .lock()
            .get(collector_id)
            .map(|inner| inner.lock().state.clone())
    }

    /// Find collector ID for a session
    pub fn find_by_session(&self, session_id: &str) -> Option<String> {
        self.collectors
            .lock()
            .iter()
            .find(|(_, v)| {
                let inner = v.lock();
                inner.session_id == session_id && !inner.cancel
            })
            .map(|(k, _)| k.clone())
    }

    /// Get and update last network bytes; returns delta
    pub fn update_net_bytes(
        &self,
        collector_id: &str,
        rx_total: u64,
        tx_total: u64,
    ) -> (u64, u64) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        if let Some(inner) = self.collectors.lock().get(collector_id) {
            let mut inner = inner.lock();
            let (rx_rate, tx_rate) = if let Some((last_ts, last_rx, last_tx)) = inner.last_net {
                let dt = (now_ms.saturating_sub(last_ts)).max(1) as f64 / 1000.0;
                let rx_delta = rx_total.saturating_sub(last_rx);
                let tx_delta = tx_total.saturating_sub(last_tx);
                ((rx_delta as f64 / dt) as u64, (tx_delta as f64 / dt) as u64)
            } else {
                (0, 0)
            };
            inner.last_net = Some((now_ms, rx_total, tx_total));
            (rx_rate, tx_rate)
        } else {
            (0, 0)
        }
    }
}

// ── Metric Collection ──

/// Collect a single metrics snapshot from a remote host
pub async fn collect_snapshot(
    session_mgr: &SessionManager,
    session_id: &str,
    metrics_mgr: &MetricsManager,
    collector_id: &str,
) -> anyhow::Result<MetricsSnapshot> {
    let session = session_mgr
        .get(session_id)
        .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

    let sess = session.lock().await;

    // Run a combined command to reduce round-trips
    let combined_cmd = concat!(
        "echo '===UPTIME==='; uptime; ",
        "echo '===DATETIME==='; date '+%Y-%m-%d %H:%M'; ",
        "echo '===LOADAVG==='; cat /proc/loadavg 2>/dev/null || uptime; ",
        "echo '===CPU==='; top -bn1 | head -5; ",
        "echo '===CPUINFO==='; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1; ",
        "echo '===MEMORY==='; free -m; ",
        "echo '===NETWORK==='; cat /proc/net/dev 2>/dev/null || netstat -ib; ",
        "echo '===PROCESS==='; ps aux --sort=-%cpu 2>/dev/null | head -16 || ps aux | head -16; ",
        "echo '===DISK==='; df -h 2>/dev/null; ",
        "echo '===END==='",
    );

    let output = sess.exec_command(combined_cmd).await?;
    drop(sess);

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Parse sections
    let sections = parse_sections(&output);

    let uptime = parse_uptime(sections.get("UPTIME").unwrap_or(&String::new()));
    let server_time = sections.get("DATETIME").unwrap_or(&String::new()).trim().to_string();
    let load = parse_loadavg(sections.get("LOADAVG").unwrap_or(&String::new()));
    let cpu = parse_cpu(sections.get("CPU").unwrap_or(&String::new()));
    let core_count = sections
        .get("CPUINFO")
        .unwrap_or(&String::new())
        .trim()
        .parse::<u32>()
        .unwrap_or(1);
    let cpu_with_core = CpuInfo {
        usage_percent: cpu.usage_percent,
        core_count,
    };
    let memory = parse_memory(sections.get("MEMORY").unwrap_or(&String::new()));

    // Network: parse total bytes and compute rate
    let (rx_total, tx_total) = parse_net_bytes(sections.get("NETWORK").unwrap_or(&String::new()));
    let (rx_rate, tx_rate) = metrics_mgr.update_net_bytes(collector_id, rx_total, tx_total);

    let network = NetworkInfo {
        rx_bytes_per_sec: rx_rate,
        tx_bytes_per_sec: tx_rate,
    };

    let processes = parse_processes(sections.get("PROCESS").unwrap_or(&String::new()));
    let disks = parse_disks(sections.get("DISK").unwrap_or(&String::new()));

    // Compute session health score
    let mut health: f64 = 100.0;
    if cpu.usage_percent > 90.0 {
        health -= 20.0;
    }
    if memory.usage_percent > 90.0 {
        health -= 20.0;
    }
    if load.one > 8.0 {
        health -= 30.0; // 15 for >4.0 and another 15 for >8.0
    } else if load.one > 4.0 {
        health -= 15.0;
    }
    // Clamp to 0-100
    health = health.clamp(0.0, 100.0);

    Ok(MetricsSnapshot {
        timestamp,
        uptime,
        server_time,
        load,
        cpu: cpu_with_core,
        memory,
        network,
        processes,
        disks,
        session_health: Some(health),
    })
}

// ── Parsers ──

fn parse_sections(output: &str) -> HashMap<String, String> {
    let mut sections = HashMap::new();
    let mut current_key: Option<String> = None;
    let mut current_buf = String::new();

    for line in output.lines() {
        if let Some(key) = line.strip_prefix("===").and_then(|s| s.strip_suffix("===")) {
            if let Some(k) = current_key.take() {
                sections.insert(k, current_buf.clone());
                current_buf.clear();
            }
            if key != "END" {
                current_key = Some(key.to_string());
            }
        } else if current_key.is_some() {
            if !current_buf.is_empty() {
                current_buf.push('\n');
            }
            current_buf.push_str(line);
        }
    }

    if let Some(k) = current_key {
        sections.insert(k, current_buf);
    }

    sections
}

fn parse_uptime(output: &str) -> String {
    // Extract uptime string like "up 5 days, 3:22"
    let line = output.lines().next().unwrap_or("").trim();
    if let Some(idx) = line.find("up ") {
        let rest = &line[idx + 3..];
        // Find the end (before "user" or before load)
        if let Some(end) = rest.find(" user") {
            let part = &rest[..end];
            // Remove trailing comma and numbers
            if let Some(comma) = part.rfind(',') {
                part[..comma].trim().to_string()
            } else {
                part.trim().to_string()
            }
        } else {
            rest.split(',').take(2).collect::<Vec<_>>().join(",").trim().to_string()
        }
    } else {
        "unknown".to_string()
    }
}

fn parse_loadavg(output: &str) -> LoadInfo {
    // Try /proc/loadavg format first: "0.20 0.18 0.15 1/235 12345"
    let line = output.lines().next().unwrap_or("").trim();
    let parts: Vec<&str> = line.split_whitespace().collect();

    if parts.len() >= 3 {
        if let (Ok(one), Ok(five), Ok(fifteen)) = (
            parts[0].parse::<f64>(),
            parts[1].parse::<f64>(),
            parts[2].parse::<f64>(),
        ) {
            return LoadInfo { one, five, fifteen };
        }
    }

    // Fallback: parse from uptime output "load average: 0.20, 0.18, 0.15"
    if let Some(idx) = line.find("load average:") {
        let rest = &line[idx + 13..];
        let nums: Vec<f64> = rest
            .split(',')
            .filter_map(|s| s.trim().parse::<f64>().ok())
            .collect();
        if nums.len() >= 3 {
            return LoadInfo {
                one: nums[0],
                five: nums[1],
                fifteen: nums[2],
            };
        }
    }

    LoadInfo {
        one: 0.0,
        five: 0.0,
        fifteen: 0.0,
    }
}

fn parse_cpu(output: &str) -> CpuInfo {
    // Parse from top output: "%Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 92.0 id, ..."
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("%Cpu") || line.starts_with("Cpu") {
            // Find idle percentage
            if let Some(idle_idx) = line.find(" id") {
                let before = &line[..idle_idx];
                let idle: f64 = before
                    .rsplit(&[',', ' '][..])
                    .find_map(|s| s.trim().parse::<f64>().ok())
                    .unwrap_or(0.0);
                return CpuInfo {
                    usage_percent: (100.0 - idle).max(0.0),
                    core_count: 1, // Will be overridden by CPUINFO
                };
            }
        }
    }

    CpuInfo {
        usage_percent: 0.0,
        core_count: 1,
    }
}

fn parse_memory(output: &str) -> MemoryInfo {
    // Parse from free -m output:
    //               total       used       free     shared  buff/cache   available
    // Mem:           7856       3245       1234        456       3377        3867
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("Mem:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                let total = parts[1].parse::<u64>().unwrap_or(0);
                let used = parts[2].parse::<u64>().unwrap_or(0);
                let free = parts[3].parse::<u64>().unwrap_or(0);
                let cache = if parts.len() >= 6 {
                    parts[5].parse::<u64>().unwrap_or(0)
                } else {
                    0
                };
                let usage_percent = if total > 0 {
                    (used as f64 / total as f64) * 100.0
                } else {
                    0.0
                };
                return MemoryInfo {
                    total_mb: total,
                    used_mb: used,
                    free_mb: free,
                    cache_mb: cache,
                    usage_percent,
                };
            }
        }
    }

    MemoryInfo {
        total_mb: 0,
        used_mb: 0,
        free_mb: 0,
        cache_mb: 0,
        usage_percent: 0.0,
    }
}

fn parse_net_bytes(output: &str) -> (u64, u64) {
    // Parse from /proc/net/dev:
    // Inter-|   Receive                                                |  Transmit
    //  face |bytes    packets errs drop ...                            |bytes    packets ...
    //    lo: 123456    789   0   0 ...                                  123456    789   0
    //  eth0: 987654   321   0   0 ...                                   654321    123   0
    let mut total_rx: u64 = 0;
    let mut total_tx: u64 = 0;

    for line in output.lines() {
        let line = line.trim();
        if line.contains(':') && !line.contains('|') {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 2 {
                let iface = parts[0].trim();
                // Skip loopback
                if iface == "lo" {
                    continue;
                }
                let nums: Vec<u64> = parts[1]
                    .split_whitespace()
                    .filter_map(|s| s.parse::<u64>().ok())
                    .collect();
                if nums.len() >= 9 {
                    total_rx += nums[0]; // bytes received
                    total_tx += nums[8]; // bytes transmitted
                }
            }
        }
    }

    (total_rx, total_tx)
}

fn parse_processes(output: &str) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();
    let mut first = true;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Skip header line
        if first {
            first = false;
            if line.starts_with("USER") || line.starts_with("PID") {
                continue;
            }
        }

        // Parse: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
        // First 10 fields are fixed, rest is the command
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 11 {
            let user = parts[0].to_string();
            let pid = parts[1].parse::<u32>().unwrap_or(0);
            let cpu_percent = parts[2].parse::<f64>().unwrap_or(0.0);
            let mem_percent = parts[3].parse::<f64>().unwrap_or(0.0);
            // Join remaining parts as command (handles commands with spaces)
            let command = parts[10..].join(" ");

            if pid > 0 {
                processes.push(ProcessInfo {
                    pid,
                    user,
                    cpu_percent,
                    mem_percent,
                    command,
                });
            }
        }
    }

    // Return top 15
    processes.truncate(15);
    processes
}

fn parse_disks(output: &str) -> Vec<DiskInfo> {
    let mut disks = Vec::new();
    let mut first = true;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Skip header
        if first {
            first = false;
            if line.starts_with("Filesystem") {
                continue;
            }
        }

        // Parse: Filesystem Size Used Avail Use% Mounted on
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 6 {
            let filesystem = parts[0].to_string();

            // Skip virtual filesystems
            if filesystem.starts_with("tmpfs")
                || filesystem.starts_with("devtmpfs")
                || filesystem == "none"
                || filesystem == "udev"
            {
                continue;
            }

            let usage_str = parts[4].trim_end_matches('%');
            let usage_percent = usage_str.parse::<f64>().unwrap_or(0.0);

            disks.push(DiskInfo {
                filesystem,
                mount: parts[5].to_string(),
                total: parts[1].to_string(),
                used: parts[2].to_string(),
                available: parts[3].to_string(),
                usage_percent,
            });
        }
    }

    disks
}
