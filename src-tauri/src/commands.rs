use crate::{drc, kicad, router};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
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
/// of hanging the UI forever.
fn run_python_module(app: &AppHandle, module: &str, extra_args: &[&str], stdin_json: &str) -> Result<String, String> {
    let root = bundle_root(app);
    let mut child = Command::new(python_bin())
        .args(extra_args)
        .arg(module)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&root)
        .env("PYTHONPATH", root.join("python"))
        .spawn()
        .map_err(|e| format!("spawn python ({module}): {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(stdin_json.as_bytes());
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let out = rx
        .recv_timeout(PLUGIN_TIMEOUT)
        .map_err(|_| format!("{module} timed out after {}s", PLUGIN_TIMEOUT.as_secs()))?
        .map_err(|e| format!("{module} failed: {e}"))?;
    if !out.stdout.is_empty() {
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    Err(format!(
        "plugin empty stdout: {}",
        String::from_utf8_lossy(&out.stderr).chars().take(500).collect::<String>()
    ))
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
    let module = format!("foss_pcb.runner {plugin}");
    match run_python_module(&app, &module, &[], &args_json) {
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
