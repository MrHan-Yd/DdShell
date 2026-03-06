use keyring::Entry;

const SERVICE_NAME: &str = "com.hanyongding.shell";

/// Store a password in the system keyring
pub fn store_password(host_id: &str, password: &str) -> anyhow::Result<String> {
    let secret_ref = format!("ssh-password-{}", host_id);
    let entry = Entry::new(SERVICE_NAME, &secret_ref)?;
    entry.set_password(password)?;
    Ok(secret_ref)
}

/// Retrieve a password from the system keyring
pub fn get_password(secret_ref: &str) -> anyhow::Result<String> {
    let entry = Entry::new(SERVICE_NAME, secret_ref)?;
    let password = entry.get_password()?;
    Ok(password)
}

/// Delete a password from the system keyring
pub fn delete_password(secret_ref: &str) -> anyhow::Result<()> {
    let entry = Entry::new(SERVICE_NAME, secret_ref)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(e) => Err(e.into()),
    }
}

/// Check if a password exists in the keyring
pub fn has_password(secret_ref: &str) -> bool {
    Entry::new(SERVICE_NAME, secret_ref)
        .and_then(|e| e.get_password())
        .is_ok()
}
