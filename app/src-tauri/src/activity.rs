//! Agent status for the menu-bar dot (Claude Code, Codex): the agent's hooks write one small file per session
//! (working / waiting / done) under ~/.devicetally/activity; this reads them and picks what to show.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Session {
    pub state: String, // working | waiting | done
    pub since: i64,    // ms
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub tool: String, // "" = Claude Code, "codex"
    #[serde(default)]
    pub started: i64, // ms, when the current task began (0 = unknown)
    #[serde(default)]
    pub id: String, // the file name: one per session
}

impl Session {
    pub fn tool_name(&self) -> &'static str {
        if self.tool == "codex" { "Codex" } else { "Claude Code" }
    }
}

/// A banner or sound to give: a session just finished or started waiting for you.
#[derive(Debug, PartialEq)]
pub struct Alert {
    pub waiting: bool,
    pub title: String,
    pub body: String,
}

/// Each session's last (state, since), to notice changes between redraws.
pub type Seen = std::collections::HashMap<String, (String, i64)>;

/// Alerts for sessions that changed to done or waiting since `seen` (then updates it). The first call
/// (empty `seen`, `first`) only records, so starting the app doesn't replay old alerts. Done tasks
/// shorter than `min_ms` are skipped (quick back-and-forth needs no ping).
pub fn alerts(seen: &mut Seen, first: bool, sessions: &[Session], now: i64, min_ms: i64) -> Vec<Alert> {
    let mut out = vec![];
    for s in sessions {
        let key = (s.state.clone(), s.since);
        let changed = seen.get(&s.id) != Some(&key);
        seen.insert(s.id.clone(), key);
        if first || !changed || now - s.since > 60_000 {
            continue;
        }
        let place = if s.project.is_empty() { String::new() } else { format!("{} · ", s.project) };
        match s.state.as_str() {
            "done" => {
                let took = (s.started > 0).then(|| s.since - s.started);
                if took.is_some_and(|t| t < min_ms) {
                    continue;
                }
                let took = took.map(|t| if t >= 60_000 { format!("took {} min", (t + 30_000) / 60_000) } else { format!("took {} s", t / 1000) });
                out.push(Alert { waiting: false, title: format!("{} finished", s.tool_name()), body: format!("{place}{}", took.unwrap_or_else(|| "task done".into())) });
            }
            "waiting" => out.push(Alert { waiting: true, title: format!("{} needs you", s.tool_name()), body: format!("{place}a permission or a question") }),
            _ => {}
        }
    }
    out
}

/// What the dot shows, most urgent first.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Dot {
    Waiting, // Claude needs you (permission, a question)
    Working,
    Done, // finished since you last opened the popover
}

impl Dot {
    pub fn rgb(self) -> [u8; 3] {
        match self { Dot::Waiting => [0xff, 0x45, 0x3a], Dot::Working => [0xff, 0x9f, 0x0a], Dot::Done => [0x30, 0xd1, 0x58] }
    }
}

pub fn read(dir: &Path) -> Vec<Session> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let mut s: Session = serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok()?;
            s.id = e.path().file_stem()?.to_string_lossy().into_owned();
            Some(s)
        })
        .collect()
}

/// The menu-bar Agent status: the most urgent state and how many sessions are in it.
pub fn agent(sessions: &[Session], now: i64, seen: i64) -> (crate::menubar::Agent, u8) {
    use crate::menubar::Agent;
    let hour = 3_600_000;
    let count = |f: &dyn Fn(&Session) -> bool| sessions.iter().filter(|s| f(s)).count().min(99) as u8;
    let waiting = count(&|s| s.state == "waiting" && now - s.since < 24 * hour);
    let working = count(&|s| s.state == "working" && now - s.since < 3 * hour);
    let done = count(&|s| s.state == "done" && s.since > seen && now - s.since < 24 * hour);
    if waiting > 0 { (Agent::Waiting, waiting) } else if working > 0 { (Agent::Working, working) } else if done > 0 { (Agent::Done, done) } else { (Agent::Idle, 0) }
}

/// The dot for these sessions at `now`, given when the popover was last opened (`seen`).
/// Stale states fade: working over 3 h (a crashed session), waiting or done over a day.
pub fn dot(sessions: &[Session], now: i64, seen: i64) -> Option<Dot> {
    let age = |s: &Session| now - s.since;
    let hour = 3_600_000;
    if sessions.iter().any(|s| s.state == "waiting" && age(s) < 24 * hour) {
        return Some(Dot::Waiting);
    }
    if sessions.iter().any(|s| s.state == "working" && age(s) < 3 * hour) {
        return Some(Dot::Working);
    }
    if sessions.iter().any(|s| s.state == "done" && s.since > seen && age(s) < 24 * hour) {
        return Some(Dot::Done);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(state: &str, since: i64) -> Session {
        Session { state: state.into(), since, project: "p".into(), tool: String::new(), started: 0, id: "s".into() }
    }

    #[test]
    fn most_urgent_state_wins_and_done_clears_when_seen() {
        let now = 10 * 3_600_000;
        assert_eq!(dot(&[s("done", now - 1000), s("working", now - 5000)], now, 0), Some(Dot::Working));
        assert_eq!(dot(&[s("working", now - 5000), s("waiting", now - 9000)], now, 0), Some(Dot::Waiting));
        assert_eq!(dot(&[s("done", now - 1000)], now, 0), Some(Dot::Done));
        assert_eq!(dot(&[s("done", now - 1000)], now, now - 500), None, "opening the popover clears done");
        assert_eq!(dot(&[s("working", now - 4 * 3_600_000)], now, 0), None, "a crashed session doesn't stay orange");
        assert_eq!(dot(&[], now, 0), None);
    }

    #[test]
    fn alerts_once_per_change_and_skip_quick_tasks() {
        let now = 100_000_000;
        let sess = |id: &str, state: &str, started: i64| Session { state: state.into(), since: now, project: "devicetally".into(), tool: String::new(), started, id: id.into() };
        let mut seen = Seen::new();
        // Starting the app: old states are recorded, not announced.
        assert!(alerts(&mut seen, true, &[sess("a", "done", now - 300_000)], now, 20_000).is_empty());
        // A new long task finishing is announced once.
        let long = [sess("b", "done", now - 150_000)];
        let a = alerts(&mut seen, false, &long, now, 20_000);
        assert_eq!(a, vec![Alert { waiting: false, title: "Claude Code finished".into(), body: "devicetally · took 3 min".into() }]);
        assert!(alerts(&mut seen, false, &long, now, 20_000).is_empty(), "not again on the next redraw");
        // A quick one isn't.
        assert!(alerts(&mut seen, false, &[sess("c", "done", now - 5_000)], now, 20_000).is_empty());
        // Needing you is always announced.
        let w = alerts(&mut seen, false, &[sess("d", "waiting", now - 5_000)], now, 20_000);
        assert!(w[0].waiting && w[0].title == "Claude Code needs you");
    }

    #[test]
    fn reads_the_agents_files() {
        let dir = std::env::temp_dir().join(format!("dt-activity-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.json"), r#"{"state":"done","since":5,"project":"devicetally"}"#).unwrap();
        std::fs::write(dir.join("b.json.tmp"), "partial").unwrap();
        std::fs::write(dir.join("c.json"), "not json").unwrap();
        assert_eq!(read(&dir), vec![Session { state: "done".into(), since: 5, project: "devicetally".into(), tool: String::new(), started: 0, id: "a".into() }]);
        std::fs::remove_dir_all(dir).ok();
    }
}
