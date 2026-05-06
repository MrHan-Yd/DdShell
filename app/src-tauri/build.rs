fn normalize_package_type(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "dmg" => Some("dmg"),
        "msi" => Some("msi"),
        "nsis" | "exe" => Some("exe"),
        "deb" => Some("deb"),
        "appimage" => Some("appimage"),
        _ => None,
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=DDSHELL_PACKAGE_TYPE");
    println!("cargo:rerun-if-env-changed=TAURI_BUNDLE_TYPE");

    if let Some(package_type) = std::env::var("DDSHELL_PACKAGE_TYPE")
        .ok()
        .or_else(|| std::env::var("TAURI_BUNDLE_TYPE").ok())
        .and_then(|value| normalize_package_type(&value).map(str::to_string))
    {
        println!("cargo:rustc-env=DDSHELL_PACKAGE_TYPE={package_type}");
    }

    tauri_build::build()
}
