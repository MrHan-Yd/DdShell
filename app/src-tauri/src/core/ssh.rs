use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;

use parking_lot::Mutex;
use ssh2::Session as Ssh2Session;
use uuid::Uuid;

use crate::core::store::Database;

/// Session state — GLOSSARY §7
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
    Failed,
}

/// A live SSH session with a PTY channel
pub struct SshSession {
    pub id: String,
    pub host_id: String,
    pub state: SessionState,
    ssh: Ssh2Session,
    channel: Option<ssh2::Channel>,
    _tcp: TcpStream,
}

impl SshSession {
    /// Establish SSH connection and authenticate
    pub fn connect(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        host_id: &str,
    ) -> anyhow::Result<Self> {
        let addr = format!("{}:{}", host, port);
        let tcp = TcpStream::connect(&addr)?;
        tcp.set_nonblocking(false)?;

        let mut sess = Ssh2Session::new()?;
        sess.set_tcp_stream(tcp.try_clone()?);
        sess.handshake()?;
        sess.userauth_password(username, password)?;

        if !sess.authenticated() {
            anyhow::bail!("AUTH_FAILED");
        }

        let id = Uuid::new_v4().to_string();

        Ok(Self {
            id,
            host_id: host_id.to_string(),
            state: SessionState::Connected,
            ssh: sess,
            channel: None,
            _tcp: tcp,
        })
    }

    /// Open a PTY channel with given dimensions
    pub fn open_pty(&mut self, cols: u32, rows: u32) -> anyhow::Result<()> {
        let mut channel = self.ssh.channel_session()?;
        channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))?;
        channel.shell()?;
        self.ssh.set_blocking(false);
        self.channel = Some(channel);
        Ok(())
    }

    /// Read available output from the PTY channel
    pub fn read_output(&mut self) -> anyhow::Result<Vec<u8>> {
        let channel = self
            .channel
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No channel open"))?;

        let mut buf = vec![0u8; 8192];
        match channel.read(&mut buf) {
            Ok(0) => Ok(vec![]),
            Ok(n) => {
                buf.truncate(n);
                Ok(buf)
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(vec![]),
            Err(e) => Err(e.into()),
        }
    }

    /// Write input data to the PTY channel
    pub fn write_input(&mut self, data: &[u8]) -> anyhow::Result<()> {
        let channel = self
            .channel
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No channel open"))?;
        channel.write_all(data)?;
        channel.flush()?;
        Ok(())
    }

    /// Resize PTY
    pub fn resize(&mut self, cols: u32, rows: u32) -> anyhow::Result<()> {
        let channel = self
            .channel
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No channel open"))?;
        channel.request_pty_size(cols, rows, None, None)?;
        Ok(())
    }

    /// Check if the channel has been closed by the remote
    pub fn is_eof(&self) -> bool {
        self.channel.as_ref().map(|c| c.eof()).unwrap_or(true)
    }

    /// Get an SFTP subsystem handle (requires blocking mode temporarily)
    pub fn sftp(&self) -> anyhow::Result<ssh2::Sftp> {
        self.ssh.set_blocking(true);
        let sftp = self.ssh.sftp()?;
        // Note: we leave blocking on because SFTP operations need it
        // The output reader loop will handle non-blocking separately
        Ok(sftp)
    }

    /// Close the session
    pub fn disconnect(&mut self) {
        if let Some(ref mut ch) = self.channel {
            let _ = ch.close();
            let _ = ch.wait_close();
        }
        self.channel = None;
        let _ = self.ssh.disconnect(None, "user disconnect", None);
        self.state = SessionState::Disconnected;
    }
}

/// Manages all active SSH sessions
#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<SshSession>>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Connect to a host and return session ID
    pub async fn connect(
        &self,
        db: &Database,
        host_id: &str,
        password: &str,
        cols: u32,
        rows: u32,
    ) -> anyhow::Result<String> {
        let host = db
            .get_host(host_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Host not found"))?;

        let host_addr = host.host.clone();
        let port = host.port as u16;
        let username = host.username.clone();
        let hid = host_id.to_string();
        let pw = password.to_string();

        // SSH connect in blocking thread
        let session = tokio::task::spawn_blocking(move || {
            let mut sess = SshSession::connect(&host_addr, port, &username, &pw, &hid)?;
            sess.open_pty(cols, rows)?;
            Ok::<_, anyhow::Error>(sess)
        })
        .await??;

        let session_id = session.id.clone();
        let session = Arc::new(Mutex::new(session));
        self.sessions.lock().insert(session_id.clone(), session);

        Ok(session_id)
    }

    /// Get a session by ID
    pub fn get(&self, session_id: &str) -> Option<Arc<Mutex<SshSession>>> {
        self.sessions.lock().get(session_id).cloned()
    }

    /// Disconnect and remove a session
    pub fn disconnect(&self, session_id: &str) -> anyhow::Result<()> {
        let session = self
            .sessions
            .lock()
            .remove(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        session.lock().disconnect();
        Ok(())
    }
}
