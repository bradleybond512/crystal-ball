//! Log rotation (R4-LOW-007). Pure std, so it compiles and tests on its own.
//!
//! Two strategies, both keeping `max_backups` numbered copies
//! (`x.log.1` newest … `x.log.N` oldest):
//!
//! * [`rotate_by_rename`]: for files only this process writes and reopens per
//!   write (the desktop log). The current file is renamed to `.log.1`.
//! * [`rotate_by_copy_truncate`]: for a file ANOTHER process keeps open in
//!   append mode, the sidecar's stdout/stderr. A rename would leave the child
//!   writing to `.log.1` forever, so the contents are copied to `.log.1` and the
//!   original is truncated in place. The child's O_APPEND descriptor then
//!   writes at the new end of file (offset 0), the standard `logrotate
//!   copytruncate` technique. Trade-off: a line written between the copy and the
//!   truncate can be lost; acceptable for a diagnostic log, and nothing can
//!   block the child (unlike piping its output through this process).
//!
//! A shared lock serialises rotations so the spawn-time rename and the
//! periodic copy-truncate never interleave.

use std::fs::{self, OpenOptions};
use std::path::Path;
use std::sync::Mutex;

static ROTATION_LOCK: Mutex<()> = Mutex::new(());

fn backup_path(path: &Path, index: u32) -> std::path::PathBuf {
    path.with_extension(format!("log.{index}"))
}

/// Shift `.log.1 → .log.2 → …`; the oldest copy falls off the end.
fn shift_backups(path: &Path, max_backups: u32) {
    for i in (1..max_backups).rev() {
        let _ = fs::rename(backup_path(path, i), backup_path(path, i + 1));
    }
}

fn over_limit(path: &Path, max_bytes: u64) -> bool {
    path.metadata().map(|m| m.len()).unwrap_or(0) >= max_bytes
}

/// Rename-based rotation. Returns true when the file was rotated.
pub fn rotate_by_rename(path: &Path, max_bytes: u64, max_backups: u32) -> bool {
    let _guard = ROTATION_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if !over_limit(path, max_bytes) {
        return false;
    }
    shift_backups(path, max_backups);
    fs::rename(path, backup_path(path, 1)).is_ok()
}

/// Copy-then-truncate rotation for a file held open in append mode by another
/// process. Returns true when the file was rotated.
pub fn rotate_by_copy_truncate(path: &Path, max_bytes: u64, max_backups: u32) -> bool {
    let _guard = ROTATION_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if !over_limit(path, max_bytes) {
        return false;
    }
    shift_backups(path, max_backups);
    let first = backup_path(path, 1);
    if fs::copy(path, &first).is_err() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&first, fs::Permissions::from_mode(0o600));
    }
    match OpenOptions::new().write(true).open(path) {
        Ok(file) => file.set_len(0).is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn temp_log(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("crystalball-logrot-{}-{name}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        for entry in fs::read_dir(&dir).unwrap() {
            let _ = fs::remove_file(entry.unwrap().path());
        }
        dir.join("local-api.log")
    }

    #[test]
    fn copy_truncate_keeps_the_writers_descriptor_working() {
        let path = temp_log("ct");
        // The "child": an append-mode handle opened before rotation.
        let mut child = OpenOptions::new().create(true).append(true).open(&path).unwrap();
        child.write_all(&[b'a'; 64]).unwrap();
        assert!(rotate_by_copy_truncate(&path, 32, 3));
        assert_eq!(fs::read(backup_path(&path, 1)).unwrap(), vec![b'a'; 64]);
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        // The child keeps writing through its old descriptor: the bytes land at
        // the start of the truncated file, not past a hole and not in .log.1.
        child.write_all(b"after").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"after");
        assert_eq!(fs::read(backup_path(&path, 1)).unwrap().len(), 64);
    }

    #[test]
    fn copy_truncate_shifts_backups_and_drops_the_oldest() {
        let path = temp_log("shift");
        for round in 0..4u8 {
            fs::write(&path, vec![b'0' + round; 40]).unwrap();
            assert!(rotate_by_copy_truncate(&path, 32, 3));
        }
        assert_eq!(fs::read(backup_path(&path, 1)).unwrap()[0], b'3');
        assert_eq!(fs::read(backup_path(&path, 2)).unwrap()[0], b'2');
        assert_eq!(fs::read(backup_path(&path, 3)).unwrap()[0], b'1');
        assert!(!backup_path(&path, 4).exists());
    }

    #[test]
    fn small_files_are_left_alone() {
        let path = temp_log("small");
        fs::write(&path, b"tiny").unwrap();
        assert!(!rotate_by_copy_truncate(&path, 32, 3));
        assert!(!rotate_by_rename(&path, 32, 3));
        assert_eq!(fs::read(&path).unwrap(), b"tiny");
        assert!(!backup_path(&path, 1).exists());
    }

    #[test]
    fn rename_rotation_moves_the_file() {
        let path = temp_log("rename");
        fs::write(&path, vec![b'x'; 40]).unwrap();
        assert!(rotate_by_rename(&path, 32, 3));
        assert!(!path.exists());
        assert_eq!(fs::read(backup_path(&path, 1)).unwrap().len(), 40);
    }

    #[cfg(unix)]
    #[test]
    fn copied_backup_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_log("mode");
        fs::write(&path, vec![b'y'; 40]).unwrap();
        assert!(rotate_by_copy_truncate(&path, 32, 3));
        let mode = fs::metadata(backup_path(&path, 1)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
