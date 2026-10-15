use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct DrcIssue {
    pub severity: String,
    pub message: String,
}

pub fn run_checks(board_w_mm: f64, board_h_mm: f64, placements: Vec<(String, f64, f64)>) -> Vec<DrcIssue> {
    let mut out = Vec::new();
    for (des, x, y) in placements {
        if x < 0.0 || y < 0.0 || x > board_w_mm || y > board_h_mm {
            out.push(DrcIssue { severity: "error".into(), message: format!("{des} out of bounds") });
        }
    }
    out
}
