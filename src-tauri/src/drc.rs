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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_board_reports_nothing() {
        let out = run_checks(50.0, 35.0, vec![("R1".into(), 5.0, 5.0)]);
        assert!(out.is_empty(), "got: {out:?}");
    }

    #[test]
    fn out_of_bounds_is_error() {
        let out = run_checks(50.0, 35.0, vec![("R1".into(), 60.0, 5.0)]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].severity, "error");
    }
}
