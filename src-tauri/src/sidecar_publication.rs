//! Generation-owned port publication for the local API sidecar (R4-BUG-004).
//!
//! A port reaches the renderer and secret injection only while the child
//! that wrote it is the current child *and* still running. Each publisher
//! names the generation it belongs to. If that child has been replaced, has
//! exited or is being shut down, the publisher changes nothing.
//!
//! Lock order: `child` before `port`, always. Every function here that
//! touches both takes the child lock first and keeps it while it updates the
//! port, so a publication can never interleave with a revocation.
//!
//! No Tauri, clock or real process: `main.rs` passes its `LocalApiState`
//! fields and tests pass fakes.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// What publication needs from a child process.
pub trait SidecarChild {
    type Status;
    /// `Ok(None)` while running, `Ok(Some(status))` once it has exited
    /// (`std::process::Child::try_wait`).
    fn poll_exit(&mut self) -> std::io::Result<Option<Self::Status>>;
}

impl SidecarChild for std::process::Child {
    type Status = std::process::ExitStatus;
    fn poll_exit(&mut self) -> std::io::Result<Option<Self::Status>> {
        self.try_wait()
    }
}

/// Borrowed view of the shared sidecar state.
pub struct PortCell<'a, C> {
    pub child: &'a Mutex<Option<C>>,
    pub port: &'a Mutex<Option<u16>>,
    pub confirmed: &'a AtomicBool,
    pub generation: &'a AtomicU64,
    pub shutting_down: &'a AtomicBool,
}

/// Result of the starter's publication after its port-file wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Publication {
    /// The port is confirmed for this generation.
    Confirmed(u16),
    /// No port file in time: the default is recorded but stays unconfirmed.
    Unconfirmed(u16),
    /// This generation is no longer the live child: nothing changed.
    Stale,
}

/// Result of one monitor tick.
#[derive(Debug)]
pub enum Tick<S> {
    /// Still running; carries a port confirmed late on this tick.
    Running(Option<u16>),
    /// This generation exited: its slot is empty and its port revoked.
    Exited(S),
    /// The slot is empty or holds a newer generation: stop monitoring.
    Gone,
    Failed(std::io::Error),
}

impl<C: SidecarChild> PortCell<'_, C> {
    /// Store a freshly spawned child in `slot` (the caller holds the child
    /// lock and has cleared the port) and return its generation.
    pub fn install(&self, slot: &mut Option<C>, child: C) -> u64 {
        *slot = Some(child);
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// The starter's publication once its port-file wait ends (`waited` is
    /// `None` on timeout). The timeout fallback never clears a confirmation
    /// the monitor already made for the same child.
    pub fn publish_start(&self, generation: u64, waited: Option<u16>, default_port: u16) -> Publication {
        let Ok(mut slot) = self.child.lock() else { return Publication::Stale };
        if !self.owns_live(&mut slot, generation) {
            return Publication::Stale;
        }
        let Ok(mut port) = self.port.lock() else { return Publication::Stale };
        match (waited, *port) {
            (Some(confirmed), _) => {
                *port = Some(confirmed);
                self.confirmed.store(true, Ordering::SeqCst);
                Publication::Confirmed(confirmed)
            }
            (None, Some(current)) if self.confirmed.load(Ordering::SeqCst) => Publication::Confirmed(current),
            (None, _) => {
                *port = Some(default_port);
                self.confirmed.store(false, Ordering::SeqCst);
                Publication::Unconfirmed(default_port)
            }
        }
    }

    /// One monitor tick for `generation`: reap an exit and revoke its port,
    /// or, while it runs, confirm a port file that appeared after the boot
    /// wait. A replaced generation's monitor touches nothing.
    pub fn tick(&self, generation: u64, read_port: impl FnOnce() -> Option<u16>) -> Tick<C::Status> {
        let Ok(mut slot) = self.child.lock() else { return Tick::Gone };
        if self.generation.load(Ordering::SeqCst) != generation {
            return Tick::Gone;
        }
        let Some(child) = slot.as_mut() else { return Tick::Gone };
        match child.poll_exit() {
            Ok(Some(status)) => {
                *slot = None;
                self.revoke();
                Tick::Exited(status)
            }
            Ok(None) => {
                if self.confirmed.load(Ordering::SeqCst) || self.shutting_down.load(Ordering::SeqCst) {
                    return Tick::Running(None);
                }
                let Some(late) = read_port() else { return Tick::Running(None) };
                let Ok(mut port) = self.port.lock() else { return Tick::Running(None) };
                *port = Some(late);
                self.confirmed.store(true, Ordering::SeqCst);
                Tick::Running(Some(late))
            }
            Err(error) => Tick::Failed(error),
        }
    }

    /// Shutdown (after `shutting_down` is set): take the child for the caller
    /// to kill and revoke its port under one child lock.
    pub fn take_for_shutdown(&self) -> Option<C> {
        let Ok(mut slot) = self.child.lock() else { return None };
        let child = slot.take();
        self.revoke();
        child
    }

    /// The port a consumer (secret injection) may send to: confirmed, with
    /// the current child still running and no shutdown begun, read under the
    /// child lock so a revocation cannot interleave. Never a default.
    pub fn confirmed_live_port(&self) -> Option<u16> {
        let Ok(mut slot) = self.child.lock() else { return None };
        let generation = self.generation.load(Ordering::SeqCst);
        if !self.owns_live(&mut slot, generation) || !self.confirmed.load(Ordering::SeqCst) {
            return None;
        }
        self.port.lock().ok().and_then(|port| *port)
    }

    /// The caller holds the child lock.
    fn owns_live(&self, slot: &mut Option<C>, generation: u64) -> bool {
        if self.shutting_down.load(Ordering::SeqCst) || self.generation.load(Ordering::SeqCst) != generation {
            return false;
        }
        matches!(slot.as_mut().map(SidecarChild::poll_exit), Some(Ok(None)))
    }

    /// The caller holds the child lock.
    fn revoke(&self) {
        self.confirmed.store(false, Ordering::SeqCst);
        if let Ok(mut port) = self.port.lock() {
            *port = None;
        }
    }
}
