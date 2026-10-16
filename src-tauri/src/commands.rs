use crate::{drc, kicad, router};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Manager};

const PLUGIN_TIMEOUT: Duration = Duration::from_secs(120);

#[tauri::command]
pub fn parse_kicad_pcb(text: String) -> kicad::PcbIoResult {
    kicad::parse_pcb_sexpr(&text)
}

/// `python`, falling back to the `py` launcher on Windows Store installs.
fn python_bin() -> &'static str {
    if Command::new("python").arg("--version").output().is_ok() {
        "python"
    } else {
        "py"
    }
}

#[derive(serde::Serialize)]
pub struct PythonStatus {
    pub ok: bool,
    pub bin: String,
    pub version: String,
}

/// Probe for a working interpreter so the UI can guide instead of silently stubbing.
#[tauri::command]
pub fn check_python() -> PythonStatus {
    for bin in ["python", "py"] {
        if let Ok(out) = Command::new(bin).arg("--version").output() {
            if out.status.success() {
                let v = String::from_utf8_lossy(if out.stdout.is_empty() { &out.stderr } else { &out.stdout })
                    .trim()
                    .chars()
                    .take(64)
                    .collect::<String>();
                return PythonStatus { ok: true, bin: bin.to_string(), version: v };
            }
        }
    }
    PythonStatus { ok: false, bin: String::new(), version: String::new() }
}

/// Directory holding the bundled `python/` + `plugins/` trees:
/// Tauri resources dir in a bundle, repo root in `tauri dev`.
fn bundle_root(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        if dir.join("python").is_dir() {
            return dir;
        }
    }
    PathBuf::from("..")
}

/// Run a Python module with JSON on stdin, capturing stdout. Times out instead
/// of hanging the UI forever (and kills the child so zombies can't pile up).
fn run_python_module(app: &AppHandle, module: &str, extra_args: &[&str], stdin_json: &str) -> Result<String, String> {
    use std::io::Read;
    use std::time::Instant;
    let root = bundle_root(app);
    let mut child = Command::new(python_bin())
        .arg("-m")
        .arg(module)
        .args(extra_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&root)
        .env("PYTHONPATH", root.join("python"))
        .spawn()
        .map_err(|e| format!("spawn python -m {module}: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(stdin_json.as_bytes());
    }
    drop(child.stdin.take());
    let deadline = Instant::now() + PLUGIN_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut so = String::new();
                let mut se = String::new();
                if let Some(mut o) = child.stdout.take() {
                    let _ = o.read_to_string(&mut so);
                }
                if let Some(mut e) = child.stderr.take() {
                    let _ = e.read_to_string(&mut se);
                }
                if !status.success() && so.is_empty() {
                    return Err(format!(
                        "plugin exit {}: {}",
                        status,
                        se.chars().take(500).collect::<String>()
                    ));
                }
                if !so.is_empty() {
                    return Ok(so);
                }
                return Err(format!(
                    "plugin empty stdout: {}",
                    se.chars().take(500).collect::<String>()
                ));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("{module} timed out after {}s", PLUGIN_TIMEOUT.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("{module} failed: {e}")),
        }
    }
}

#[tauri::command]
pub fn write_kicad_pcb(app: AppHandle, foss_json: String) -> String {
    // Prefer full Python exporter (reads FOSS JSON on stdin), fall back to Rust stub.
    match run_python_module(&app, "foss_pcb.kicad_compat", &["--to-kicad"], &foss_json) {
        Ok(s) if s.starts_with("(kicad_pcb") => s,
        _ => kicad::foss_json_to_sexpr_stub(&foss_json),
    }
}

#[tauri::command]
pub fn run_drc(board_w: f64, board_h: f64, placements: Vec<(String, f64, f64)>) -> Vec<drc::DrcIssue> {
    drc::run_checks(board_w, board_h, placements)
}

#[tauri::command]
pub fn autoroute(nets: Vec<String>) -> Vec<String> {
    router::autoroute_stub(nets)
}

#[tauri::command]
pub fn run_python_plugin(app: AppHandle, plugin: String, args_json: String) -> String {
    // args via stdin: immune to shell quote-mangling on every platform.
    match run_python_module(&app, "foss_pcb.runner", &[&plugin], &args_json) {
        Ok(s) => s,
        Err(e) => format!("{{\"error\":\"{e}\"}}"),
    }
}

#[tauri::command]
pub fn export_step(app: AppHandle, foss_json: String) -> String {
    match run_python_module(&app, "foss_pcb.step_export", &[], &foss_json) {
        Ok(s) if !s.is_empty() => s,
        _ => format!("step-stub:{}", foss_json.chars().take(64).collect::<String>()),
    }
}
