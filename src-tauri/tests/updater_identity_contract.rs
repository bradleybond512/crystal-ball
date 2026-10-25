#[path = "../src/updater_identity.rs"]
mod updater_identity;

#[test]
fn only_the_unchanged_full_native_identity_can_use_the_full_update_channel() {
    assert!(updater_identity::full_channel_allowed(
        "com.bradleybond.crystalball", Some("Crystal Ball")
    ));
    for (identifier, name) in [
        ("com.bradleybond.crystalball.tech", Some("Tech Monitor")),
        ("com.bradleybond.crystalball.finance", Some("Finance Monitor")),
        ("com.bradleybond.crystalball", Some("Tech Monitor")),
        ("com.bradleybond.crystalball.tech", Some("Crystal Ball")),
        ("com.bradleybond.crystalball", None),
        ("", Some("Crystal Ball")),
        ("com.bradleybond.crystalball.evil", Some("Crystal Ball")),
    ] {
        assert!(!updater_identity::full_channel_allowed(identifier, name), "{identifier} / {name:?}");
    }
}
