use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::{Entry, Error as KeyringError};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const KEYRING_SERVICE: &str = "com.hanyongding.ddshell";
const KEYRING_REF_PREFIX: &str = "keyring:v1:";
const LOCAL_REF_PREFIX: &str = "local:v1:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SecretReference<'a> {
    Keyring { account: &'a str },
    Local { ciphertext: &'a str },
    Legacy { ciphertext: &'a str },
}

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

/// Store a secret and return an opaque reference.
///
/// Preferred storage is the OS credential store. If it is unavailable, return
/// a marked local fallback reference so existing workflows keep working.
pub fn encrypt(plain: &str) -> anyhow::Result<String> {
    encrypt_keyring(plain).or_else(|err| {
        tracing::warn!(
            "keyring secret storage unavailable, using local fallback: {}",
            err
        );
        encrypt_local_reference(plain)
    })
}

/// Resolve a secret reference. Supports keyring, marked local fallback, and
/// legacy raw AES-GCM ciphertext values.
pub fn decrypt(encoded: &str) -> anyhow::Result<String> {
    match parse_reference(encoded) {
        SecretReference::Keyring { account } => {
            let entry = Entry::new(KEYRING_SERVICE, account)?;
            entry
                .get_password()
                .map_err(|e| anyhow::anyhow!("keyring read failed: {}", e))
        }
        SecretReference::Local { ciphertext } | SecretReference::Legacy { ciphertext } => {
            decrypt_local_ciphertext(ciphertext)
        }
    }
}

pub fn needs_keyring_migration(reference: &str) -> bool {
    !matches!(parse_reference(reference), SecretReference::Keyring { .. })
}

pub fn try_migrate_to_keyring(reference: &str, plain: &str) -> Option<String> {
    if !needs_keyring_migration(reference) {
        return None;
    }
    match encrypt_keyring(plain) {
        Ok(next_ref) => Some(next_ref),
        Err(err) => {
            tracing::warn!("keyring credential migration skipped: {}", err);
            None
        }
    }
}

pub fn delete(reference: &str) -> anyhow::Result<()> {
    if let SecretReference::Keyring { account } = parse_reference(reference) {
        let entry = Entry::new(KEYRING_SERVICE, account)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(anyhow::anyhow!("keyring delete failed: {}", err)),
        }
    } else {
        Ok(())
    }
}

fn parse_reference(encoded: &str) -> SecretReference<'_> {
    if let Some(account) = encoded.strip_prefix(KEYRING_REF_PREFIX) {
        SecretReference::Keyring { account }
    } else if let Some(ciphertext) = encoded.strip_prefix(LOCAL_REF_PREFIX) {
        SecretReference::Local { ciphertext }
    } else {
        SecretReference::Legacy {
            ciphertext: encoded,
        }
    }
}

fn encrypt_keyring(plain: &str) -> anyhow::Result<String> {
    let account = format!("secret:{}", Uuid::new_v4());
    let entry = Entry::new(KEYRING_SERVICE, &account)?;
    entry
        .set_password(plain)
        .map_err(|e| anyhow::anyhow!("keyring write failed: {}", e))?;
    Ok(format!("{}{}", KEYRING_REF_PREFIX, account))
}

fn encrypt_local_reference(plain: &str) -> anyhow::Result<String> {
    Ok(format!(
        "{}{}",
        LOCAL_REF_PREFIX,
        encrypt_local_ciphertext(plain)?
    ))
}

fn encrypt_local_ciphertext(plain: &str) -> anyhow::Result<String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;

    let nonce_bytes = random_nonce()?;
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

fn decrypt_local_ciphertext(encoded: &str) -> anyhow::Result<String> {
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

fn random_nonce() -> anyhow::Result<[u8; 12]> {
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce)
        .map_err(|e| anyhow::anyhow!("secure nonce generation failed: {}", e))?;
    Ok(nonce)
}

#[cfg(test)]
mod tests {
    use super::{
        decrypt, encrypt_local_ciphertext, encrypt_local_reference, needs_keyring_migration,
        parse_reference, SecretReference, KEYRING_REF_PREFIX,
    };

    #[test]
    fn local_fallback_secret_round_trips() {
        let encrypted = encrypt_local_reference("s3cret").expect("encrypt should succeed");
        assert!(encrypted.starts_with("local:v1:"));
        assert_ne!(encrypted, "s3cret");
        let decrypted = decrypt(&encrypted).expect("decrypt should succeed");
        assert_eq!(decrypted, "s3cret");
    }

    #[test]
    fn legacy_secret_still_decrypts() {
        let encrypted = encrypt_local_ciphertext("legacy").expect("encrypt should succeed");
        assert!(!encrypted.contains(":v1:"));
        assert_eq!(
            decrypt(&encrypted).expect("decrypt should succeed"),
            "legacy"
        );
    }

    #[test]
    fn reference_parser_classifies_formats() {
        assert_eq!(
            parse_reference("keyring:v1:secret:abc"),
            SecretReference::Keyring {
                account: "secret:abc"
            }
        );
        assert_eq!(
            parse_reference("local:v1:ciphertext"),
            SecretReference::Local {
                ciphertext: "ciphertext"
            }
        );
        assert_eq!(
            parse_reference("ciphertext"),
            SecretReference::Legacy {
                ciphertext: "ciphertext"
            }
        );
    }

    #[test]
    fn migration_needed_only_for_non_keyring_references() {
        assert!(!needs_keyring_migration(&format!(
            "{}{}",
            KEYRING_REF_PREFIX, "secret:abc"
        )));
        assert!(needs_keyring_migration("local:v1:ciphertext"));
        assert!(needs_keyring_migration("legacy-ciphertext"));
    }
}
