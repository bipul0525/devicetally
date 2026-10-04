//! Storage on this computer, read-only: what AI tools and developer caches take up, and the biggest
//! folders in the home folder, each with its path (Show in Finder). Nothing is deleted here.
//! Known locations and their descriptions follow ClearDisk (github.com/bysiber/cleardisk, MIT).

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct Item {
    pub group: &'static str, // "AI tools" | "Developer caches" | "Biggest folders"
    pub name: String,
    pub about: &'static str,
    pub risk: &'static str, // "safe" (rebuilds itself) | "caution" (large re-download) | "risky" (may hold your data) | ""
    pub path: String,
    pub bytes: u64,
    /// Can be moved to the Bin from DeviceTally (see `may_trash`).
    pub trash: bool,
}

/// What may be moved to the Bin from DeviceTally: known caches and app data (never the transcripts
/// DeviceTally reads, nor the Bin itself) and folders inside ~/Library/Caches. Not top-level folders
/// like Desktop or Documents, and not Application Support folders (app data, e.g. browser profiles):
/// for those, Show in Finder. Checked again when moving, so the UI can't widen it.
pub fn may_trash(home: &Path, path: &Path) -> bool {
    if path.components().any(|c| c.as_os_str() == "..") || !path.starts_with(home) || path == home {
        return false;
    }
    let never = [".claude/projects", ".codex/sessions", ".Trash"];
    if let Some(k) = KNOWN.iter().find(|k| home.join(k.2) == path) {
        return !never.contains(&k.2);
    }
    path.parent() == Some(&home.join("Library/Caches"))
}

// (group, name, path under home, what it is, risk)
const KNOWN: &[(&str, &str, &str, &str, &str)] = &[
    ("AI tools", "Claude Code transcripts", ".claude/projects", "Your Claude Code conversations. DeviceTally reads these; deleting loses that history.", "risky"),
    ("AI tools", "Claude Desktop", "Library/Application Support/Claude", "Claude desktop app data and caches.", "caution"),
    ("AI tools", "Codex sessions", ".codex/sessions", "Your Codex conversations.", "risky"),
    ("AI tools", "Ollama models", ".ollama/models", "Downloaded local models. Re-download with ollama pull.", "caution"),
    ("AI tools", "Hugging Face cache", ".cache/huggingface", "Downloaded models and datasets. Re-downloads when used.", "caution"),
    ("AI tools", "LM Studio models", ".lmstudio/models", "Downloaded local models.", "caution"),
    ("AI tools", "Cursor", "Library/Application Support/Cursor", "Cursor editor data, caches and extensions.", "caution"),
    ("AI tools", "Windsurf", "Library/Application Support/Windsurf", "Windsurf editor data and caches.", "caution"),
    ("AI tools", "OpenCode", ".local/share/opencode", "OpenCode sessions and data.", "risky"),
    ("Developer caches", "Xcode DerivedData", "Library/Developer/Xcode/DerivedData", "Build output. Rebuilds on the next build.", "safe"),
    ("Developer caches", "Xcode Archives", "Library/Developer/Xcode/Archives", "Archived app builds. Keep ones you may need to resubmit.", "caution"),
    ("Developer caches", "iOS Simulators", "Library/Developer/CoreSimulator/Devices", "Simulator devices and their apps.", "caution"),
    ("Developer caches", "iOS Device Support", "Library/Developer/Xcode/iOS DeviceSupport", "Debug symbols for connected devices. Re-created when needed.", "safe"),
    ("Developer caches", "Swift packages", "Library/Caches/org.swift.swiftpm", "Downloaded Swift packages. Re-downloads on the next build.", "safe"),
    ("Developer caches", "CocoaPods", "Library/Caches/CocoaPods", "Downloaded pods. Re-downloads on pod install.", "safe"),
    ("Developer caches", "Homebrew downloads", "Library/Caches/Homebrew", "Old package downloads. brew cleanup removes them.", "safe"),
    ("Developer caches", "npm cache", ".npm/_cacache", "Downloaded npm packages. Re-downloads when needed.", "safe"),
    ("Developer caches", "pnpm store", "Library/pnpm/store", "Shared pnpm packages. Re-downloads when needed.", "safe"),
    ("Developer caches", "Yarn cache", "Library/Caches/Yarn", "Downloaded Yarn packages.", "safe"),
    ("Developer caches", "Bun cache", ".bun/install/cache", "Downloaded Bun packages.", "safe"),
    ("Developer caches", "pip cache", "Library/Caches/pip", "Downloaded Python packages.", "safe"),
    ("Developer caches", "uv cache", ".cache/uv", "Downloaded Python packages (uv).", "safe"),
    ("Developer caches", "Conda packages", ".conda/pkgs", "Downloaded Conda packages.", "safe"),
    ("Developer caches", "Cargo registry", ".cargo/registry", "Downloaded Rust crates. Re-downloads on the next build.", "safe"),
    ("Developer caches", "Go modules", "go/pkg/mod", "Downloaded Go modules.", "safe"),
    ("Developer caches", "Go build cache", "Library/Caches/go-build", "Go build output.", "safe"),
    ("Developer caches", "Gradle", ".gradle/caches", "Gradle dependencies and build cache.", "safe"),
    ("Developer caches", "Maven", ".m2/repository", "Downloaded Maven dependencies.", "safe"),
    ("Developer caches", "Android emulators", ".android/avd", "Android virtual devices.", "caution"),
    ("Developer caches", "Flutter / Dart", ".pub-cache", "Downloaded Dart packages.", "safe"),
    ("Developer caches", "JetBrains caches", "Library/Caches/JetBrains", "IDE indexes and caches.", "safe"),
    ("Developer caches", "Playwright browsers", "Library/Caches/ms-playwright", "Test browsers. Re-installed with playwright install.", "safe"),
    ("Developer caches", "VS Code caches", "Library/Application Support/Code/CachedData", "VS Code's cached data.", "safe"),
    ("Developer caches", "Trash", ".Trash", "Files waiting in the Trash.", "safe"),
];

/// Size of a folder in bytes, as `du` counts it (fast, native, doesn't follow links). None if missing.
fn size(path: &Path) -> Option<u64> {
    if !path.exists() {
        return None;
    }
    let out = std::process::Command::new("du").args(["-sk"]).arg(path).output().ok()?;
    // du exits non-zero when some files are unreadable; its total is still right for the rest.
    String::from_utf8_lossy(&out.stdout).split_whitespace().next()?.parse::<u64>().ok().map(|k| k * 1024)
}

/// Sizes many folders at once (each `du` runs in its own thread).
fn sizes(paths: Vec<PathBuf>) -> Vec<Option<u64>> {
    let handles: Vec<_> = paths.into_iter().map(|p| std::thread::spawn(move || size(&p))).collect();
    handles.into_iter().map(|h| h.join().ok().flatten()).collect()
}

/// Scans `home`: known AI and developer locations, then the biggest folders directly in it and in
/// ~/Library. Takes from seconds to a minute or two on a full disk; run off the UI thread.
/// Folders macOS guards with a permission prompt (other apps' data, Mail, Messages, Safari, Photos
/// and so on). Reading their size makes macOS ask once per app, so the scan never enters them.
const PROTECTED: &[&str] = &[
    "Library/Containers", "Library/Group Containers", "Library/Daemon Containers", "Library/Mail", "Library/Messages",
    "Library/Safari", "Library/Calendars", "Library/Reminders", "Library/HomeKit", "Library/Cookies", "Library/Biome",
    "Library/Accounts", "Library/Suggestions", "Library/Metadata", "Library/IdentityServices", "Library/PersonalizationPortrait",
    "Library/Mobile Documents", "Library/CloudStorage", "Library/Application Support/AddressBook", "Library/Application Support/CallHistoryDB",
    "Library/Application Support/Knowledge", "Library/Application Support/MobileSync", "Library/Application Support/FileProvider",
    "Pictures", "Music", "Movies", ".Trash",
];

/// Personal folders macOS asks about once each (Files and Folders); scanned only when asked.
const PERSONAL: &[&str] = &["Desktop", "Documents", "Downloads"];

fn skipped(home: &Path, p: &Path, personal: bool) -> bool {
    let Ok(rel) = p.strip_prefix(home) else { return true };
    let rel = rel.to_string_lossy();
    let apple = rel.starts_with("Library/Application Support/com.apple.") || rel.starts_with("Library/Caches/com.apple.");
    apple || PROTECTED.iter().any(|x| rel == *x) || (!personal && PERSONAL.iter().any(|x| rel == *x))
}

pub fn scan(home: &Path, personal: bool) -> Vec<Item> {
    let mut out = vec![];
    let known: Vec<PathBuf> = KNOWN.iter().map(|k| home.join(k.2)).collect();
    for (k, bytes) in KNOWN.iter().zip(sizes(known.clone())) {
        if let Some(b) = bytes.filter(|b| *b >= 1 << 20) {
            out.push(Item { group: k.0, name: k.1.into(), about: k.3, risk: k.4, path: home.join(k.2).to_string_lossy().into(), bytes: b, trash: may_trash(home, &home.join(k.2)) });
        }
    }
    // Biggest folders: home and ~/Library, one level down (hidden ones too; that's where caches hide).
    let mut dirs = vec![];
    // Caches and Application Support are broken down by app: "Caches 21 GB" alone doesn't help.
    for base in [home.to_path_buf(), home.join("Library"), home.join("Library/Caches"), home.join("Library/Application Support")] {
        for e in std::fs::read_dir(&base).into_iter().flatten().flatten() {
            let p = e.path();
            let is_dir = e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink());
            if is_dir && p != home.join("Library") && p != home.join("Library/Caches") && p != home.join("Library/Application Support") && !skipped(home, &p, personal) {
                dirs.push(p);
            }
        }
    }
    let mut big: Vec<(PathBuf, u64)> = dirs.clone().into_iter().zip(sizes(dirs)).filter_map(|(p, b)| Some((p, b?))).filter(|(_, b)| *b >= 1 << 30).collect();
    big.sort_by(|a, b| b.1.cmp(&a.1));
    for (p, b) in big.into_iter().take(20) {
        let name = p.strip_prefix(home).map(|r| format!("~/{}", r.to_string_lossy())).unwrap_or_else(|_| p.to_string_lossy().into());
        let trash = may_trash(home, &p);
        out.push(Item { group: "Biggest folders", name, about: if trash { "An app's cache folder. Usually rebuilt by the app." } else { "" }, risk: if trash { "caution" } else { "" }, path: p.to_string_lossy().into(), bytes: b, trash });
    }
    out.sort_by(|a, b| a.group.cmp(b.group).then(b.bytes.cmp(&a.bytes)));
    out
}

/// Disk alert level for a used fraction: 0 none, 80, or 90 (percent).
pub fn alert_level(used: f64) -> u8 {
    if used >= 0.9 { 90 } else if used >= 0.8 { 80 } else { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_known_and_big_folders_without_touching_them() {
        let home = std::env::temp_dir().join(format!("dt-storage-{}", std::process::id()));
        let npm = home.join(".npm/_cacache");
        std::fs::create_dir_all(&npm).unwrap();
        std::fs::write(npm.join("blob"), vec![1u8; 3 << 20]).unwrap();
        let items = scan(&home, false);
        let n = items.iter().find(|i| i.name == "npm cache").expect("npm cache found");
        assert!(n.bytes >= 3 << 20 && n.risk == "safe" && n.path.ends_with(".npm/_cacache"));
        assert!(npm.join("blob").exists(), "read-only: nothing deleted");
        assert!(!items.iter().any(|i| i.name == "Ollama models"), "missing folders aren't listed");
        std::fs::remove_dir_all(home).ok();
    }

    /// Manual: time a real scan of this computer. cargo test real_scan -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_scan() {
        let t = std::time::Instant::now();
        let items = scan(Path::new(&std::env::var("HOME").unwrap()), false);
        for i in &items {
            println!("{:<17} {:>8.1} GB  {:<8} {}", i.group, i.bytes as f64 / 1e9, i.risk, i.name);
        }
        println!("{} items in {:.1} s", items.len(), t.elapsed().as_secs_f64());
    }

    #[test]
    fn only_caches_can_go_to_the_bin() {
        let home = Path::new("/Users/x");
        assert!(may_trash(home, &home.join(".npm/_cacache")));
        assert!(may_trash(home, &home.join("Library/Caches/Google")));
        assert!(!may_trash(home, &home.join(".claude/projects")), "DeviceTally's own data source");
        assert!(!may_trash(home, &home.join("Desktop")));
        assert!(!may_trash(home, &home.join("Library/Application Support/Google")));
        assert!(!may_trash(home, &home.join("Library/Caches")), "the whole Caches folder");
        assert!(!may_trash(home, &home.join("Library/Caches/../Mail")));
        assert!(!may_trash(home, Path::new("/System/Library/Caches/x")));
    }

    /// Manual: moves an empty scratch folder from ~/Library/Caches to the Bin (it stays there).
    /// cargo test bin_roundtrip -- --ignored
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn bin_roundtrip() {
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let p = home.join("Library/Caches/devicetally-bin-test");
        std::fs::create_dir_all(&p).unwrap();
        assert!(may_trash(&home, &p));
        let url = NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()));
        NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None).expect("moved to the Bin");
        assert!(!p.exists(), "moved out of Caches (macOS doesn't let a terminal list the Bin to check further)");
    }

    #[test]
    fn never_enters_folders_macos_asks_about() {
        let home = Path::new("/Users/x");
        assert!(skipped(home, &home.join("Library/Containers"), true));
        assert!(skipped(home, &home.join("Library/Group Containers"), true));
        assert!(skipped(home, &home.join("Library/Application Support/com.apple.sharedfilelist"), true));
        assert!(skipped(home, &home.join("Desktop"), false), "personal folders only when asked");
        assert!(!skipped(home, &home.join("Desktop"), true));
        assert!(!skipped(home, &home.join("Library/Caches/Google"), false));
        assert!(!skipped(home, &home.join(".npm"), false));
    }

    #[test]
    fn alert_levels() {
        assert_eq!((alert_level(0.5), alert_level(0.85), alert_level(0.95)), (0, 80, 90));
    }
}
