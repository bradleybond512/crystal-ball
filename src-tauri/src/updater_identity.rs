//! The existing updater is authorized for the full native identity only.
//! Read the embedded Tauri config, never a renderer or process environment flag.
pub fn full_channel_allowed(identifier: &str, product_name: Option<&str>) -> bool {
    identifier == "com.bradleybond.crystalball" && product_name == Some("Crystal Ball")
}
