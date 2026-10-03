use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest, Sha256};

/// R3-SEC-005: the SHA-256 of the Node binary Tauri bundles
/// (`sidecar/node/node`, or `node.exe` on Windows), for release profiles only.
/// The app verifies it before every sidecar spawn. Debug builds embed nothing
/// and skip the 100+ MB read; a release build without the file embeds nothing
/// and the app then refuses to start the sidecar.
fn bundled_node_sha256(manifest_dir: &Path) -> String {
    let node_dir = manifest_dir.join("sidecar").join("node");
    let node_name = if std::env::var_os("CARGO_CFG_WINDOWS").is_some() { "node.exe" } else { "node" };
    let node_path = node_dir.join(node_name);
    // The directory always exists (.gitkeep), so a missing binary does not
    // force a rerun on every build; adding or replacing it does rerun.
    println!("cargo:rerun-if-changed={}", node_dir.display());
    if node_path.is_file() {
        println!("cargo:rerun-if-changed={}", node_path.display());
    }
    if std::env::var("PROFILE").as_deref() != Ok("release") {
        return String::new();
    }
    let Ok(mut file) = File::open(&node_path) else {
        return String::new();
    };
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).expect("failed to read the bundled Node binary");
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn main() {
 let manifest_dir = PathBuf::from(
 std::env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"),
 );
 let repo_root = manifest_dir
 .parent()
 .expect("src-tauri should live under the repo root");
 let script_path = repo_root.join("scripts/prune-tauri-dist.mjs");
 let dist_path = repo_root.join("dist");

 let status = Command::new("node")
 .arg(&script_path)
 .arg(&dist_path)
 .status()
 .expect("failed to run scripts/prune-tauri-dist.mjs");

 assert!(
 status.success(),
 "scripts/prune-tauri-dist.mjs exited with status {status}",
 );

 println!(
 "cargo:rustc-env=CRYSTALBALL_BUNDLED_NODE_SHA256={}",
 bundled_node_sha256(&manifest_dir)
 );

 #[cfg(target_os = "macos")]
 println!("cargo:rustc-link-lib=framework=CoreLocation");

 tauri_build::build()
}
