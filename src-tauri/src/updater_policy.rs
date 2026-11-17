use serde::{Deserialize, Serialize};

pub const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/bradleybond512/crystal-ball/releases/latest";
#[cfg(any(target_os = "macos", test))]
pub const BUNDLE_ID: &str = "com.bradleybond.crystalball";
pub const MAX_JSON_BYTES: u64 = 1024 * 1024;
#[cfg(any(target_os = "macos", test))]
pub const MAX_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;
const RELEASE_BASE: &str = "https://github.com/bradleybond512/crystal-ball/releases";

pub fn require_full_channel(identifier: &str, product_name: Option<&str>) -> Result<(), UpdateError> {
    if crate::updater_identity::full_channel_allowed(identifier, product_name) {
        Ok(())
    } else {
        Err(UpdateError {
            code: "variant_updates_unavailable",
            message: "Automatic updates are not available for this variant yet.",
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum UpdateOutcome {
    UpToDate {
        current_version: String,
        checked_at: u64,
    },
    #[cfg(any(target_os = "macos", test))]
    Ready {
        version: String,
        checked_at: u64,
    },
    BrowserDownload {
        version: String,
        download_url: String,
        reason: BrowserReason,
        checked_at: u64,
    },
}
impl UpdateOutcome {
    pub fn browser(version: &str, reason: BrowserReason, checked_at: u64) -> Self {
        Self::BrowserDownload {
            version: version.into(),
            download_url: format!("{RELEASE_BASE}/tag/v{version}"),
            reason,
            checked_at,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserReason {
    #[cfg(any(not(target_os = "macos"), test))]
    UnsupportedPlatform,
    #[cfg(any(target_os = "macos", test))]
    UnsupportedArchitecture,
    #[cfg(any(target_os = "macos", test))]
    NoSignerPin,
    #[cfg(any(target_os = "macos", test))]
    MissingManifest,
    #[cfg(any(target_os = "macos", test))]
    InvalidRelease,
    #[cfg(any(target_os = "macos", test))]
    SignerMismatch,
}
#[derive(Debug, Serialize)]
pub struct UpdateError {
    pub code: &'static str,
    pub message: &'static str,
}
impl UpdateError {
    pub fn check() -> Self {
        Self {
            code: "check_failed",
            message: "Could not verify the latest release. Please try again.",
        }
    }
    #[cfg(any(target_os = "macos", test))]
    pub fn stage() -> Self {
        Self {
            code: "stage_failed",
            message: "The update could not be safely staged. Please try again.",
        }
    }
}
#[derive(Debug, Deserialize)]
pub struct Release {
    pub tag_name: String,
    pub draft: bool,
    pub prerelease: bool,
    #[cfg(target_os = "macos")]
    pub assets: Vec<ReleaseAsset>,
    #[cfg(not(target_os = "macos"))]
    #[serde(rename = "assets")]
    _assets: Vec<ReleaseAsset>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseAsset {
    #[cfg(target_os = "macos")]
    pub name: String,
    #[cfg(not(target_os = "macos"))]
    #[serde(rename = "name")]
    _name: String,
    #[cfg(target_os = "macos")]
    pub size: u64,
    #[cfg(not(target_os = "macos"))]
    #[serde(rename = "size")]
    _size: u64,
    #[cfg(target_os = "macos")]
    pub browser_download_url: String,
    #[cfg(not(target_os = "macos"))]
    #[serde(rename = "browser_download_url")]
    _browser_download_url: String,
}
#[cfg(any(target_os = "macos", test))]
impl Release {
    fn assets(&self) -> &[ReleaseAsset] {
        #[cfg(target_os = "macos")]
        { &self.assets }
        #[cfg(not(target_os = "macos"))]
        { &self._assets }
    }
    #[cfg(test)]
    fn assets_mut(&mut self) -> &mut Vec<ReleaseAsset> {
        #[cfg(target_os = "macos")]
        { &mut self.assets }
        #[cfg(not(target_os = "macos"))]
        { &mut self._assets }
    }
}
#[cfg(any(target_os = "macos", test))]
impl ReleaseAsset {
    fn fields(&self) -> (&str, u64, &str) {
        #[cfg(target_os = "macos")]
        { (&self.name, self.size, &self.browser_download_url) }
        #[cfg(not(target_os = "macos"))]
        { (&self._name, self._size, &self._browser_download_url) }
    }
    #[cfg(test)]
    fn fields_mut(&mut self) -> (&mut String, &mut u64, &mut String) {
        #[cfg(target_os = "macos")]
        { (&mut self.name, &mut self.size, &mut self.browser_download_url) }
        #[cfg(not(target_os = "macos"))]
        { (&mut self._name, &mut self._size, &mut self._browser_download_url) }
    }
}
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub version: String,
    pub tag: String,
    pub variant: String,
    pub assets: Vec<ManifestAsset>,
}
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Deserialize)]
pub struct ManifestAsset {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}
#[cfg(any(target_os = "macos", test))]
#[derive(Debug)]
pub struct SelectedAssets {
    pub version: String,
    pub tag: String,
    pub asset: ReleaseAsset,
    pub manifest: ReleaseAsset,
}

pub fn version(raw: &str) -> Result<[u32; 3], ()> {
    let parts: Vec<_> = raw.split('.').collect();
    if parts.len() != 3 {
        return Err(());
    }
    let mut out = [0; 3];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|c| c.is_ascii_digit())
        {
            return Err(());
        }
        out[i] = part.parse().map_err(|_| ())?;
    }
    Ok(out)
}
pub fn is_newer(candidate: &str, current: &str) -> bool {
    matches!((version(candidate), version(current)), (Ok(a), Ok(b)) if a > b)
}
pub fn release_version(release: &Release) -> Result<String, ()> {
    if release.draft || release.prerelease {
        return Err(());
    }
    let raw = release.tag_name.strip_prefix('v').ok_or(())?;
    version(raw)?;
    Ok(raw.to_string())
}
#[cfg(any(target_os = "macos", test))]
pub fn asset_url(tag: &str, name: &str) -> String {
    format!("{RELEASE_BASE}/download/{tag}/{name}")
}

#[cfg(any(target_os = "macos", test))]
pub fn validate_initial_url(raw: &str, expected: &str) -> Result<(), ()> {
    if raw != expected
        || raw.bytes().any(|b| b <= 32 || b >= 127)
        || raw.contains(['%', '\\', '?', '#'])
    {
        return Err(());
    }
    let tail = raw
        .strip_prefix(&format!("{RELEASE_BASE}/download/"))
        .ok_or(())?;
    let (tag, name) = tail.split_once('/').ok_or(())?;
    let v = tag.strip_prefix('v').ok_or(())?;
    version(v)?;
    if name != "release-manifest.json"
        && name != format!("Crystal.Ball_{v}_aarch64.dmg")
        && name != format!("Crystal.Ball_{v}_x64.dmg")
    {
        return Err(());
    }
    Ok(())
}
#[cfg(any(target_os = "macos", test))]
pub fn validate_redirect(raw: &str, initial: &str, hops: usize) -> Result<(), ()> {
    if hops > 3 || raw.bytes().any(|b| b <= 32 || b >= 127) || raw.contains('\\') {
        return Err(());
    }
    if raw.starts_with("https://github.com/") {
        return validate_initial_url(raw, initial);
    }
    let parsed = reqwest::Url::parse(raw).map_err(|_| ())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("release-assets.githubusercontent.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.fragment().is_some()
    {
        return Err(());
    }
    let raw_path = raw
        .strip_prefix("https://release-assets.githubusercontent.com/")
        .ok_or(())?
        .split('?')
        .next()
        .ok_or(())?;
    if !raw_path.starts_with("github-production-release-asset/1171076424/")
        || raw_path.contains('%')
        || raw_path
            .split('/')
            .any(|p| p == "." || p == ".." || p.is_empty())
    {
        return Err(());
    }
    Ok(())
}
#[cfg(any(target_os = "macos", test))]
pub fn select_assets(release: &Release, arch: &str) -> Result<SelectedAssets, BrowserReason> {
    let version = release_version(release).map_err(|_| BrowserReason::InvalidRelease)?;
    let arch = match arch {
        "aarch64" => "aarch64",
        "x86_64" => "x64",
        _ => return Err(BrowserReason::UnsupportedArchitecture),
    };
    let name = format!("Crystal.Ball_{version}_{arch}.dmg");
    let unique = |name: &str| -> Result<ReleaseAsset, BrowserReason> {
        let mut matches = release.assets().iter().filter(|a| a.fields().0 == name);
        let asset = matches.next().ok_or(if name == "release-manifest.json" {
            BrowserReason::MissingManifest
        } else {
            BrowserReason::InvalidRelease
        })?;
        let (_, size, download_url) = asset.fields();
        if matches.next().is_some()
            || size == 0
            || size
                > if name == "release-manifest.json" {
                    MAX_JSON_BYTES
                } else {
                    MAX_ARTIFACT_BYTES
                }
            || validate_initial_url(
                download_url,
                &asset_url(&release.tag_name, name),
            )
            .is_err()
        {
            return Err(BrowserReason::InvalidRelease);
        }
        Ok(asset.clone())
    };
    Ok(SelectedAssets {
        version,
        tag: release.tag_name.clone(),
        asset: unique(&name)?,
        manifest: unique("release-manifest.json")?,
    })
}
#[cfg(any(target_os = "macos", test))]
pub fn validate_manifest(manifest: &Manifest, selected: &SelectedAssets) -> Result<String, ()> {
    if manifest.version != selected.version
        || manifest.tag != selected.tag
        || manifest.variant != "full"
    {
        return Err(());
    }
    let normalized = |name: &str| -> String {
        match name.strip_prefix("Crystal Ball_") {
            Some(tail) => format!("Crystal.Ball_{tail}"),
            None => name.into(),
        }
    };
    let mut matching = manifest
        .assets
        .iter()
        .filter(|a| normalized(&a.name) == selected.asset.fields().0);
    let asset = matching.next().ok_or(())?;
    if matching.next().is_some()
        || asset.size != selected.asset.fields().1
        || asset.sha256.len() != 64
        || !asset.sha256.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(());
    }
    Ok(asset.sha256.to_ascii_lowercase())
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone)]
pub struct SignerRequirement(String);
#[cfg(any(target_os = "macos", test))]
impl SignerRequirement {
    pub fn as_str(&self) -> &str {
        &self.0
    }
    fn apple(team: &str) -> Result<Self, ()> {
        if team.len() != 10
            || !team
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        {
            return Err(());
        }
        Ok(Self(format!("anchor apple generic and identifier \"{BUNDLE_ID}\" and certificate leaf[subject.OU] = \"{team}\"")))
    }
    fn local(display: &str) -> Result<Self, ()> {
        let mut lines = display
            .lines()
            .filter_map(|line| line.strip_prefix("designated => "));
        let requirement = lines.next().ok_or(())?;
        if lines.next().is_some() {
            return Err(());
        }
        let clauses: Vec<_> = requirement.split(" and ").collect();
        if clauses.len() != 2 {
            return Err(());
        }
        let identifier = format!("identifier \"{BUNDLE_ID}\"");
        let certificate = if clauses[0] == identifier {
            clauses[1]
        } else if clauses[1] == identifier {
            clauses[0]
        } else {
            return Err(());
        };
        let fingerprint = if let Some(hash) = certificate.strip_prefix("anchor H\"") {
            hash
        } else {
            let (slot, hash) = certificate
                .strip_prefix("certificate ")
                .ok_or(())?
                .split_once(" = H\"")
                .ok_or(())?;
            if slot != "leaf" && slot != "root" && slot != "0" && slot != "1" {
                return Err(());
            }
            hash
        };
        let hash = fingerprint.strip_suffix('"').ok_or(())?;
        if hash.len() != 40 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(());
        }
        Ok(Self(requirement.into()))
    }
}
#[cfg(any(target_os = "macos", test))]
pub fn choose_signer(
    intact: bool,
    apple_anchor: bool,
    team: Option<&str>,
    designated: Option<&str>,
    satisfies: impl FnOnce(&str) -> bool,
) -> Result<SignerRequirement, ()> {
    if !intact {
        return Err(());
    }
    let pin = if apple_anchor {
        SignerRequirement::apple(team.ok_or(())?)?
    } else {
        SignerRequirement::local(designated.ok_or(())?)?
    };
    if !satisfies(pin.as_str()) {
        return Err(());
    }
    Ok(pin)
}
#[cfg(any(target_os = "macos", test))]
pub fn check_candidate(
    candidate: &str,
    current: &str,
    expected: Option<&str>,
    pin: &SignerRequirement,
    satisfies: impl FnOnce(&str) -> bool,
) -> Result<(), String> {
    if !is_newer(candidate, current) || expected.is_some_and(|v| candidate != v) {
        return Err("Update version is not the expected newer version".into());
    }
    if !satisfies(pin.as_str()) {
        return Err("Update does not satisfy the installed signer pin".into());
    }
    Ok(())
}
#[cfg(any(target_os = "macos", test))]
pub fn published_version(candidate: &str, verified_existing: Result<String, String>) -> String {
    match verified_existing {
        Ok(existing) if is_newer(&existing, candidate) => existing,
        _ => candidate.into(),
    }
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug)]
pub struct VerifiedDownload(Vec<u8>);
#[cfg(any(target_os = "macos", test))]
impl VerifiedDownload {
    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }
}
#[cfg(any(target_os = "macos", test))]
pub fn verify_download(
    bytes: Vec<u8>,
    expected_sha256: &str,
    expected_size: u64,
) -> Result<VerifiedDownload, UpdateError> {
    use sha2::{Digest, Sha256};
    if expected_size == 0
        || expected_size > MAX_ARTIFACT_BYTES
        || bytes.len() as u64 != expected_size
        || expected_sha256.len() != 64
        || !expected_sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(UpdateError::stage());
    }
    let actual = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    if actual != expected_sha256.to_ascii_lowercase() {
        return Err(UpdateError {
            code: "checksum_mismatch",
            message: "The update download failed verification.",
        });
    }
    Ok(VerifiedDownload(bytes))
}
pub fn check_body_length(
    received: u64,
    limit: u64,
    expected: Option<u64>,
    complete: bool,
) -> Result<(), UpdateError> {
    if received > limit || expected.is_some_and(|n| received > n || (complete && received != n)) {
        return Err(UpdateError::check());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn release_asset_wire_shape_is_required_on_every_platform() {
        let valid = json!({"tag_name":"v1.2.3","draft":false,"prerelease":false,"assets":[{"name":"fixture.dmg","size":0,"browser_download_url":"https://example.invalid/fixture"}]});
        let parsed: Release = serde_json::from_value(valid.clone()).unwrap();
        assert_eq!(parsed.assets()[0].fields().1, 0, "zero remains a valid wire integer before asset policy");
        for (field, wrong) in [("tag_name", json!(0)), ("draft", json!("false")), ("prerelease", json!(0)), ("assets", json!({}))] {
            let mut missing = valid.clone(); missing.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<Release>(missing).is_err(), "missing {field}");
            for value in [serde_json::Value::Null, wrong] {
                let mut malformed = valid.clone(); malformed[field] = value;
                assert!(serde_json::from_value::<Release>(malformed).is_err(), "invalid {field}");
            }
        }
        for (field, wrong) in [("name", json!(0)), ("size", json!("0")), ("browser_download_url", json!(false))] {
            let mut missing = valid.clone(); missing["assets"][0].as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<Release>(missing).is_err(), "missing asset {field}");
            for value in [serde_json::Value::Null, wrong] {
                let mut malformed = valid.clone(); malformed["assets"][0][field] = value;
                assert!(serde_json::from_value::<Release>(malformed).is_err(), "invalid asset {field}");
            }
        }
        for asset in [serde_json::Value::Null, json!(0), json!("not an asset")] {
            let mut malformed = valid.clone(); malformed["assets"] = json!([asset]);
            assert!(serde_json::from_value::<Release>(malformed).is_err());
        }
        let raw = serde_json::to_string(&valid).unwrap();
        for field in ["tag_name", "draft", "prerelease", "assets", "name", "size", "browser_download_url"] {
            let value = valid.get(field).unwrap_or(&valid["assets"][0][field]);
            let marker = format!("\"{field}\":");
            let duplicate = raw.replacen(&marker, &format!("{marker}{value},{marker}"), 1);
            assert!(serde_json::from_str::<Release>(&duplicate).is_err(), "duplicate {field}");
        }
        for size in ["-1", "0.5", "18446744073709551616"] {
            assert!(serde_json::from_str::<Release>(&raw.replace("\"size\":0", &format!("\"size\":{size}"))).is_err());
        }
        let maximum = raw.replace("\"size\":0", "\"size\":18446744073709551615");
        assert_eq!(serde_json::from_str::<Release>(&maximum).unwrap().assets()[0].fields().1, u64::MAX);
        let mut extended = valid;
        extended["unknown"] = json!({"any":"shape"});
        extended["assets"][0]["unknown"] = json!([1, null]);
        assert!(serde_json::from_value::<Release>(extended).is_ok());
    }

    #[test]
    fn outcome_and_reason_serialization_preserves_wire_values() {
        for (reason, wire) in [(BrowserReason::UnsupportedPlatform, "unsupported_platform"), (BrowserReason::UnsupportedArchitecture, "unsupported_architecture"), (BrowserReason::NoSignerPin, "no_signer_pin"), (BrowserReason::MissingManifest, "missing_manifest"), (BrowserReason::InvalidRelease, "invalid_release"), (BrowserReason::SignerMismatch, "signer_mismatch")] {
            assert_eq!(serde_json::to_value(reason).unwrap(), json!(wire));
            assert_eq!(serde_json::to_value(UpdateOutcome::browser("1.2.3", reason, 7)).unwrap(), json!({"status":"browser_download","version":"1.2.3","downloadUrl":"https://github.com/bradleybond512/crystal-ball/releases/tag/v1.2.3","reason":wire,"checkedAt":7}));
        }
        assert_eq!(serde_json::to_value(UpdateOutcome::Ready { version: "1.2.3".into(), checked_at: 7 }).unwrap(), json!({"status":"ready","version":"1.2.3","checkedAt":7}));
        assert_eq!(serde_json::to_value(UpdateOutcome::UpToDate { current_version: "1.2.3".into(), checked_at: 7 }).unwrap(), json!({"status":"up_to_date","currentVersion":"1.2.3","checkedAt":7}));
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn variant_channel_rejection_is_explicit_and_full_policy_is_preserved() {
        assert!(require_full_channel(BUNDLE_ID, Some("Crystal Ball")).is_ok());
        for (id, name) in [
            ("com.bradleybond.crystalball.tech", "Tech Monitor"),
            ("com.bradleybond.crystalball.finance", "Finance Monitor"),
        ] {
            let error = require_full_channel(id, Some(name)).unwrap_err();
            assert_eq!(error.code, "variant_updates_unavailable");
            assert_eq!(error.message, "Automatic updates are not available for this variant yet.");
        }
    }

    fn release() -> Release {
        serde_json::from_value(json!({"tag_name":"v2.25.148","draft":false,"prerelease":false,"assets":[
            {"name":"Crystal.Ball_2.25.148_aarch64.dmg","size":123,"browser_download_url":asset_url("v2.25.148","Crystal.Ball_2.25.148_aarch64.dmg")},
            {"name":"release-manifest.json","size":456,"browser_download_url":asset_url("v2.25.148","release-manifest.json")}
        ]})).unwrap()
    }
    fn manifest() -> Manifest {
        serde_json::from_value(
            json!({"version":"2.25.148","tag":"v2.25.148","variant":"full","assets":[
                {"name":"Crystal Ball_2.25.148_aarch64.dmg","size":123,"sha256":"ab".repeat(32)}
            ]}),
        )
        .unwrap()
    }
    #[test]
    fn canonical_initial_url_rejects_untrusted_spelling() {
        let good = asset_url("v2.25.148", "Crystal.Ball_2.25.148_aarch64.dmg");
        assert!(validate_initial_url(&good, &good).is_ok());
        for bad in [
            good.replace("https:", "http:"),
            good.replace("bradleybond512", "attacker"),
            good.replace("crystal-ball/", "crystal-ball-other/"),
            good.replace("github.com/", "user@github.com/"),
            good.replace("github.com/", "github.com:8443/"),
            good.replace("github.com/", "github.com:443/"),
            format!("{good}?a=1"),
            format!("{good}#x"),
            good.replace("/releases/", "/a/../releases/"),
            good.replace("/releases/", "/%2e%2e/releases/"),
            good.replace("/releases/", "/%252e%252e/releases/"),
            good.replace("/releases/", "\\releases/"),
            format!("\n{good}"),
            good.replace("github.com", "github.com.evil.example"),
        ] {
            assert!(validate_initial_url(&bad, &good).is_err(), "{bad}");
        }
    }
    #[test]
    fn only_observed_cdn_redirect_is_allowed() {
        let initial = asset_url("v2.25.148", "release-manifest.json");
        let good="https://release-assets.githubusercontent.com/github-production-release-asset/1171076424/abc?sig=x";
        assert!(validate_redirect(good, &initial, 1).is_ok());
        assert!(validate_redirect(&initial, &initial, 3).is_ok());
        for bad in [
            good.replace("https:", "http:"),
            good.replace("1171076424", "999"),
            good.replace("release-assets.", "objects."),
            good.replace(".com/", ".com:8443/"),
            good.replace(".com/", "user@evil.com/"),
            good.replace("/abc?", "/%2e%2e/abc?"),
            good.replace(".com/", ".com.evil/"),
            format!("{good}#x"),
            initial.replace("bradleybond512", "other"),
        ] {
            assert!(validate_redirect(&bad, &initial, 1).is_err(), "{bad}");
        }
        assert!(validate_redirect(good, &initial, 4).is_err());
        assert!(validate_initial_url(good, &initial).is_err());
    }
    #[test]
    fn strict_versions_do_not_guess() {
        assert!(is_newer("2.25.148", "2.25.147"));
        assert!(!is_newer("2.25.147", "2.25.147"));
        assert!(!is_newer("2.25.146", "2.25.147"));
        for bad in [
            "v1.2.3",
            "1.2",
            "1.2.3.4",
            "01.2.3",
            "1.2.3-beta",
            "1.2.3 ",
            "1.2.-1",
            "4294967296.0.0",
        ] {
            assert!(version(bad).is_err(), "{bad}");
        }
        let mut r = release();
        r.draft = true;
        assert!(release_version(&r).is_err());
        r.draft = false;
        r.prerelease = true;
        assert!(release_version(&r).is_err());
        r.prerelease = false;
        r.tag_name = "2.25.148".into();
        assert!(release_version(&r).is_err());
    }
    #[test]
    fn exact_architecture_and_manifest_mapping() {
        let r = release();
        let selected = select_assets(&r, "aarch64").unwrap();
        assert_eq!(
            validate_manifest(&manifest(), &selected).unwrap(),
            "ab".repeat(32)
        );
        assert!(select_assets(&r, "x86_64").is_err());
        assert_eq!(
            select_assets(&r, "armv7").unwrap_err(),
            BrowserReason::UnsupportedArchitecture
        );
        let mut x64 = release();
        let (name, _, download_url) = x64.assets_mut()[0].fields_mut();
        *name = "Crystal.Ball_2.25.148_x64.dmg".into();
        *download_url = asset_url("v2.25.148", name);
        assert!(select_assets(&x64, "x86_64").is_ok());
    }
    #[test]
    fn ambiguous_or_mismatched_metadata_is_rejected() {
        let mut r = release();
        let duplicate = r.assets()[0].clone();
        r.assets_mut().push(duplicate);
        assert!(select_assets(&r, "aarch64").is_err());
        let mut r = release();
        r.assets_mut().pop();
        assert_eq!(
            select_assets(&r, "aarch64").unwrap_err(),
            BrowserReason::MissingManifest
        );
        let mut r = release();
        let duplicate = r.assets()[1].clone();
        r.assets_mut().push(duplicate);
        assert!(select_assets(&r, "aarch64").is_err());
        let mut r = release();
        let untrusted_url = r.assets()[0].fields().2.replace("bradleybond512", "evil");
        *r.assets_mut()[0].fields_mut().2 = untrusted_url;
        assert!(select_assets(&r, "aarch64").is_err());
        let mut r = release();
        *r.assets_mut()[0].fields_mut().1 = MAX_ARTIFACT_BYTES + 1;
        assert!(select_assets(&r, "aarch64").is_err());
        let s = select_assets(&release(), "aarch64").unwrap();
        for field in [
            "version",
            "tag",
            "variant",
            "size",
            "hash",
            "name",
            "duplicate",
        ] {
            let mut m = manifest();
            match field {
                "version" => m.version = "2.25.149".into(),
                "tag" => m.tag = "v2.25.149".into(),
                "variant" => m.variant = "tech".into(),
                "size" => m.assets[0].size += 1,
                "hash" => m.assets[0].sha256 = "g".repeat(64),
                "name" => m.assets[0].name = "Crystal Ball_2.25.148_x64.dmg".into(),
                _ => {
                    let mut duplicate = m.assets[0].clone();
                    duplicate.name = s.asset.fields().0.to_owned();
                    m.assets.push(duplicate);
                }
            };
            assert!(validate_manifest(&m, &s).is_err(), "{field}");
        }
    }
    #[test]
    fn fingerprints_not_names_bind_local_signer() {
        for clause in [
            format!("certificate leaf = H\"{}\"", "ab".repeat(20)),
            format!("certificate root = H\"{}\"", "AB".repeat(20)),
            format!("certificate 0 = H\"{}\"", "12".repeat(20)),
            format!("certificate 1 = H\"{}\"", "12".repeat(20)),
        ] {
            let dr = format!("identifier \"{BUNDLE_ID}\" and {clause}");
            assert_eq!(
                SignerRequirement::local(&format!("designated => {dr}\n"))
                    .unwrap()
                    .as_str(),
                dr
            );
        }
        for bad in [format!("identifier \"{BUNDLE_ID}\" and cdhash H\"{}\"","ab".repeat(20)),format!("identifier \"{BUNDLE_ID}\" and certificate leaf[subject.CN] = \"Crystal Ball Dev\""),format!("identifier \"{BUNDLE_ID}\" and certificate leaf = H\"123\""),format!("identifier \"{BUNDLE_ID}\" or always"),format!("identifier \"evil\" and certificate leaf = H\"{}\"","ab".repeat(20)),format!("identifier \"{BUNDLE_ID}\" and certificate leaf = H\"{}\" or always","ab".repeat(20)),String::new()] {
            assert!(SignerRequirement::local(&format!("designated => {bad}")).is_err(),"{bad}");
        }
        assert!(SignerRequirement::local("designated => always\ndesignated => always").is_err());
    }
    #[test]
    fn self_signed_anchor_fingerprint_supports_both_conjunction_orders() {
        let anchor = format!("anchor H\"{}\"", "ab".repeat(20));
        let identifier = format!("identifier \"{BUNDLE_ID}\"");
        for dr in [
            format!("{identifier} and {anchor}"),
            format!("{anchor} and {identifier}"),
        ] {
            assert_eq!(
                SignerRequirement::local(&format!("designated => {dr}"))
                    .unwrap()
                    .as_str(),
                dr
            );
            assert!(SignerRequirement::local(&format!("designated => {dr} or always")).is_err());
        }
    }
    #[test]
    fn apple_team_is_validated_and_does_not_authorize_without_anchor() {
        assert!(SignerRequirement::apple("ABCDE12345")
            .unwrap()
            .as_str()
            .contains("anchor apple generic"));
        for bad in ["", "not set", "A\" or always", "abcd123456", "ABCDE123456"] {
            assert!(SignerRequirement::apple(bad).is_err());
        }
        assert!(choose_signer(false, false, Some("ABCDE12345"), None, |_| true).is_err());
        assert!(choose_signer(false, true, Some("ABCDE12345"), None, |_| true).is_err());
        assert!(choose_signer(true, false, Some("ABCDE12345"), None, |_| true).is_err());
        assert!(choose_signer(true, true, Some("ABCDE12345"), None, |_| false).is_err());
        assert!(choose_signer(true, true, Some("ABCDE12345"), None, |_| true).is_ok());
    }
    #[test]
    fn candidate_must_satisfy_the_captured_pin() {
        let dr = format!(
            "designated => identifier \"{BUNDLE_ID}\" and certificate leaf = H\"{}\"",
            "ab".repeat(20)
        );
        let pin = choose_signer(true, false, None, Some(&dr), |_| true).unwrap();
        assert!(check_candidate("2.25.148", "2.25.147", Some("2.25.148"), &pin, |_| true).is_ok());
        assert!(check_candidate("2.25.148", "2.25.147", None, &pin, |_| false).is_err());
        assert!(check_candidate("2.25.149", "2.25.147", Some("2.25.148"), &pin, |_| true).is_err());
        assert!(check_candidate("2.25.147", "2.25.147", None, &pin, |_| true).is_err());
    }
    #[test]
    fn newer_existing_bundle_only_wins_after_verification() {
        assert_eq!(
            published_version("2.25.148", Ok("2.25.149".into())),
            "2.25.149"
        );
        assert_eq!(
            published_version("2.25.148", Err("bad signer".into())),
            "2.25.148"
        );
        assert_eq!(
            published_version("2.25.148", Ok("2.25.147".into())),
            "2.25.148"
        );
    }
    #[test]
    fn result_contract_uses_native_versions_and_camel_case_fields() {
        let result = UpdateOutcome::UpToDate {
            current_version: "1.2.3".into(),
            checked_at: 123,
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            json!({"status":"up_to_date","currentVersion":"1.2.3","checkedAt":123})
        );
        let result = UpdateOutcome::browser("1.2.4", BrowserReason::NoSignerPin, 123);
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            json!({"status":"browser_download","version":"1.2.4","downloadUrl":"https://github.com/bradleybond512/crystal-ball/releases/tag/v1.2.4","reason":"no_signer_pin","checkedAt":123})
        );
    }
    #[test]
    fn download_must_pass_size_and_hash_before_native_staging() {
        let data = b"abc".to_vec();
        let hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert_eq!(
            verify_download(data.clone(), hash, 3).unwrap().into_bytes(),
            data
        );
        for (hash, size) in [
            ("", 3),
            ("zz", 3),
            (hash, 2),
            (hash, 4),
            (hash, MAX_ARTIFACT_BYTES + 1),
        ] {
            let mut mounted = false;
            let result = verify_download(data.clone(), hash, size).map(|_| mounted = true);
            assert!(result.is_err());
            assert!(!mounted);
        }
        let mut mounted = false;
        let result = verify_download(b"abd".to_vec(), hash, 3).map(|_| mounted = true);
        assert_eq!(result.unwrap_err().code, "checksum_mismatch");
        assert!(!mounted);
    }
    #[test]
    fn body_limits_reject_truncation_and_oversized_chunks() {
        assert!(check_body_length(2, 3, Some(3), false).is_ok());
        assert!(check_body_length(3, 3, Some(3), true).is_ok());
        assert!(check_body_length(4, 3, None, false).is_err());
        assert!(check_body_length(2, 3, Some(3), true).is_err());
        assert!(check_body_length(4, 8, Some(3), false).is_err());
    }
}
