//! Native-only synchronization. No vault IO, listeners, or credential logging.
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub value: Option<String>,
    pub revision: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Accepted,
    CacheUnavailable,
    TargetUnavailable,
    Exhausted,
}

#[derive(Default)]
pub struct RevisionClock {
    counter: AtomicU64,
    #[cfg(test)]
    reservation_probe: Option<Box<dyn Fn() + Send + Sync>>,
}
impl RevisionClock {
    // Call only while owning the cache mutex, so revision order is value order.
    fn reserve(&self) -> Result<String, ()> {
        #[cfg(test)]
        if let Some(probe) = &self.reservation_probe { probe(); }
        self.counter
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_add(1))
            .map(|n| (n + 1).to_string())
            .map_err(|_| ())
    }
    #[cfg(test)]
    pub fn snapshot(
        &self,
        cache: &Mutex<HashMap<String, String>>,
        key: &str,
    ) -> Result<Snapshot, ()> {
        let map = cache.lock().map_err(|_| ())?;
        self.snapshot_owned_map(&map, key)
    }
    #[cfg(test)]
    pub fn launch(
        &self,
        cache: &Mutex<HashMap<String, String>>,
    ) -> Result<(HashMap<String, String>, String), ()> {
        let map = cache.lock().map_err(|_| ())?;
        self.launch_owned_map(&map)
    }
    /// Caller must own the authoritative map lock for the entire allocation.
    pub(crate) fn snapshot_owned_map(&self, map: &HashMap<String, String>, key: &str) -> Result<Snapshot, ()> {
        let value = map.get(key).cloned();
        let revision = self.reserve()?;
        Ok(Snapshot { value, revision })
    }
    /// Caller must own the authoritative map lock while copying and reserving.
    pub(crate) fn launch_owned_map(&self, map: &HashMap<String, String>) -> Result<(HashMap<String, String>, String), ()> {
        let values = map.clone();
        let floor = self.reserve()?;
        Ok((values, floor))
    }
    #[cfg(test)]
    pub(crate) fn exhausted_for_test() -> Self { Self { counter: AtomicU64::new(u64::MAX), reservation_probe: None } }
    #[cfg(test)]
    pub(crate) fn with_reservation_probe_for_test(probe: impl Fn() + Send + Sync + 'static) -> Self {
        Self { counter: AtomicU64::new(0), reservation_probe: Some(Box::new(probe)) }
    }

}

pub fn changed_keys(
    launch: &HashMap<String, String>,
    current: &HashMap<String, String>,
) -> Vec<String> {
    launch
        .keys()
        .chain(current.keys())
        .collect::<HashSet<_>>()
        .into_iter()
        .filter(|key| launch.get(*key) != current.get(*key))
        .cloned()
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushAdmission { Accepted, Full, Stopped }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconcileAdmission { Idle, Accepted, Full, Stopped, StoppedPreviouslyReported }

/// Check launch ownership before and after resolving the live target each attempt.
pub fn target_for_generation<T>(expected: Option<u64>, owner: impl Fn() -> u64, target: impl FnOnce() -> Result<T, ()>) -> Result<T, ()> {
    if expected.is_some_and(|generation| owner() != generation) { return Err(()); }
    let destination = target()?;
    if expected.is_some_and(|generation| owner() != generation) { return Err(()); }
    Ok(destination)
}

/// Temporary native-only launch state, consumed once by normal or late publication.
#[derive(Default)]
pub struct LaunchReconciliation(Mutex<Option<PendingLaunch>>);
struct PendingLaunch { generation: u64, map: HashMap<String, String>, stopped_reported: bool }
impl LaunchReconciliation {
    pub fn install(&self, generation: u64, launch: HashMap<String, String>) -> Result<(), ()> {
        *self.0.lock().map_err(|_| ())? = Some(PendingLaunch { generation, map: launch, stopped_reported: false });
        Ok(())
    }
    pub fn try_enqueue_changed(
        &self,
        generation: u64,
        current: impl FnOnce() -> Result<HashMap<String, String>, ()>,
        enqueue: impl FnOnce(Vec<String>) -> PushAdmission,
    ) -> Result<ReconcileAdmission, ()> {
        let mut pending = self.0.lock().map_err(|_| ())?;
        let Some(launch) = pending.as_ref() else { return Ok(ReconcileAdmission::Idle); };
        if launch.generation != generation { return Ok(ReconcileAdmission::Idle); }
        let mut keys = changed_keys(&launch.map, &current()?);
        keys.sort();
        keys.dedup();
        let admission = if keys.is_empty() { PushAdmission::Accepted } else { enqueue(keys) };
        Ok(match admission {
            PushAdmission::Accepted => { pending.take(); ReconcileAdmission::Accepted }
            PushAdmission::Full => ReconcileAdmission::Full,
            PushAdmission::Stopped => {
                let launch = pending.as_mut().ok_or(())?;
                if launch.stopped_reported { ReconcileAdmission::StoppedPreviouslyReported }
                else { launch.stopped_reported = true; ReconcileAdmission::Stopped }
            },
        })
    }
    #[cfg(test)]
    pub fn take_changed(
        &self,
        generation: u64,
        cache: &Mutex<HashMap<String, String>>,
    ) -> Result<Option<Vec<String>>, ()> {
        let mut pending = self.0.lock().map_err(|_| ())?;
        let Some(launch) = pending.as_ref() else {
            return Ok(None);
        };
        if launch.generation != generation {
            return Ok(None);
        }
        let current = cache.lock().map_err(|_| ())?;
        let keys = changed_keys(&launch.map, &current);
        pending.take();
        Ok(Some(keys))
    }
}

/// One controller used by every native producer. Closures own no lock across await.
pub async fn send<S, T, P, D, PF, DF, Target>(
    mut snapshot: S,
    mut target: T,
    mut post: P,
    mut delay: D,
) -> Outcome
where
    S: FnMut() -> Result<Snapshot, ()>,
    T: FnMut() -> Result<Target, ()>,
    P: FnMut(Target, Snapshot) -> PF,
    D: FnMut() -> DF,
    PF: Future<Output = bool>,
    DF: Future<Output = ()>,
{
    for attempt in 0..3 {
        let state = match snapshot() {
            Ok(s) => s,
            Err(_) => return Outcome::CacheUnavailable,
        };
        let destination = match target() {
            Ok(t) => t,
            Err(_) => return Outcome::TargetUnavailable,
        };
        if post(destination, state).await {
            return Outcome::Accepted;
        }
        if attempt < 2 {
            delay().await;
        }
    }
    Outcome::Exhausted
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    fn run<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn retry_uses_current_delete_and_rotation() {
        for next in [None, Some("new")] {
            let cache = Mutex::new(HashMap::from([("A".into(), "old".into())]));
            let clock = RevisionClock::default();
            let mut sent = Vec::new();
            let outcome = run(send(
                || clock.snapshot(&cache, "A"),
                || Ok(7u16),
                |_, state| {
                    sent.push(state);
                    std::future::ready(sent.len() > 1)
                },
                || {
                    let mut map = cache.lock().unwrap();
                    map.remove("A");
                    if let Some(value) = next {
                        map.insert("A".into(), value.into());
                    }
                    std::future::ready(())
                },
            ));
            assert_eq!(outcome, Outcome::Accepted);
            assert_eq!(sent[1].value.as_deref(), next);
            assert!(sent[1].revision.parse::<u64>().unwrap() > sent[0].revision.parse().unwrap());
        }
    }
    #[test]
    fn revoked_target_stops_retry_without_default_fallback() {
        let clock = RevisionClock::default();
        let cache = Mutex::new(HashMap::new());
        let live = std::cell::Cell::new(true);
        let mut requests = 0;
        let outcome = run(send(
            || clock.snapshot(&cache, "A"),
            || if live.get() { Ok(27) } else { Err(()) },
            |_, _| {
                requests += 1;
                std::future::ready(false)
            },
            || {
                live.set(false);
                std::future::ready(())
            },
        ));
        assert_eq!(outcome, Outcome::TargetUnavailable);
        assert_eq!(requests, 1);
    }
    #[test]
    fn poisoned_cache_is_not_an_unset() {
        let cache = Arc::new(Mutex::new(HashMap::new()));
        let c = cache.clone();
        let _ = std::thread::spawn(move || {
            let _guard = c.lock().unwrap();
            panic!("test poison");
        })
        .join();
        let clock = RevisionClock::default();
        let mut requests = 0;
        let outcome = run(send(
            || clock.snapshot(&cache, "A"),
            || Ok(7),
            |_, _| {
                requests += 1;
                std::future::ready(true)
            },
            || std::future::ready(()),
        ));
        assert_eq!(outcome, Outcome::CacheUnavailable);
        assert_eq!(requests, 0);
        let missing = Mutex::new(HashMap::new());
        assert_eq!(clock.snapshot(&missing, "A").unwrap().value, None);
    }
    #[test]
    fn snapshot_and_launch_revision_order_follows_cache_ownership() {
        let cache: Arc<Mutex<HashMap<String, String>>> =
            Arc::new(Mutex::new(HashMap::from([("A".into(), "old".into())])));
        let clock = Arc::new(RevisionClock::default());
        let mut guard = cache.lock().unwrap();
        let (tx, rx) = mpsc::channel();
        let c = cache.clone();
        let r = clock.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            let s = r.snapshot(&c, "A");
            tx.send(s).unwrap();
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        // A cache owner reserves a newer launch floor while the reader waits.
        // Allocating outside ownership would give the waiting read an older
        // revision for the new value and be rejected by that listener floor.
        let owned_floor = clock.reserve().unwrap();
        guard.insert("A".into(), "new".into());
        drop(guard);
        let snapshot = rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
        worker.join().unwrap();
        assert!(snapshot.revision.parse::<u64>().unwrap() > owned_floor.parse().unwrap());
        assert_eq!(snapshot.value.as_deref(), Some("new"));
        let (launch, floor) = clock.launch(&cache).unwrap();
        assert_eq!(launch.get("A").map(String::as_str), Some("new"));
        assert!(floor.parse::<u64>().unwrap() > snapshot.revision.parse().unwrap());
        assert!(
            clock
                .snapshot(&cache, "A")
                .unwrap()
                .revision
                .parse::<u64>()
                .unwrap()
                > floor.parse().unwrap()
        );

        // Exercise launch itself under contention, not only snapshot(). Guards
        // release on assertion unwind; all channel waits have bounded deadlines.
        let mut guard = cache.lock().unwrap();
        let (launch_tx, launch_rx) = mpsc::channel();
        let (launch_started_tx, launch_started_rx) = mpsc::channel();
        let c = cache.clone();
        let r = clock.clone();
        let launch_worker = std::thread::spawn(move || {
            launch_started_tx.send(()).unwrap();
            let launch = r.launch(&c);
            let _ = launch_tx.send(launch);
        });
        launch_started_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        assert!(launch_rx.recv_timeout(Duration::from_millis(30)).is_err());
        let holder_revision = clock.reserve().unwrap();
        guard.remove("A");
        guard.insert("B".into(), "rotated".into());
        drop(guard);
        let (latest_launch, latest_floor) = launch_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        launch_worker.join().unwrap();
        assert!(
            !latest_launch.contains_key("A"),
            "launch includes current deletion"
        );
        assert_eq!(latest_launch.get("B").map(String::as_str), Some("rotated"));
        assert!(
            latest_floor.parse::<u64>().unwrap() > holder_revision.parse().unwrap(),
            "launch floor must follow revision reserved by current cache owner"
        );
    }
    #[test]
    fn launch_delta_includes_deletes_and_new_keys_without_inherited_absent_keys() {
        let launch = HashMap::from([
            ("deleted".into(), "v".into()),
            ("same".into(), "v".into()),
            ("rotate".into(), "v".into()),
        ]);
        let current = HashMap::from([
            ("same".into(), "v".into()),
            ("rotate".into(), "new".into()),
            ("new".into(), "v".into()),
        ]);
        let mut keys = changed_keys(&launch, &current);
        keys.sort();
        assert_eq!(keys, ["deleted", "new", "rotate"]);
    }
    // A minimal ordered sink, not another sender: only transport calls touch it.
    #[derive(Default)]
    struct Sink {
        revisions: HashMap<String, u64>,
        values: HashMap<String, String>,
    }
    impl Sink {
        fn apply(&mut self, key: &str, state: &Snapshot) {
            let revision: u64 = state.revision.parse().unwrap();
            if revision <= *self.revisions.get(key).unwrap_or(&0) {
                return;
            }
            self.revisions.insert(key.into(), revision);
            if let Some(value) = &state.value {
                self.values.insert(key.into(), value.clone());
            } else {
                self.values.remove(key);
            }
        }
    }
    struct Release(Option<mpsc::Sender<()>>);
    impl Release {
        fn release(&mut self) {
            if let Some(tx) = self.0.take() {
                let _ = tx.send(());
            }
        }
    }
    impl Drop for Release {
        fn drop(&mut self) {
            self.release();
        }
    }

    #[test]
    fn settings_boot_reload_recovery_paused_senders_retry_current_delete_or_rotation() {
        for producer in ["settings", "boot", "reload", "recovery"] {
            for next in [None, Some("rotated")] {
                let cache: Arc<Mutex<HashMap<String, String>>> =
                    Arc::new(Mutex::new(HashMap::from([("A".into(), "old".into())])));
                let clock = Arc::new(RevisionClock::default());
                let sink = Arc::new(Mutex::new(Sink::default()));
                let (entered_tx, entered_rx) = mpsc::channel();
                let (release_tx, release_rx) = mpsc::channel();
                let mut release = Release(Some(release_tx));
                let (done_tx, done_rx) = mpsc::channel();
                // Boot/reload/recovery select keys before the later Settings edit.
                // Their snapshot values are deliberately irrelevant to the sender.
                let selected_key = if producer == "settings" {
                    "A".to_string()
                } else {
                    cache.lock().unwrap().keys().next().unwrap().clone()
                };
                let c = cache.clone();
                let r = clock.clone();
                let target = sink.clone();
                let worker = std::thread::spawn(move || {
                    let mut count = 0;
                    let outcome = run(send(
                        || r.snapshot(&c, &selected_key),
                        || Ok(()),
                        |_, state| {
                            count += 1;
                            if count == 1 {
                                entered_tx.send(()).unwrap();
                                release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                                target.lock().unwrap().apply("A", &state);
                                std::future::ready(false) // old request timed out at native
                            } else {
                                target.lock().unwrap().apply("A", &state);
                                assert_eq!(state.value.as_deref(), next);
                                std::future::ready(true)
                            }
                        },
                        || std::future::ready(()),
                    ));
                    let _ = done_tx.send(outcome);
                });
                entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                {
                    let mut values = cache.lock().unwrap();
                    values.remove("A");
                    if let Some(value) = next {
                        values.insert("A".into(), value.into());
                    }
                }
                assert_eq!(
                    run(send(
                        || clock.snapshot(&cache, "A"),
                        || Ok(()),
                        |_, state| {
                            sink.lock().unwrap().apply("A", &state);
                            std::future::ready(true)
                        },
                        || std::future::ready(())
                    )),
                    Outcome::Accepted
                );
                // Another key gets its own update while the old A request is pending.
                cache
                    .lock()
                    .unwrap()
                    .insert("B".into(), "independent".into());
                run(send(
                    || clock.snapshot(&cache, "B"),
                    || Ok(()),
                    |_, state| {
                        sink.lock().unwrap().apply("B", &state);
                        std::future::ready(true)
                    },
                    || std::future::ready(()),
                ));
                release.release();
                assert_eq!(
                    done_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
                    Outcome::Accepted
                );
                worker.join().unwrap();
                let result = sink.lock().unwrap();
                assert_eq!(result.values.get("A").map(String::as_str), next);
                assert_eq!(
                    result.values.get("B").map(String::as_str),
                    Some("independent")
                );
            }
        }
    }

    #[test]
    fn boot_reload_and_recovery_key_snapshots_overlap_settings_edits() {
        for producer in ["boot", "reload", "recovery"] {
            for value in [None, Some("rotated")] {
                let cache = Mutex::new(HashMap::from([("A".into(), "old".into())]));
                let keys: Vec<_> = cache.lock().unwrap().keys().cloned().collect();
                {
                    let mut map = cache.lock().unwrap();
                    map.remove("A");
                    if let Some(v) = value {
                        map.insert("A".into(), v.into());
                    }
                }
                let clock = RevisionClock::default();
                let mut sent = Vec::new();
                for key in keys {
                    assert_eq!(
                        run(send(
                            || clock.snapshot(&cache, &key),
                            || Ok(()),
                            |_, snapshot| {
                                sent.push(snapshot);
                                std::future::ready(true)
                            },
                            || std::future::ready(())
                        )),
                        Outcome::Accepted,
                        "{producer}"
                    );
                }
                assert_eq!(sent[0].value.as_deref(), value, "{producer}");
            }
        }
    }

    #[test]
    fn normal_and_late_publication_reconcile_launch_delete_once_for_owner() {
        for publication in ["normal", "late"] {
            let cache = Mutex::new(HashMap::from([("A".into(), "launch".into())]));
            let clock = RevisionClock::default();
            let pending = LaunchReconciliation::default();
            let (launch, floor) = clock.launch(&cache).unwrap();
            pending.install(7, launch).unwrap();
            cache.lock().unwrap().remove("A");
            assert_eq!(
                pending.take_changed(6, &cache),
                Ok(None),
                "wrong generation"
            );
            let keys = pending.take_changed(7, &cache).unwrap().unwrap();
            assert_eq!(keys, ["A"], "{publication}");
            let mut delivered = Vec::new();
            for key in keys {
                assert_eq!(
                    run(send(
                        || clock.snapshot(&cache, &key),
                        || Ok(()),
                        |_, state| {
                            delivered.push(state);
                            std::future::ready(true)
                        },
                        || std::future::ready(())
                    )),
                    Outcome::Accepted
                );
            }
            assert_eq!(delivered[0].value, None);
            assert!(delivered[0].revision.parse::<u64>().unwrap() > floor.parse().unwrap());
            assert_eq!(pending.take_changed(7, &cache), Ok(None), "scheduled once");
        }
    }

    #[test]
    fn native_clock_survives_listener_restarts_and_exhaustion_fails_closed() {
        let cache = Mutex::new(HashMap::new());
        let clock = RevisionClock::default();
        let first = clock.snapshot(&cache, "A").unwrap();
        let (_, floor) = clock.launch(&cache).unwrap();
        let (_, next_floor) = clock.launch(&cache).unwrap();
        assert!(floor.parse::<u64>().unwrap() > first.revision.parse().unwrap());
        assert!(next_floor.parse::<u64>().unwrap() > floor.parse().unwrap());
        let exhausted = RevisionClock::exhausted_for_test();
        let mut calls = 0;
        assert_eq!(
            run(send(
                || exhausted.snapshot(&cache, "A"),
                || Ok(()),
                |_, _| {
                    calls += 1;
                    std::future::ready(true)
                },
                || std::future::ready(())
            )),
            Outcome::CacheUnavailable
        );
        assert_eq!(calls, 0);
    }
    #[test]
    fn retry_budget_and_delay_are_bounded_and_cache_locks_are_released() {
        let clock = RevisionClock::default();
        let cache = Mutex::new(HashMap::new());
        let mut targets = 0;
        let mut requests = 0;
        let mut delays = 0;
        assert_eq!(
            run(send(
                || clock.snapshot(&cache, "A"),
                || {
                    targets += 1;
                    assert!(cache.try_lock().is_ok());
                    Ok(27)
                },
                |port, state| {
                    assert_eq!(port, 27);
                    assert_eq!(state.value, None);
                    assert!(cache.try_lock().is_ok());
                    requests += 1;
                    std::future::ready(false)
                },
                || {
                    assert!(cache.try_lock().is_ok());
                    delays += 1;
                    std::future::ready(())
                }
            )),
            Outcome::Exhausted
        );
        assert_eq!((targets, requests, delays), (3, 3, 2));
    }
}
