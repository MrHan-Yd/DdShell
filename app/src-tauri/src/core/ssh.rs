use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use russh::client;
use russh::keys::ssh_key;
use russh::{Channel, ChannelMsg, CryptoVec, Disconnect};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::core::store::Database;

/// Session state
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum SessionState {
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
    Failed,
}

/// Handler for russh client callbacks
struct SshHandler {
    server_key_info: Arc<std::sync::Mutex<Option<(Vec<u8>, String)>>>,
}

#[async_trait]
impl client::Handler for SshHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_bytes = server_public_key.to_bytes()
            .map_err(|e| anyhow::anyhow!("Failed to encode public key: {}", e))?;

        let key_type = match server_public_key.algorithm() {
            ssh_key::Algorithm::Rsa { .. } => "ssh-rsa",
            ssh_key::Algorithm::Dsa => "ssh-dss",
            ssh_key::Algorithm::Ecdsa { curve } => match curve {
                ssh_key::EcdsaCurve::NistP256 => "ecdsa-sha2-nistp256",
                ssh_key::EcdsaCurve::NistP384 => "ecdsa-sha2-nistp384",
                ssh_key::EcdsaCurve::NistP521 => "ecdsa-sha2-nistp521",
            },
            ssh_key::Algorithm::Ed25519 => "ssh-ed25519",
            other => {
                tracing::warn!("Unknown key algorithm: {:?}", other);
                "unknown"
            }
        };

        if let Ok(mut info) = self.server_key_info.lock() {
            *info = Some((key_bytes.to_vec(), key_type.to_string()));
        }

        // Always accept — external code does known_hosts verification
        Ok(true)
    }
}

/// Commands sent to the PTY channel loop
pub enum PtyCommand {
    Resize { cols: u32, rows: u32 },
}

/// A live SSH session backed by russh
#[allow(dead_code)]
pub struct SshSession {
    pub id: String,
    pub host_id: String,
    pub state: SessionState,
    pub encoding: String,
    handle: client::Handle<SshHandler>,
    pty_channel_id: Option<russh::ChannelId>,
    pty_cmd_tx: Option<tokio::sync::mpsc::UnboundedSender<PtyCommand>>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecCommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn default_pty_modes() -> [(russh::Pty, u32); 3] {
    [
        (russh::Pty::ICRNL, 1),
        (russh::Pty::OPOST, 1),
        (russh::Pty::ONLCR, 1),
    ]
}

impl SshSession {
    /// Establish SSH connection and authenticate
    pub async fn connect(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        host_id: &str,
        timeout_secs: u64,
    ) -> anyhow::Result<Self> {
        let config = client::Config {
            inactivity_timeout: if timeout_secs == 0 { None } else { Some(std::time::Duration::from_secs(timeout_secs)) },
            // Keep alive every 30 seconds to prevent connection timeout
            keepalive_interval: Some(std::time::Duration::from_secs(30)),
            // Disconnect after 3 keepalives without response
            keepalive_max: 3,
            ..Default::default()
        };

        let handler = SshHandler {
            server_key_info: Arc::new(std::sync::Mutex::new(None)),
        };

        // Open the TCP socket ourselves so we can enable TCP_NODELAY before
        // handing it to russh. tokio's TcpStream defaults to Nagle on, which
        // combined with the remote's delayed-ACK (typically 40 ms on Linux)
        // adds ~40 ms latency to every interactive keystroke. OpenSSH and
        // PuTTY both set this flag for the same reason; russh leaves the
        // socket's options to the caller.
        let socket = tokio::net::TcpStream::connect((host, port))
            .await
            .map_err(|e| anyhow::anyhow!("TCP connect to {}:{} failed: {}", host, port, e))?;
        if let Err(e) = socket.set_nodelay(true) {
            tracing::warn!(
                "TCP_NODELAY could not be set on {}:{}: {} (keystrokes may feel laggy)",
                host, port, e,
            );
        }

        let mut handle = client::connect_stream(Arc::new(config), socket, handler)
            .await
            .map_err(|e| anyhow::anyhow!("SSH connect to {}:{} failed: {}", host, port, e))?;

        let auth_ok = handle
            .authenticate_password(username, password)
            .await
            .map_err(|e| anyhow::anyhow!("SSH auth for {}@{}:{} failed: {}", username, host, port, e))?;
        if !auth_ok {
            anyhow::bail!("AUTH_FAILED");
        }

        let id = Uuid::new_v4().to_string();

        Ok(Self {
            id,
            host_id: host_id.to_string(),
            state: SessionState::Connected,
            encoding: "utf-8".to_string(),
            handle,
            pty_channel_id: None,
            pty_cmd_tx: None,
        })
    }

    /// Connect and return host key fingerprint info
    pub async fn connect_with_fingerprint(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        host_id: &str,
        timeout_secs: u64,
    ) -> anyhow::Result<(Self, String, String)> {
        let config = client::Config {
            inactivity_timeout: if timeout_secs == 0 { None } else { Some(std::time::Duration::from_secs(timeout_secs)) },
            // Keep alive every 30 seconds to prevent connection timeout
            keepalive_interval: Some(std::time::Duration::from_secs(30)),
            // Disconnect after 3 keepalives without response
            keepalive_max: 3,
            ..Default::default()
        };

        let server_key_info = Arc::new(std::sync::Mutex::new(None));
        let handler = SshHandler {
            server_key_info: server_key_info.clone(),
        };

        // Same TCP_NODELAY treatment as `connect` above — see the comment
        // there for rationale. Without this, interactive keystrokes pile up
        // ~40 ms of Nagle/delayed-ACK latency.
        let socket = tokio::net::TcpStream::connect((host, port))
            .await
            .map_err(|e| anyhow::anyhow!("TCP connect to {}:{} failed: {}", host, port, e))?;
        if let Err(e) = socket.set_nodelay(true) {
            tracing::warn!(
                "TCP_NODELAY could not be set on {}:{}: {} (keystrokes may feel laggy)",
                host, port, e,
            );
        }

        let mut handle = client::connect_stream(Arc::new(config), socket, handler)
            .await
            .map_err(|e| anyhow::anyhow!("SSH connect to {}:{} failed: {}", host, port, e))?;

        // Extract fingerprint after handshake
        let (fingerprint, key_type) = {
            let info = server_key_info.lock().unwrap();
            match info.as_ref() {
                Some((key_bytes, kt)) => {
                    let mut hasher = Sha256::new();
                    hasher.update(key_bytes);
                    let digest = hasher.finalize();
                    let mut hex = String::new();
                    for byte in digest.iter() {
                        use std::fmt::Write;
                        write!(&mut hex, "{:02x}", byte).unwrap();
                    }
                    (hex, kt.clone())
                }
                None => anyhow::bail!("No host key available after handshake"),
            }
        };

        let auth_ok = handle
            .authenticate_password(username, password)
            .await
            .map_err(|e| anyhow::anyhow!("SSH auth for {}@{}:{} failed: {}", username, host, port, e))?;
        if !auth_ok {
            anyhow::bail!("AUTH_FAILED");
        }

        let id = Uuid::new_v4().to_string();

        let session = Self {
            id,
            host_id: host_id.to_string(),
            state: SessionState::Connected,
            encoding: "utf-8".to_string(),
            handle,
            pty_channel_id: None,
            pty_cmd_tx: None,
        };

        Ok((session, fingerprint, key_type))
    }

    /// Open a PTY channel with given dimensions.
    /// Returns (Channel for reader loop, command receiver for resize etc.)
    pub async fn open_pty(
        &mut self,
        cols: u32,
        rows: u32,
        set_locale: bool,
    ) -> anyhow::Result<(Channel<client::Msg>, tokio::sync::mpsc::UnboundedReceiver<PtyCommand>)> {
        let channel = self.handle.channel_open_session().await?;
        let channel_id = channel.id();

        // Set terminal modes for normal interactive behavior. xterm sends CR
        // for Enter, so keep ICRNL enabled to let the remote line discipline
        // turn it into NL. OPOST+ONLCR keeps output newlines rendering cleanly.
        let pty_modes = default_pty_modes();
        channel
            .request_pty(
                true,
                "xterm-256color",
                cols,
                rows,
                0,
                0,
                &pty_modes,
            )
            .await?;

        // Set locale via SSH env request (before shell starts, no terminal output)
        if set_locale {
            let _ = channel.set_env(false, "LANG", "en_US.UTF-8").await;
            let _ = channel.set_env(false, "LC_ALL", "en_US.UTF-8").await;
        }

        channel.request_shell(true).await?;

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        self.pty_channel_id = Some(channel_id);
        self.pty_cmd_tx = Some(tx);

        Ok((channel, rx))
    }

    /// Write input data to the PTY channel via Handle.data()
    pub async fn write_input(&self, data: &[u8]) -> anyhow::Result<()> {
        let _channel_id = self
            .pty_channel_id
            .ok_or_else(|| anyhow::anyhow!("No channel open"))?;
        self.handle
            .data(_channel_id, CryptoVec::from_slice(data))
            .await
            .map_err(|_| anyhow::anyhow!("Failed to send data"))?;
        Ok(())
    }

    /// Request PTY resize (sends command to the reader loop)
    pub fn resize(&self, cols: u32, rows: u32) -> anyhow::Result<()> {
        let tx = self
            .pty_cmd_tx
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No channel open"))?;
        tx.send(PtyCommand::Resize { cols, rows })
            .map_err(|_| anyhow::anyhow!("Failed to send resize command"))?;
        Ok(())
    }

    /// Initialize SFTP subsystem on a new channel, returns the SftpSession
    pub async fn init_sftp(&self) -> anyhow::Result<russh_sftp::client::SftpSession> {
        let channel = self.handle.channel_open_session().await?;
        channel.request_subsystem(false, "sftp").await?;

        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
        Ok(sftp)
    }

    /// Execute a command and return its stdout output (uses a new exec channel)
    pub async fn exec_command(&self, command: &str) -> anyhow::Result<String> {
        Ok(self.exec_command_detailed(command).await?.stdout)
    }

    /// Execute a command and collect stdout/stderr/exit code.
    pub async fn exec_command_detailed(&self, command: &str) -> anyhow::Result<ExecCommandResult> {
        self.exec_command_with_stdin_detailed(command, None).await
    }

    /// Execute a command with optional stdin and collect stdout/stderr/exit code.
    pub async fn exec_command_with_stdin_detailed(
        &self,
        command: &str,
        stdin: Option<&[u8]>,
    ) -> anyhow::Result<ExecCommandResult> {
        let channel = self.handle.channel_open_session().await?;
        channel.exec(true, command).await?;

        if let Some(stdin) = stdin {
            if !stdin.is_empty() {
                channel.data(stdin).await.map_err(|_| anyhow::anyhow!("Failed to send exec stdin"))?;
            }
            channel.eof().await?;
        }

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;
        let mut channel = channel;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    stdout.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExtendedData { data, ext }) => {
                    if ext == 1 {
                        stderr.extend_from_slice(&data);
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = Some(exit_status as i32);
                }
                Some(ChannelMsg::Eof) | None => {
                    break;
                }
                _ => {}
            }
        }

        Ok(ExecCommandResult {
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            exit_code,
        })
    }

    /// Ping the session by running a no-op command and measuring RTT
    pub async fn ping(&self) -> anyhow::Result<u64> {
        let start = std::time::Instant::now();
        self.exec_command("echo 1").await?;
        Ok(start.elapsed().as_millis() as u64)
    }

    /// Close the session
    pub async fn disconnect(&mut self) {
        self.pty_cmd_tx = None;
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "user disconnect", "")
            .await;
        self.state = SessionState::Disconnected;
    }
}

/// Manages all active SSH sessions
#[derive(Clone)]
struct SessionActivity {
    last_activity: Arc<parking_lot::Mutex<Instant>>,
    idle_timeout: Option<Duration>,
}

impl SessionActivity {
    fn new(idle_timeout: Option<Duration>) -> Self {
        Self {
            last_activity: Arc::new(parking_lot::Mutex::new(Instant::now())),
            idle_timeout,
        }
    }

    fn touch(&self) {
        *self.last_activity.lock() = Instant::now();
    }

    fn elapsed(&self) -> Duration {
        self.last_activity.lock().elapsed()
    }
}

#[derive(Clone)]
struct ManagedSession {
    session: Arc<TokioMutex<SshSession>>,
    activity: SessionActivity,
}

impl ManagedSession {
    fn new(session: SshSession, idle_timeout: Option<Duration>) -> Self {
        Self {
            session: Arc::new(TokioMutex::new(session)),
            activity: SessionActivity::new(idle_timeout),
        }
    }
}

#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<parking_lot::Mutex<HashMap<String, ManagedSession>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(parking_lot::Mutex::new(HashMap::new())),
        }
    }

    /// Connect to a host and return (session_id, pty_channel, cmd_receiver)
    pub async fn connect(
        &self,
        db: &Database,
        host_id: &str,
        password: &str,
        cols: u32,
        rows: u32,
        timeout_secs: u64,
    ) -> anyhow::Result<(String, Channel<client::Msg>, tokio::sync::mpsc::UnboundedReceiver<PtyCommand>)> {
        let host = db
            .get_host(host_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Host not found"))?;

        let (mut session, fingerprint, key_type) =
            SshSession::connect_with_fingerprint(
                &host.host,
                host.port as u16,
                &host.username,
                password,
                host_id,
                timeout_secs,
            )
            .await?;

        // Check known hosts
        let known = db.get_known_host(&host.host, host.port).await?;
        match known {
            Some(kh) => {
                if kh.fingerprint != fingerprint {
                    anyhow::bail!(
                        "FINGERPRINT_MISMATCH: Host key fingerprint has changed! Expected {}, got {}. This could indicate a security breach.",
                        &kh.fingerprint[..16],
                        &fingerprint[..16]
                    );
                }
            }
            None => {
                db.save_known_host(&host.host, host.port, &key_type, &fingerprint)
                    .await?;
            }
        }

        // Read terminal settings
        let set_locale = db
            .get_setting("terminal.setLocale")
            .await?
            .map(|v| v == "true")
            .unwrap_or(false);

        let (channel, cmd_rx) = session.open_pty(cols, rows, set_locale).await?;

        let session_id = session.id.clone();
        let idle_timeout = if timeout_secs == 0 {
            None
        } else {
            Some(Duration::from_secs(timeout_secs))
        };
        self.sessions.lock().insert(
            session_id.clone(),
            ManagedSession::new(session, idle_timeout),
        );

        Ok((session_id, channel, cmd_rx))
    }

    /// Get a session by ID
    pub fn get(&self, session_id: &str) -> Option<Arc<TokioMutex<SshSession>>> {
        self.sessions
            .lock()
            .get(session_id)
            .map(|entry| entry.session.clone())
    }

    /// Check if a session exists in the manager (not disconnected)
    pub fn is_connected(&self, session_id: &str) -> bool {
        self.sessions.lock().contains_key(session_id)
    }

    /// Disconnect and remove a session
    pub async fn disconnect(&self, session_id: &str) -> anyhow::Result<()> {
        let session = self
            .sessions
            .lock()
            .remove(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        session.session.lock().await.disconnect().await;
        Ok(())
    }

    /// Mark user/application activity for an active session.
    pub fn touch_activity(&self, session_id: &str) -> bool {
        let entry = self.sessions.lock().get(session_id).cloned();
        if let Some(entry) = entry {
            entry.activity.touch();
            true
        } else {
            false
        }
    }

    /// Return the configured application-level idle timeout for a session.
    pub fn idle_timeout(&self, session_id: &str) -> Option<Duration> {
        self.sessions
            .lock()
            .get(session_id)
            .and_then(|entry| entry.activity.idle_timeout)
    }

    /// Return elapsed user/application idle time for a session.
    pub fn idle_elapsed(&self, session_id: &str) -> Option<Duration> {
        self.sessions
            .lock()
            .get(session_id)
            .map(|entry| entry.activity.elapsed())
    }

    /// Ping an active session and return RTT in ms
    pub async fn ping_session(&self, session_id: &str) -> anyhow::Result<u64> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .map(|entry| entry.session.clone())
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;
        let result = session.lock().await.ping().await;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_activity_keeps_disabled_timeout() {
        let activity = SessionActivity::new(None);
        assert_eq!(activity.idle_timeout, None);
    }

    #[test]
    fn default_pty_modes_keep_enter_as_line_submit() {
        let modes = default_pty_modes();

        assert_eq!(
            modes
                .iter()
                .find(|(mode, _)| *mode == russh::Pty::ICRNL)
                .map(|(_, value)| *value),
            Some(1)
        );
    }

    #[test]
    fn session_activity_touch_resets_elapsed_idle_time() {
        let activity = SessionActivity::new(Some(Duration::from_secs(30)));
        *activity.last_activity.lock() = Instant::now() - Duration::from_secs(10);
        assert!(activity.elapsed() >= Duration::from_secs(10));

        activity.touch();
        assert!(activity.elapsed() < Duration::from_secs(1));
    }
}
