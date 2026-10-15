// Coarse grid BFS fallback. NOTE: the TS side (lib/routing.ts) has been upgraded
// to octilinear A* and owns real routing; this stays as the offline fallback
// until the `autoroute` command grows from/to endpoints.
use std::collections::{HashMap, VecDeque};

#[allow(dead_code)] // exercised by tests; `autoroute` cmd serves stub until it grows endpoints
pub fn bfs_route(board_w: f64, board_h: f64, from: (f64, f64), to: (f64, f64)) -> Vec<(f64, f64)> {
    let step = 1.0;
    let q = |v: f64| (v / step).round() * step;
    let (sx, sy) = (q(from.0), q(from.1));
    let (tx, ty) = (q(to.0), q(to.1));
    let key = |(x, y): (f64, f64)| format!("{x:.1},{y:.1}");
    let mut prev: HashMap<String, Option<String>> = HashMap::new();
    let mut qd = VecDeque::new();
    prev.insert(key((sx, sy)), None);
    qd.push_back((sx, sy));
    while let Some((x, y)) = qd.pop_front() {
        if (x - tx).abs() < 1e-6 && (y - ty).abs() < 1e-6 {
            break;
        }
        for (dx, dy) in [(step, 0.0), (-step, 0.0), (0.0, step), (0.0, -step)] {
            let (nx, ny) = (((x + dx) * 10.0).round() / 10.0, ((y + dy) * 10.0).round() / 10.0);
            if nx < 0.0 || ny < 0.0 || nx > board_w || ny > board_h {
                continue;
            }
            let k = key((nx, ny));
            if prev.contains_key(&k) {
                continue;
            }
            prev.insert(k.clone(), Some(key((x, y))));
            qd.push_back((nx, ny));
        }
    }
    let mut path = Vec::new();
    let mut cur: Option<String> = Some(key((tx, ty)));
    if !prev.contains_key(cur.as_ref().unwrap()) {
        return vec![from, to];
    }
    while let Some(k) = cur {
        let mut it = k.split(',');
        let x: f64 = it.next().unwrap().parse().unwrap();
        let y: f64 = it.next().unwrap().parse().unwrap();
        path.push((x, y));
        cur = prev.get(&k).cloned().flatten();
    }
    path.reverse();
    if path.is_empty() {
        vec![from, to]
    } else {
        path
    }
}

pub fn autoroute_stub(nets: Vec<String>) -> Vec<String> {
    // NOTE: coarse placeholder — real geometry routing lives in lib/routing.ts
    // (BFS per net) until this command grows from/to endpoints.
    nets.into_iter().map(|n| format!("routed:{n}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_straight_line_on_empty_board() {
        let path = bfs_route(50.0, 35.0, (5.0, 5.0), (9.0, 5.0));
        assert!(path.len() >= 2);
        assert_eq!(path[0], (5.0, 5.0));
        assert_eq!(path[path.len() - 1], (9.0, 5.0));
        // every step is on the 1mm lattice and inside the board
        for (x, y) in &path {
            assert!((x * 10.0).round() / 10.0 == *x);
            assert!(*x >= 0.0 && *x <= 50.0 && *y >= 0.0 && *y <= 35.0);
        }
    }

    #[test]
    fn falls_back_when_target_out_of_bounds() {
        let path = bfs_route(50.0, 35.0, (5.0, 5.0), (500.0, 500.0));
        assert_eq!(path, vec![(5.0, 5.0), (500.0, 500.0)]);
    }
}
