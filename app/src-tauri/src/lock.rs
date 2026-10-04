//! "Lock this computer" (macOS): DeviceTally's hooks go into Claude Code's system-wide settings and
//! its tracker into a system folder, both changeable only with the Mac's admin password. Hooks there
//! run in every Claude Code session, whatever settings folder is used
//! (code.claude.com/docs/en/managed-settings). Best on a standard (non-admin) Mac account.

use serde_json::{json, Map, Value};
use std::path::Path;

pub const MANAGED: &str = "/Library/Application Support/ClaudeCode/managed-settings.json";
pub const BIN_DIR: &str = "/Library/Application Support/DeviceTally/bin";
pub const BIN: &str = "/Library/Application Support/DeviceTally/bin/devicetally";
const EVENTS: [&str; 4] = ["SessionStart", "UserPromptSubmit", "Stop", "Notification"];

fn ours(h: &Value) -> bool {
    h["command"].as_str().is_some_and(|c| c.contains("devicetally") && c.contains(" hook "))
}

/// The managed settings with DeviceTally's hooks added (replacing older ones of ours), keeping
/// everything else. `only_ours`: no other hooks may run; `block_skip`: no --dangerously-skip-permissions.
pub fn with_hooks(existing: &str, only_ours: bool, block_skip: bool) -> Result<String, String> {
    let mut s: Map<String, Value> = if existing.trim().is_empty() { Map::new() } else { serde_json::from_str(existing).map_err(|_| "The existing Claude Code managed settings file isn't valid JSON; not touching it.".to_string())? };
    strip(&mut s);
    let hooks = s.entry("hooks").or_insert_with(|| json!({}));
    for ev in EVENTS {
        let list = hooks.as_object_mut().ok_or("hooks is not an object")?.entry(ev).or_insert_with(|| json!([]));
        list.as_array_mut().ok_or("hook list is not an array")?.push(json!({ "hooks": [{ "type": "command", "command": format!("\"{BIN}\" hook {ev}"), "async": true, "timeout": 10 }] }));
    }
    // Transcript cleanup stays Claude Code's own (30 days by default): DeviceTally uploads within
    // seconds, so it needs no longer retention.
    if only_ours {
        s.insert("allowManagedHooksOnly".into(), json!(true));
    } else {
        s.remove("allowManagedHooksOnly");
    }
    let perms = s.entry("permissions").or_insert_with(|| json!({}));
    if let Some(p) = perms.as_object_mut() {
        if block_skip {
            p.insert("disableBypassPermissionsMode".into(), json!("disable"));
        } else {
            p.remove("disableBypassPermissionsMode");
        }
        if p.is_empty() {
            s.remove("permissions");
        }
    }
    serde_json::to_string_pretty(&Value::Object(s)).map_err(|e| e.to_string())
}

/// Removes DeviceTally's hooks (and empty hook lists) from managed settings.
pub fn without_hooks(existing: &str) -> Result<String, String> {
    let mut s: Map<String, Value> = serde_json::from_str(existing).map_err(|e| e.to_string())?;
    strip(&mut s);
    s.remove("allowManagedHooksOnly");
    serde_json::to_string_pretty(&Value::Object(s)).map_err(|e| e.to_string())
}

fn strip(s: &mut Map<String, Value>) {
    if let Some(hooks) = s.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for list in hooks.values_mut() {
            if let Some(groups) = list.as_array_mut() {
                for g in groups.iter_mut() {
                    if let Some(hs) = g["hooks"].as_array_mut() {
                        hs.retain(|h| !ours(h));
                    }
                }
                groups.retain(|g| g["hooks"].as_array().is_some_and(|h| !h.is_empty()));
            }
        }
        hooks.retain(|_, v| v.as_array().is_some_and(|a| !a.is_empty()));
        if hooks.is_empty() {
            s.remove("hooks");
        }
    }
}

/// Locked = our hooks are in the managed settings and the tracker is in the system folder.
pub fn is_locked() -> bool {
    let has = std::fs::read_to_string(MANAGED).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).is_some_and(|v| {
        v["hooks"].as_object().is_some_and(|h| h.values().flat_map(|l| l.as_array().into_iter().flatten()).flat_map(|g| g["hooks"].as_array().into_iter().flatten()).any(ours))
    });
    has && Path::new(BIN).exists()
}

/// Runs a shell script as root after macOS asks for an administrator's password.
#[cfg(target_os = "macos")]
pub fn as_admin(script: &str, prompt: &str) -> Result<(), String> {
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let apple = format!("do shell script \"{}\" with prompt \"{}\" with administrator privileges", esc(script), esc(prompt));
    let out = std::process::Command::new("osascript").arg("-e").arg(apple).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    Err(if err.contains("-128") { "Cancelled.".into() } else { err.trim().to_string() })
}

/// Single-quotes a path for sh.
pub fn sh(p: &str) -> String {
    format!("'{}'", p.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_and_removes_only_our_hooks() {
        let theirs = r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"say done"}]}]},"cleanupPeriodDays":30}"#;
        let locked: Value = serde_json::from_str(&with_hooks(theirs, true, true).unwrap()).unwrap();
        assert_eq!(locked["model"], "opus", "other settings kept");
        assert_eq!(locked["hooks"]["Stop"].as_array().unwrap().len(), 2, "their Stop hook kept, ours added");
        assert!(locked["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"].as_str().unwrap().contains("DeviceTally/bin/devicetally\" hook UserPromptSubmit"));
        assert_eq!(locked["cleanupPeriodDays"], 30, "the user's own retention is left alone");
        assert_eq!(locked["allowManagedHooksOnly"], true);
        assert_eq!(locked["permissions"]["disableBypassPermissionsMode"], "disable");
        // Locking twice doesn't duplicate.
        let twice: Value = serde_json::from_str(&with_hooks(&locked.to_string(), false, false).unwrap()).unwrap();
        assert_eq!(twice["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert!(twice.get("allowManagedHooksOnly").is_none() && twice.get("permissions").is_none());
        // Unlocking leaves only theirs.
        let back: Value = serde_json::from_str(&without_hooks(&twice.to_string()).unwrap()).unwrap();
        assert_eq!(back["hooks"]["Stop"][0]["hooks"][0]["command"], "say done");
        assert!(back["hooks"].get("UserPromptSubmit").is_none());
        assert!(with_hooks("{not json", false, false).is_err(), "never overwrite a file we can't read");
    }

    #[test]
    fn quotes_for_the_shell() {
        assert_eq!(sh("/a b/it's"), "'/a b/it'\\''s'");
    }
}
