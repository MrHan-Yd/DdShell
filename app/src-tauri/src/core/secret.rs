use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use sha2::{Digest, Sha256};

/// Derive a 256-bit key from a machine-specific seed.
/// Uses: username + hostname + a static salt.
fn derive_key() -> [u8; 32] {
    let username = whoami().unwrap_or_else(|| "default".into());
    let hostname = gethostname().unwrap_or_else(|| "localhost".into());
    let seed = format!("shell::{}::{}::v1", username, hostname);

    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    hasher.finalize().into()
}

fn whoami() -> Option<String> {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
}

fn gethostname() -> Option<String> {
    hostname::get().ok().and_then(|h| h.into_string().ok())
}

/// Encrypt a password string → base64 ciphertext (nonce is prepended).
pub fn encrypt(plain: &str) -> anyhow::Result<String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;

    // 96-bit random nonce
    let nonce_bytes: [u8; 12] = rand_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| anyhow::anyhow!("encrypt failed: {}", e))?;

    // prepend nonce to ciphertext, then base64
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(B64.encode(&combined))
}

/// Decrypt a base64 ciphertext → plain password string.
pub fn decrypt(encoded: &str) -> anyhow::Result<String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;

    let combined = B64
        .decode(encoded)
        .map_err(|e| anyhow::anyhow!("base64 decode failed: {}", e))?;

    if combined.len() < 13 {
        anyhow::bail!("ciphertext too short");
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("decrypt failed: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| anyhow::anyhow!("utf8 failed: {}", e))
}

/// Generate a random 12-byte nonce using a simple approach.
fn rand_nonce() -> [u8; 12] {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let mut hasher = Sha256::new();
    hasher.update(t.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    // Mix in a counter for uniqueness within same nanosecond
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let c = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    hasher.update(c.to_le_bytes());
    let hash = hasher.finalize();

    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&hash[..12]);
    nonce
}
