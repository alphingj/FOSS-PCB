use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PcbIoResult {
    pub design_name: String,
    pub components: Vec<String>,
    pub nets: Vec<String>,
}

/// Best-effort s-expr scan: collects footprint names and `(net <id> "<name>")`
/// pairs. Full fidelity lives in the TS/Python importers; this keeps the
/// desktop Import path working when they are unavailable.
pub fn parse_pcb_sexpr(text: &str) -> PcbIoResult {
    let mut components = Vec::new();
    let mut nets = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("(footprint") {
            components.push(rest.trim().trim_matches('"').to_string());
        }
        if let Some(rest) = t.strip_prefix("(net ") {
            // "(net 3 "GND")" -> "3:GND"
            let inner = rest.trim().trim_end_matches(')').trim();
            let mut parts = inner.splitn(2, char::is_whitespace);
            let id = parts.next().unwrap_or("").to_string();
            let name = parts.next().unwrap_or("").trim().trim_matches('"').to_string();
            nets.push(format!("{id}:{name}"));
        }
    }
    // "(kicad_pcb ... (title "Name") ...)" when present
    let design_name = text
        .lines()
        .find_map(|l| {
            let t = l.trim().strip_prefix("(title ")?;
            Some(t.trim().trim_end_matches(')').trim().trim_matches('"').to_string())
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "imported".to_string());
    PcbIoResult { design_name, components, nets }
}

/// Last-resort stub used ONLY when the Python exporter is unreachable.
/// Callers must detect the marker comment and prefer a real writer.
pub const SEXPR_STUB_MARKER: &str = "foss-json follows";

pub fn foss_json_to_sexpr_stub(json: &str) -> String {
    format!("(kicad_pcb (version 20240101) (generator foss-pcb)\n  ;; {SEXPR_STUB_MARKER}\n  ;; {}\n)", json.chars().take(200).collect::<String>())
}
