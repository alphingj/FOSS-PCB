#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod kicad;
mod drc;
mod router;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::parse_kicad_pcb,
            commands::write_kicad_pcb,
            commands::run_drc,
            commands::autoroute,
            commands::run_python_plugin,
            commands::export_step,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FOSS-PCB");
}
