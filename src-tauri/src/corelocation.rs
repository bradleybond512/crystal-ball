use serde::Serialize;
use tauri::command;

#[derive(Debug, Serialize)]
pub struct LocationResult {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub speed: Option<f64>,
    pub course: Option<f64>,
    pub horizontal_accuracy: f64,
}

const TRUSTED_WINDOWS: &[&str] = &["main", "settings", "live-channels"];

#[command]
pub async fn get_location<R: tauri::Runtime>(webview: tauri::Webview<R>) -> Result<LocationResult, String> {
    if !TRUSTED_WINDOWS.contains(&webview.label()) {
        return Err(format!(
            "get_location may only be called from a trusted window (got '{}')",
            webview.label()
        ));
    }
    get_location_impl()
}

#[cfg(target_os = "macos")]
fn get_location_impl() -> Result<LocationResult, String> {
    const SWIFT_CODE: &str = r#"
import CoreLocation
import Foundation

class Delegate: NSObject, CLLocationManagerDelegate {
    var location: CLLocation?
    var error: Error?
    let sema = DispatchSemaphore(value: 0)

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        location = locations.last
        sema.signal()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        self.error = error
        sema.signal()
    }
}

let delegate = Delegate()
let manager = CLLocationManager()
manager.desiredAccuracy = kCLLocationAccuracyBest
manager.delegate = delegate
manager.startUpdatingLocation()

let timeout = delegate.sema.wait(timeout: .now() + 5)
manager.stopUpdatingLocation()

guard timeout == .success, let loc = delegate.location else {
    print("error: no location fix")
    exit(1)
}

let alt = loc.altitude
let spd = loc.speed
let crs = loc.course
let acc = loc.horizontalAccuracy

print("\(loc.coordinate.latitude),\(loc.coordinate.longitude),\(alt),\(spd),\(crs),\(acc)")
"#;

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(SWIFT_CODE)
        .output()
        .map_err(|e| format!("Failed to run swift subprocess: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Swift location subprocess failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.trim();
    let parts: Vec<&str> = line.split(',').collect();
    if parts.len() != 6 {
        return Err(format!("Unexpected output from swift subprocess: {line}"));
    }

    let parse = |s: &str, field: &str| -> Result<f64, String> {
        s.trim()
            .parse::<f64>()
            .map_err(|e| format!("Failed to parse {field}: {e}"))
    };

    let latitude = parse(parts[0], "latitude")?;
    let longitude = parse(parts[1], "longitude")?;
    let altitude = parse(parts[2], "altitude")?;
    let speed_raw = parse(parts[3], "speed")?;
    let course_raw = parse(parts[4], "course")?;
    let horizontal_accuracy = parse(parts[5], "horizontal_accuracy")?;

    Ok(LocationResult {
        latitude,
        longitude,
        altitude: Some(altitude),
        speed: if speed_raw < 0.0 { None } else { Some(speed_raw) },
        course: if course_raw < 0.0 { None } else { Some(course_raw) },
        horizontal_accuracy,
    })
}

#[cfg(not(target_os = "macos"))]
fn get_location_impl() -> Result<LocationResult, String> {
    Err("Native CoreLocation is only supported on macOS".into())
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("corelocation")
        .invoke_handler(tauri::generate_handler![get_location])
        .build()
}
