//! The one menu-bar item, composed by the user (docs/dev/PLAN-onboarding.md): any of tokens, network,
//! CPU, CPU temperature, memory, disk, battery and clock, in one of three layouts (side by side,
//! stacked two per column, or label above value). Each item can have its own label style (text, icon
//! or none), size and colours; the clock its own format. Values keep a fixed width so the menu bar
//! doesn't shift as numbers change. Drawn as a template image (macOS tints it) unless a colour is set.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct MenuBar {
    pub items: Vec<String>, // order matters: tokens, net, cpu, temp, mem, disk, battery, clock
    pub layout: String,     // "row" | "stacked" | "top" (label above value)
    pub size: String,       // "tiny" | "small" | "normal"
    pub spacing: String,    // "tight" | "normal" | "loose"
    pub labels: bool,
    pub net_stack: bool,    // network up over down in one column, in any layout
    /// Text size as a multiple of the standard size, 0.7 to 1.3 (slider). 0 = use `size`.
    pub scale: f32,
    /// Space between items in points, 1 to 12 (slider). 0 = use `spacing`.
    pub gap: f32,
    /// Space between items in points, 0 to 12; replaces `gap` (which couldn't express 0).
    pub gap_pt: Option<f32>,
    pub weight: String,      // "regular" | "medium" | "bold"
    pub font: String,        // a key of FONTS
    pub label_color: String, // "" = follow the menu bar (template image), or "#rrggbb"
    pub value_color: String,
    /// Per item (key = item name): overrides of the settings above.
    pub styles: BTreeMap<String, ItemStyle>,
    pub clock: Clock,
    /// Widest the item may be, in points (0 = 360). macOS hides a menu-bar item that doesn't fit
    /// at all, so items are dropped from the end instead.
    pub max_width: f32,
    /// Agent status dot (working / needs you / done), and alerts when that changes.
    pub status_dot: bool,
    pub alerts: Alerts,
    /// All items in one menu-bar item (one popover), instead of one menu-bar item each.
    pub combined: bool,
    /// Agent status ring in state colours (orange, red, green) instead of the menu bar's colour.
    pub ring_color: bool,
}

/// Banners and sounds for agent status, each event on its own. Sound "" = none, else a macOS
/// system sound name (Glass, Ping…).
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct Alerts {
    pub done_banner: bool,
    pub done_sound: String, // the chosen sound, kept while the sound is off
    pub done_sound_on: bool,
    pub wait_banner: bool,
    pub wait_sound: String,
    pub wait_sound_on: bool,
    /// No "finished" alert for tasks shorter than this (quick replies need no ping).
    pub min_seconds: u32,
    /// A notification when the disk passes 80% and 90% full.
    pub disk: bool,
}

impl Alerts {
    /// The sound to play for an event, if its sound is on.
    pub fn sound(&self, waiting: bool) -> Option<&str> {
        let (on, name) = if waiting { (self.wait_sound_on, &self.wait_sound) } else { (self.done_sound_on, &self.done_sound) };
        (on && !name.is_empty()).then_some(name.as_str())
    }
}

impl Default for Alerts {
    fn default() -> Self {
        Alerts { done_banner: true, done_sound: "Glass".into(), done_sound_on: true, wait_banner: true, wait_sound: "Ping".into(), wait_sound_on: true, min_seconds: 20, disk: true }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(default)]
pub struct ItemStyle {
    pub label: String,       // "" = follow `labels` | "text" | "icon" | "none"
    pub color: String,       // number colour, "" = the general one
    pub label_color: String, // label or icon colour, "" = the general one
    pub scale: f32,          // 0 = same as the rest, else 0.7 to 1.4 times
    pub layout: String,      // "" = the general layout | "row" | "stacked" | "top"
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(default)]
pub struct Clock {
    pub hour12: bool,
    pub ampm: bool,
    pub weekday: bool, // Sat
    pub day: bool,     // 4
    pub month: bool,   // Oct
}

impl Clock {
    /// chrono format, e.g. "Sat 4 Oct 1:05 PM".
    pub fn format(&self) -> String {
        let mut f = vec![];
        if self.weekday { f.push("%a"); }
        if self.day { f.push("%-d"); }
        if self.month { f.push("%b"); }
        f.push(if self.hour12 { if self.ampm { "%-I:%M %p" } else { "%-I:%M" } } else { "%H:%M" });
        f.join(" ")
    }
}

impl MenuBar {
    pub fn scale(&self) -> f32 {
        if self.scale > 0.0 {
            return self.scale.clamp(0.7, 1.3);
        }
        match self.size.as_str() { "tiny" => 0.85, "normal" => 1.2, _ => 1.0 }
    }
    /// Gap between items in px at 2x.
    pub fn gap_px(&self) -> f32 {
        if let Some(g) = self.gap_pt {
            return g.clamp(0.0, 12.0) * 2.0;
        }
        if self.gap > 0.0 {
            return self.gap.clamp(1.0, 12.0) * 2.0;
        }
        match self.spacing.as_str() { "tight" => 6.0, "loose" => 18.0, _ => 11.0 }
    }
    /// Custom colours make a coloured image; otherwise a template image that macOS tints.
    pub fn max_width_px(&self) -> usize {
        (if self.max_width > 0.0 { self.max_width.clamp(60.0, 1000.0) } else { 360.0 } * 2.0) as usize
    }
    pub fn colored(&self) -> bool {
        !self.label_color.is_empty() || !self.value_color.is_empty() || self.styles.iter().any(|(k, s)| self.items.contains(k) && (!s.color.is_empty() || !s.label_color.is_empty()))
    }
}

impl Default for MenuBar {
    fn default() -> Self {
        MenuBar {
            // First launch: three items, normal size and spacing, the menu bar's own colour.
            items: vec!["agent".into(), "net".into(), "temp".into()], layout: "row".into(), size: "small".into(), spacing: "normal".into(), labels: true, net_stack: true, scale: 1.2, gap: 0.0,
            gap_pt: None, weight: "regular".into(), font: "system".into(), label_color: String::new(), value_color: String::new(), styles: BTreeMap::new(), clock: Clock::default(), max_width: 0.0, status_dot: false, alerts: Alerts::default(), combined: false, ring_color: false,
        }
    }
}

/// Small drawn symbols, used instead of a text label.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Icon {
    Battery(f32, bool), // charge 0..1, charging
    Cpu,
    Temp,
    Mem,
    Disk,
    Tokens,
    Clock,
    Dot([u8; 3]), // the Claude Code status dot, in its own colour
    BatteryIn(f32, bool), // battery with the percentage inside (charge 0..1, charging)
    /// Agent status: a ring (working, turning with `phase` 0..7), a red "!" (needs you), a green ✓
    /// (done) or a grey ring (idle). Drawn in its own colours.
    AgentRing(Agent, u8, Option<[u8; 3]>), // colour None = the menu bar's own colour (shapes only)
}

/// What coding agents are doing on this computer, most urgent first.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Agent {
    Idle,
    Working,
    Waiting,
    Done,
}

impl Agent {
    pub fn rgb(self) -> [u8; 3] {
        match self { Agent::Waiting => [0xff, 0x45, 0x3a], Agent::Working => [0xff, 0x9f, 0x0a], Agent::Done => [0x30, 0xd1, 0x58], Agent::Idle => [0x8e, 0x8e, 0x93] }
    }
    fn word(self) -> &'static str {
        match self { Agent::Waiting => "Needs you", Agent::Working => "Working", Agent::Done => "Done", Agent::Idle => "Idle" }
    }
}

/// One drawn piece: an optional small label (text or icon) and a value, with its own size and colours.
pub struct Unit {
    pub kind: &'static str,
    pub label: String,
    pub icon: Option<Icon>,
    pub value: String,
    /// The widest value this item can show, so its slot never changes width.
    pub template: String,
    pub scale: f32,
    pub color: Option<[u8; 3]>,
    pub label_color: Option<[u8; 3]>,
    pub layout: String,
}

impl Unit {
    fn has_label(&self) -> bool {
        self.icon.is_some() || !self.label.is_empty()
    }
}

pub struct Values {
    /// Coding agents: the most urgent state and how many sessions are in it.
    pub agent: (Agent, u8),
    /// Animation step for the working ring (0..7).
    pub tick: u8,
    pub tokens: Option<String>,
    pub stats: crate::stats::Stats,
    pub now: chrono::NaiveDateTime,
}

/// The menu-bar pieces for a configuration. Network is two pieces (up, then down).
pub fn units(cfg: &MenuBar, v: &Values) -> Vec<Unit> {
    let s = &v.stats;
    let none = ItemStyle::default();
    let mut out = vec![];
    for item in &cfg.items {
        let st = cfg.styles.get(item).unwrap_or(&none);
        let mode = match st.label.as_str() { "text" | "icon" | "none" => st.label.as_str(), _ => if cfg.labels { "text" } else { "none" } };
        let vc = rgb(&st.color).or(rgb(&cfg.value_color));
        let lc = rgb(&st.label_color).or(rgb(&cfg.label_color));
        let scale = if st.scale > 0.0 { st.scale.clamp(0.7, 1.4) } else { 1.0 };
        let layout = match st.layout.as_str() { "row" | "stacked" | "top" => st.layout.clone(), _ => cfg.layout.clone() };
        let top = layout == "top"; // label on top has room for whole words
        let mut push = |kind: &'static str, short: &str, full: &str, icon: Option<Icon>, value: String, template: &str| {
            let (label, icon) = match mode {
                "icon" if icon.is_some() => (String::new(), icon),
                "icon" | "text" => ((if top { full } else { short }).to_string(), None),
                _ => (String::new(), None),
            };
            out.push(Unit { kind, label, icon, value, template: template.into(), scale, color: vc.or(lc), label_color: lc.or(vc), layout: layout.clone() });
        };
        match item.as_str() {
            "tokens" => push("tokens", "T", "TOKENS", Some(Icon::Tokens), v.tokens.clone().unwrap_or_else(|| "–".into()), "888M"),
            "net" => {
                // Arrows are the icon; "none" hides them.
                push("net", "↑", "↑", None, crate::stats::rate(s.net_up), "888K");
                push("net", "↓", "↓", None, crate::stats::rate(s.net_down), "888K");
            }
            "cpu" => push("pct", "CPU", "CPU", Some(Icon::Cpu), format!("{}%", s.cpu.round() as u32), "100%"),
            "temp" => {
                if let Some(t) = s.cpu_temp {
                    push("temp", "TEMP", "CPU TEMP", Some(Icon::Temp), format!("{}°", t.round() as u32), "100°");
                }
            }
            "mem" => push("pct", "MEM", "MEMORY", Some(Icon::Mem), format!("{}%", if s.mem_total > 0 { (s.mem_used * 100 / s.mem_total) as u32 } else { 0 }), "100%"),
            "disk" => {
                push("disk", "SSD", "DISK", Some(Icon::Disk), crate::stats::bytes(s.disk_free), "888M");
                // A filling disk shows itself: orange from 80% used, red from 90% (unless a colour is set).
                let used = if s.disk_total > 0 { 1.0 - s.disk_free as f64 / s.disk_total as f64 } else { 0.0 };
                let warn = if used >= 0.9 { Some([0xff, 0x45, 0x3a]) } else if used >= 0.8 { Some([0xff, 0x9f, 0x0a]) } else { None };
                if let (Some(w), Some(u)) = (warn, out.last_mut()) {
                    if vc.is_none() {
                        u.color = Some(w);
                    }
                }
            }
            "agent" => {
                let (a, n) = v.agent;
                let unit = |icon, value: String| Unit { kind: "agent", label: String::new(), icon: Some(icon), value, template: String::new(), scale, color: vc, label_color: lc, layout: "row".into() };
                // "text" (or the older "icon"): the ring and a short word; otherwise the ring alone.
                let word = matches!(st.label.as_str(), "text" | "icon");
                // State colours are optional; by default the ring uses the menu bar's own colour and
                // the shapes alone tell the states apart (turning ring, !, ✓).
                let own = cfg.ring_color.then(|| a.rgb());
                let mut u = unit(Icon::AgentRing(a, v.tick % 8, own), if word { if n > 1 { format!("{} {n}", a.word()) } else { a.word().into() } } else { String::new() });
                if u.color.is_none() {
                    u.color = own;
                }
                out.push(u);
            }
            "battery" if st.label == "inside" => {
                if let Some(b) = s.battery {
                    out.push(Unit { kind: "battery", label: String::new(), icon: Some(Icon::BatteryIn(b / 100.0, s.charging)), value: String::new(), template: String::new(), scale, color: vc.or(lc), label_color: lc.or(vc), layout: "row".into() });
                }
            }
            "battery" => {
                if let Some(b) = s.battery {
                    let short = if s.charging { "⚡" } else { "BAT" };
                    push("pct", short, if s.charging { "⚡" } else { "BATTERY" }, Some(Icon::Battery(b / 100.0, s.charging)), format!("{}%", b.round() as u32), "100%");
                }
            }
            "clock" => {
                let f = cfg.clock.format();
                // Widest case: a long weekday and month, two-digit day and hour.
                let wide = chrono::NaiveDate::from_ymd_opt(2026, 9, 30).unwrap().and_hms_opt(22, 58, 0).unwrap();
                let (value, template) = (v.now.format(&f).to_string(), wide.format(&f).to_string());
                // The clock has no text label; it can have an icon.
                let icon = (mode == "icon").then_some(Icon::Clock);
                out.push(Unit { kind: "clock", label: String::new(), icon, value, template, scale, color: vc.or(lc), label_color: lc.or(vc), layout });
            }
            _ => {}
        }
    }
    out
}

/// Plain text for tooltips (Windows/Linux trays can't show text next to the icon).
pub fn text(units: &[Unit]) -> String {
    units.iter().map(|u| if u.label.is_empty() { u.value.clone() } else { format!("{} {}", u.label, u.value) }).collect::<Vec<_>>().join("  ")
}

/// "#rrggbb" to RGB.
pub fn rgb(hex: &str) -> Option<[u8; 3]> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let b = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([b(0)?, b(2)?, b(4)?])
}

/// A column in the menu bar: one line, or two lines (stacked / network / label on top).
enum Block<'a> {
    One(&'a Unit),
    Two(&'a Unit, &'a Unit),
    LabelTop(&'a Unit),
}

fn blocks<'a>(cfg: &MenuBar, units: &'a [Unit]) -> Vec<Block<'a>> {
    let _ = &cfg.layout; // per-unit layouts are resolved in units()
    let mut out = vec![];
    let mut pending: Option<&Unit> = None; // stacked layout pairs consecutive non-network units
    let mut i = 0;
    while i < units.len() {
        let u = &units[i];
        if u.kind == "net" && cfg.net_stack && i + 1 < units.len() && units[i + 1].kind == "net" {
            if let Some(p) = pending.take() {
                out.push(Block::One(p));
            }
            out.push(Block::Two(u, &units[i + 1]));
            i += 2;
            continue;
        }
        // Each item's own layout; "stacked" pairs it with the next stacked item.
        if u.layout != "stacked" {
            if let Some(p) = pending.take() {
                out.push(Block::One(p));
            }
        }
        match u.layout.as_str() {
            "stacked" => match pending.take() {
                Some(p) => out.push(Block::Two(p, u)),
                None => pending = Some(u),
            },
            "top" if u.has_label() => out.push(Block::LabelTop(u)),
            _ => out.push(Block::One(u)),
        }
        i += 1;
    }
    if let Some(p) = pending {
        out.push(Block::One(p));
    }
    out
}

/// Icon width for an icon `h` px high.
fn icon_w(icon: Icon, h: f32) -> f32 {
    match icon {
        Icon::Battery(..) => h * 1.9,
        Icon::Temp => h * 0.6,
        Icon::Mem => h * 1.25,
        Icon::Disk => h * 1.15,
        Icon::Dot(_) => h * 0.7,
        Icon::BatteryIn(..) => h * 2.4,
        Icon::AgentRing(..) => h * 1.15,
        _ => h,
    }
}

/// The status dot as a unit of its own.
pub fn status_unit(rgb: [u8; 3]) -> Unit {
    Unit { kind: "status", label: String::new(), icon: Some(Icon::Dot(rgb)), value: String::new(), template: String::new(), scale: 1.0, color: None, label_color: None, layout: "row".into() }
}

/// The SF Symbol for an icon (the set macOS's own menu bar uses).
fn symbol_name(icon: Icon) -> String {
    match icon {
        Icon::Battery(_, true) => "battery.100percent.bolt".into(),
        Icon::Battery(l, false) => format!("battery.{}percent", ((l.clamp(0.0, 1.0) * 4.0).round() as u32) * 25),
        Icon::Cpu => "cpu".into(),
        Icon::Temp => "thermometer.medium".into(),
        Icon::Mem => "memorychip".into(),
        Icon::Disk => "internaldrive".into(),
        Icon::Tokens => "sparkle".into(),
        Icon::Clock => "clock".into(),
        Icon::Dot(_) | Icon::BatteryIn(..) | Icon::AgentRing(..) => String::new(),
    }
}

fn dist2(px: f32, py: f32, (x, y): (f32, f32)) -> f32 {
    ((px - x).powi(2) + (py - y).powi(2)).sqrt()
}

/// Icons stand as tall as the digits next to them.
fn icon_h(vpx: f32) -> f32 {
    (vpx * 0.85).round()
}

#[cfg(target_os = "macos")]
struct Canvas<'f> {
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    font: &'f str,
    weight: &'f str,
}

#[cfg(target_os = "macos")]
impl Canvas<'_> {
    /// Width of `text` as macOS lays it out.
    fn width(&self, text: &str, px: f32) -> f32 {
        crate::symbols::text(text, px, self.font, self.weight).map(|t| t.width).unwrap_or(0.0)
    }

    fn put(&mut self, x: i32, y: i32, cov: u8, rgb: [u8; 3]) {
        if x >= 0 && y >= 0 && (x as usize) < self.width && (y as usize) < self.height && cov > 0 {
            let i = (y as usize * self.width + x as usize) * 4;
            if cov >= self.rgba[i + 3] {
                self.rgba[i..i + 3].copy_from_slice(&rgb);
                self.rgba[i + 3] = cov;
            }
        }
    }

    /// Draws text (drawn by macOS) with its baseline at `baseline` in `rgb`, coverage as alpha.
    fn text(&mut self, text: &str, px: f32, x: f32, baseline: i32, rgb: [u8; 3]) {
        let Some(t) = crate::symbols::text(text, px, self.font, self.weight) else { return };
        let (ox, oy) = (x.round() as i32, (baseline as f32 - t.baseline).round() as i32);
        for r in 0..t.mask.h {
            for c in 0..t.mask.w {
                self.put(ox + c as i32, oy + r as i32, t.mask.alpha[r * t.mask.w + c], rgb);
            }
        }
    }

    /// Fills the shape `inside(x, y)` within the box, antialiased (4×4 samples per pixel).
    fn fill(&mut self, (x0, y0, x1, y1): (f32, f32, f32, f32), rgb: [u8; 3], inside: impl Fn(f32, f32) -> bool) {
        for py in (y0.floor() as i32)..(y1.ceil() as i32) {
            for px in (x0.floor() as i32)..(x1.ceil() as i32) {
                let mut n = 0;
                for sy in 0..4 {
                    for sx in 0..4 {
                        if inside(px as f32 + (sx as f32 + 0.5) / 4.0, py as f32 + (sy as f32 + 0.5) / 4.0) {
                            n += 1;
                        }
                    }
                }
                self.put(px, py, (n * 255 / 16) as u8, rgb);
            }
        }
    }

    /// Width of an icon `h` px high: the SF Symbol's, or the drawn fallback's.
    fn icon_w(&self, icon: Icon, h: f32) -> f32 {
        if matches!(icon, Icon::Dot(_)) {
            return icon_w(icon, h);
        }
        if let Icon::BatteryIn(level, charging) = icon {
            return self.battery_in_w(level, charging, h);
        }
        if let Icon::AgentRing(..) = icon {
            return icon_w(icon, h).round();
        }
        match crate::symbols::symbol(&symbol_name(icon), h.round() as usize, self.weight) {
            Some(m) => m.w as f32,
            None => icon_w(icon, h),
        }
    }

    /// An icon `h` px high, bottom at `bottom`: the SF Symbol, or a drawn shape if it's missing.
    fn icon(&mut self, icon: Icon, x: f32, bottom: f32, h: f32, rgb: [u8; 3]) {
        if let Icon::BatteryIn(level, charging) = icon {
            return self.battery_in(level, charging, x, bottom, h, rgb);
        }
        if let Icon::AgentRing(a, phase, own) = icon {
            return self.agent_ring(a, phase, x, bottom, h, own.unwrap_or(rgb), own.is_none());
        }
        if let Icon::Dot(own) = icon {
            let (r, cx, cy) = (h * 0.35, x + h * 0.35, bottom - h / 2.0);
            self.fill((cx - r, cy - r, cx + r, cy + r), own, |px, py| (px - cx).powi(2) + (py - cy).powi(2) <= r * r);
            return;
        }
        if let Some(m) = crate::symbols::symbol(&symbol_name(icon), h.round() as usize, self.weight) {
            let (ox, oy) = (x.round() as i32, (bottom - m.h as f32).round() as i32);
            for r in 0..m.h {
                for c in 0..m.w {
                    self.put(ox + c as i32, oy + r as i32, m.alpha[r * m.w + c], rgb);
                }
            }
            return;
        }
        self.drawn_icon(icon, x, bottom, h, rgb)
    }

    /// Fallback shapes (an SF Symbol missing on an older macOS).
    fn drawn_icon(&mut self, icon: Icon, x: f32, bottom: f32, h: f32, rgb: [u8; 3]) {
        let w = icon_w(icon, h);
        let t = (h * 0.12).max(1.6); // stroke
        let top = bottom - h;
        let bx = (x, top, x + w, bottom);
        let rect = |l: f32, tp: f32, r: f32, b: f32| move |px: f32, py: f32| px >= l && px < r && py >= tp && py < b;
        let outline = |l: f32, tp: f32, r: f32, b: f32| move |px: f32, py: f32| rect(l, tp, r, b)(px, py) && !rect(l + t, tp + t, r - t, b - t)(px, py);
        let circle = |cx: f32, cy: f32, r: f32| move |px: f32, py: f32| (px - cx).powi(2) + (py - cy).powi(2) <= r * r;
        match icon {
            Icon::Dot(_) | Icon::BatteryIn(..) | Icon::AgentRing(..) => {}
            Icon::Battery(level, _) => {
                let (bt, bb) = (top + h * 0.18, bottom - h * 0.12);
                let body_r = x + w - h * 0.16;
                let fill_r = x + 2.0 * t + (body_r - x - 4.0 * t) * level.clamp(0.0, 1.0);
                let nub = rect(body_r, bt + (bb - bt) * 0.3, x + w, bb - (bb - bt) * 0.3);
                let body = outline(x, bt, body_r, bb);
                let charge = rect(x + 2.0 * t, bt + 2.0 * t, fill_r, bb - 2.0 * t);
                self.fill(bx, rgb, |px, py| body(px, py) || nub(px, py) || charge(px, py));
            }
            Icon::Cpu => {
                let m = h * 0.2;
                let body = outline(x + m, top + m, x + w - m, bottom - m);
                let core = rect(x + h * 0.38, top + h * 0.38, x + w - h * 0.38, bottom - h * 0.38);
                let pins = move |px: f32, py: f32| {
                    let near = |v: f32, a: f32| [0.3, 0.5, 0.7].iter().any(|f| (v - (a + h * f)).abs() < t * 0.45);
                    let (ix, iy) = (px - x, py - top);
                    ((ix < m || ix > w - m) && near(py, top)) || ((iy < m || iy > h - m) && near(px, x))
                };
                self.fill(bx, rgb, |px, py| body(px, py) || core(px, py) || pins(px, py));
            }
            Icon::Temp => {
                let cx = x + w / 2.0;
                let r = w * 0.48;
                let cy = bottom - r;
                let sw = w * 0.42;
                let stem_out = rect(cx - sw / 2.0, top, cx + sw / 2.0, cy);
                let stem_in = rect(cx - sw / 2.0 + t, top + t, cx + sw / 2.0 - t, cy);
                let mercury = rect(cx - t * 0.5, top + h * 0.35, cx + t * 0.5, cy);
                let bulb = circle(cx, cy, r);
                self.fill(bx, rgb, |px, py| (stem_out(px, py) && !stem_in(px, py)) || mercury(px, py) || bulb(px, py));
            }
            Icon::Mem => {
                let (bt, bb) = (top + h * 0.2, bottom - h * 0.25);
                let body = outline(x, bt, x + w, bb);
                let chips = move |px: f32, py: f32| py > bt + 2.0 * t && py < bb - 2.0 * t && [0.2, 0.43, 0.66].iter().any(|f| px > x + w * f && px < x + w * (f + 0.14));
                let pins = move |px: f32, py: f32| py >= bb && py < bottom && ((px - x) / (w / 6.0)).fract() < 0.45 && px > x + t && px < x + w - t;
                self.fill(bx, rgb, |px, py| body(px, py) || chips(px, py) || pins(px, py));
            }
            Icon::Disk => {
                let body = outline(x, top + h * 0.15, x + w, bottom - h * 0.1);
                let led = circle(x + w - h * 0.32, bottom - h * 0.36, t * 0.9);
                let slot = rect(x + h * 0.22, bottom - h * 0.36 - t / 2.0, x + w * 0.55, bottom - h * 0.36 + t / 2.0);
                self.fill(bx, rgb, |px, py| body(px, py) || led(px, py) || slot(px, py));
            }
            Icon::Tokens => {
                // Four-point sparkle.
                let (cx, cy, r) = (x + w / 2.0, top + h / 2.0, h / 2.0);
                self.fill(bx, rgb, |px, py| ((px - cx).abs() / r).sqrt() + ((py - cy).abs() / r).sqrt() <= 1.0);
            }
            Icon::Clock => {
                let (cx, cy, r) = (x + w / 2.0, top + h / 2.0, h / 2.0);
                let ring = move |px: f32, py: f32| circle(cx, cy, r)(px, py) && !circle(cx, cy, r - t)(px, py);
                let hand_v = rect(cx - t / 2.0, cy - r * 0.62, cx + t / 2.0, cy + t / 2.0);
                let hand_h = rect(cx - t / 2.0, cy - t / 2.0, cx + r * 0.5, cy + t / 2.0);
                self.fill(bx, rgb, |px, py| ring(px, py) || hand_v(px, py) || hand_h(px, py));
            }
        }
    }

    /// Battery with the percentage inside: body height and text size for an icon `h` px high.
    fn battery_in_dims(&self, level: f32, h: f32) -> (f32, f32, String, f32) {
        let body_h = (h * 1.3).round().min(30.0);
        let tpx = (body_h * 0.74).round();
        let num = format!("{}", (level.clamp(0.0, 1.0) * 100.0).round() as u32);
        let tw = crate::symbols::text(&num, tpx, "system", "bold").map(|t| t.width).unwrap_or(tpx * 1.6);
        let body_w = (tw + 7.0).max(body_h * 1.75).round();
        (body_h, tpx, num, body_w)
    }

    fn battery_in_w(&self, level: f32, charging: bool, h: f32) -> f32 {
        let (body_h, _, _, body_w) = self.battery_in_dims(level, h);
        let bolt = if charging { crate::symbols::symbol("bolt.fill", (body_h * 0.8) as usize, "bold").map(|m| m.w as f32 + 2.0).unwrap_or(0.0) } else { 0.0 };
        body_w + 3.0 + bolt
    }

    /// Draws the battery: a faint rounded outline and nub, the charge filled in solid, and the
    /// percentage cut out of the fill (drawn solid where it falls on the empty part), like iOS.
    fn battery_in(&mut self, level: f32, charging: bool, x: f32, bottom: f32, h: f32, rgb: [u8; 3]) {
        let (body_h, tpx, num, body_w) = self.battery_in_dims(level, h);
        let cy = bottom - h / 2.0;
        let (l, t, r, b) = (x.round(), (cy - body_h / 2.0).round(), (x + body_w).round(), (cy + body_h / 2.0).round());
        let rad = body_h * 0.28;
        let inside = move |px: f32, py: f32, l: f32, t: f32, r: f32, b: f32, rad: f32| {
            let cx = px.clamp(l + rad, r - rad);
            let cy = py.clamp(t + rad, b - rad);
            px >= l && px <= r && py >= t && py <= b && (px - cx).powi(2) + (py - cy).powi(2) <= rad * rad
        };
        let faint = |c: u8| (c as f32 * 0.45) as u8;
        // Outline (1.5 px) and nub, faint.
        let mut layer = vec![0u8; self.width * self.height];
        let w = self.width;
        let paint = |layer: &mut Vec<u8>, bx: (f32, f32, f32, f32), f: &dyn Fn(f32, f32) -> bool| {
            for py in (bx.1.floor() as i32).max(0)..(bx.3.ceil() as i32).min(self.height as i32) {
                for px in (bx.0.floor() as i32).max(0)..(bx.2.ceil() as i32).min(w as i32) {
                    let mut n = 0;
                    for sy in 0..4 {
                        for sx in 0..4 {
                            if f(px as f32 + (sx as f32 + 0.5) / 4.0, py as f32 + (sy as f32 + 0.5) / 4.0) {
                                n += 1;
                            }
                        }
                    }
                    let i = py as usize * w + px as usize;
                    layer[i] = layer[i].max((n * 255 / 16) as u8);
                }
            }
        };
        let s = 1.5;
        paint(&mut layer, (l, t, r, b), &|px, py| inside(px, py, l, t, r, b, rad) && !inside(px, py, l + s, t + s, r - s, b - s, (rad - s).max(0.5)));
        let (nt, nb) = (cy - body_h * 0.18, cy + body_h * 0.18);
        paint(&mut layer, (r + 0.5, nt, r + 3.0, nb), &|px, py| px >= r + 0.5 && px <= r + 2.5 && py >= nt && py <= nb);
        let outline: Vec<u8> = layer.iter().map(|&a| faint(a)).collect();
        // Charge fill, solid.
        let mut fill = vec![0u8; self.width * self.height];
        let g = 2.5;
        let fr = l + g + (body_w - 2.0 * g) * level.clamp(0.0, 1.0);
        paint(&mut fill, (l, t, r, b), &|px, py| px <= fr && inside(px, py, l + g, t + g, r - g, b - g, (rad - g).max(0.5)));
        // Percentage, centred, cut out of the fill.
        let mut txt = vec![0u8; self.width * self.height];
        if let Some(tm) = crate::symbols::text(&num, tpx, "system", "bold") {
            let ox = (l + (body_w - tm.width) / 2.0).round() as i32;
            let base = (cy + tpx * 0.36).round();
            let oy = (base - tm.baseline).round() as i32;
            for rr in 0..tm.mask.h {
                for cc in 0..tm.mask.w {
                    let (px, py) = (ox + cc as i32, oy + rr as i32);
                    if px >= 0 && py >= 0 && (px as usize) < w && (py as usize) < self.height {
                        txt[py as usize * w + px as usize] = tm.mask.alpha[rr * tm.mask.w + cc];
                    }
                }
            }
        }
        for i in 0..layer.len() {
            let f = fill[i] as f32 / 255.0;
            let tx = txt[i] as f32 / 255.0;
            // Text knocks a hole in the fill and is solid on the empty part.
            let a = (f * (1.0 - tx) + tx * (1.0 - f)).max(outline[i] as f32 / 255.0 * (1.0 - tx));
            if a > 0.0 {
                self.put((i % w) as i32, (i / w) as i32, (a * 255.0) as u8, rgb);
            }
        }
        if charging {
            if let Some(m) = crate::symbols::symbol("bolt.fill", (body_h * 0.8) as usize, "bold") {
                let (bx0, by0) = ((r + 5.0).round() as i32, (cy - m.h as f32 / 2.0).round() as i32);
                for rr in 0..m.h {
                    for cc in 0..m.w {
                        self.put(bx0 + cc as i32, by0 + rr as i32, m.alpha[rr * m.w + cc], rgb);
                    }
                }
            }
        }
    }

    /// Alpha-blends a pixel over what's there (white marks on a coloured disc).
    fn blend(&mut self, x: i32, y: i32, cov: u8, rgb: [u8; 3]) {
        if x < 0 || y < 0 || x as usize >= self.width || y as usize >= self.height || cov == 0 {
            return;
        }
        let i = (y as usize * self.width + x as usize) * 4;
        let (a, b) = (cov as f32 / 255.0, self.rgba[i + 3] as f32 / 255.0);
        let out = a + b * (1.0 - a);
        for k in 0..3 {
            self.rgba[i + k] = ((rgb[k] as f32 * a + self.rgba[i + k] as f32 * b * (1.0 - a)) / out.max(1e-6)) as u8;
        }
        self.rgba[i + 3] = (out * 255.0) as u8;
    }

    /// The agent status ring, `h` px high (a little taller than digits, so it reads at a glance).
    #[allow(clippy::too_many_arguments)]
    fn agent_ring(&mut self, a: Agent, phase: u8, x: f32, bottom: f32, h: f32, col: [u8; 3], mono: bool) {
        let d = (h * 1.15).round();
        let (cx, cy, r) = (x + d / 2.0, bottom - h / 2.0, d / 2.0);
        let t = (d * 0.17).max(2.2);
        let bx = (cx - r - 1.0, cy - r - 1.0, cx + r + 1.0, cy + r + 1.0);
        let dist = move |px: f32, py: f32| ((px - cx).powi(2) + (py - cy).powi(2)).sqrt();
        match a {
            Agent::Idle => self.fill_alpha(bx, col, if mono { 0.55 } else { 1.0 }, |px, py| (dist(px, py) - (r - t / 2.0)).abs() <= t / 2.0),
            Agent::Working => {
                // A faint full ring, and a bright 3/4 arc whose gap turns a step each redraw.
                let faint = [col[0], col[1], col[2]];
                self.fill_alpha(bx, faint, 0.32, |px, py| (dist(px, py) - (r - t / 2.0)).abs() <= t / 2.0);
                let start = phase as f32 * std::f32::consts::FRAC_PI_4;
                self.fill(bx, col, |px, py| {
                    let on_ring = (dist(px, py) - (r - t / 2.0)).abs() <= t / 2.0;
                    let ang = ((py - cy).atan2(px - cx) - start).rem_euclid(std::f32::consts::TAU);
                    on_ring && ang < std::f32::consts::TAU * 0.72
                });
            }
            Agent::Waiting | Agent::Done => {
                self.fill(bx, col, |px, py| dist(px, py) <= r);
                // White mark: "!" or ✓, antialiased by supersampling.
                let seg = |px: f32, py: f32, (x1, y1): (f32, f32), (x2, y2): (f32, f32)| {
                    let (dx, dy) = (x2 - x1, y2 - y1);
                    let k = (((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
                    ((px - x1 - k * dx).powi(2) + (py - y1 - k * dy).powi(2)).sqrt()
                };
                let w = d * 0.13;
                let p = |fx: f32, fy: f32| (cx - r + d * fx, cy - r + d * fy);
                let mark: Box<dyn Fn(f32, f32) -> bool> = if a == Agent::Waiting {
                    Box::new(move |px, py| seg(px, py, p(0.5, 0.24), p(0.5, 0.56)) <= w / 2.0 || dist2(px, py, p(0.5, 0.74)) <= w * 0.62)
                } else {
                    Box::new(move |px, py| seg(px, py, p(0.27, 0.52), p(0.43, 0.68)) <= w / 2.0 || seg(px, py, p(0.43, 0.68), p(0.74, 0.34)) <= w / 2.0)
                };
                for py in (bx.1.floor() as i32)..(bx.3.ceil() as i32) {
                    for px in (bx.0.floor() as i32)..(bx.2.ceil() as i32) {
                        let mut n = 0;
                        for sy in 0..4 {
                            for sx in 0..4 {
                                if mark(px as f32 + (sx as f32 + 0.5) / 4.0, py as f32 + (sy as f32 + 0.5) / 4.0) {
                                    n += 1;
                                }
                            }
                        }
                        let cov = (n * 255 / 16) as u8;
                        if mono {
                            // Shapes only: the mark is cut out of the disc, so the menu bar shows through.
                            self.knock(px, py, cov);
                        } else {
                            self.blend(px, py, cov, [255, 255, 255]);
                        }
                    }
                }
            }
        }
    }

    /// Removes coverage (cuts a shape out of what's drawn).
    fn knock(&mut self, x: i32, y: i32, cov: u8) {
        if x >= 0 && y >= 0 && (x as usize) < self.width && (y as usize) < self.height && cov > 0 {
            let i = (y as usize * self.width + x as usize) * 4 + 3;
            self.rgba[i] = (self.rgba[i] as u32 * (255 - cov as u32) / 255) as u8;
        }
    }

    /// Like `fill`, at a fraction of full opacity.
    fn fill_alpha(&mut self, bx: (f32, f32, f32, f32), rgb: [u8; 3], a: f32, inside: impl Fn(f32, f32) -> bool) {
        for py in (bx.1.floor() as i32)..(bx.3.ceil() as i32) {
            for px in (bx.0.floor() as i32)..(bx.2.ceil() as i32) {
                let mut n = 0;
                for sy in 0..4 {
                    for sx in 0..4 {
                        if inside(px as f32 + (sx as f32 + 0.5) / 4.0, py as f32 + (sy as f32 + 0.5) / 4.0) {
                            n += 1;
                        }
                    }
                }
                self.put(px, py, ((n * 255 / 16) as f32 * a) as u8, rgb);
            }
        }
    }

    /// Width of a unit's label (text or icon) plus the space after it, or 0.
    fn label_w(&self, u: &Unit, lpx: f32, vpx: f32) -> f32 {
        match u.icon {
            Some(i @ Icon::BatteryIn(..)) => self.icon_w(i, icon_h(vpx)),
            Some(i @ Icon::AgentRing(..)) if u.value.is_empty() => self.icon_w(i, icon_h(vpx)),
            Some(i @ Icon::Dot(_)) if u.value.is_empty() => self.icon_w(i, icon_h(vpx)),
            Some(i) => self.icon_w(i, icon_h(vpx)) + 4.0,
            None if !u.label.is_empty() => self.width(&u.label, lpx) + 3.0,
            None => 0.0,
        }
    }

    /// Label (or icon) at the left. The value either follows it (single lines: the fixed slot is
    /// spare room after it) or is right-aligned in the block (two-line columns, so numbers line up).
    #[allow(clippy::too_many_arguments)]
    fn line(&mut self, u: &Unit, x: f32, block_w: f32, baseline: i32, vpx: f32, lpx: f32, raise: i32, right: bool, fg: [u8; 3]) {
        let pen = x + self.label_w(u, lpx, vpx);
        let lc = u.label_color.unwrap_or(fg);
        match u.icon {
            Some(i) => self.icon(i, x, baseline as f32, icon_h(vpx), lc),
            None if !u.label.is_empty() => self.text(&u.label, lpx, x, baseline + raise, lc),
            None => {}
        }
        let vw = self.width(&u.value, vpx);
        self.text(&u.value, vpx, if right { x + block_w - vw } else { pen }, baseline, u.color.unwrap_or(fg));
    }
}

/// Fonts every Mac has (keys; symbols::ns_font maps them to macOS fonts; the app lists the same).
#[cfg(test)]
pub const FONTS: [&str; 12] = ["system", "rounded", "mono", "newyork", "helvetica", "menlo", "monaco", "din", "futura", "avenir", "georgia", "verdana"];

/// RGBA image, 36 px high = 18 pt menu bar at 2x. Items without their own colour are drawn in `fg`
/// (only the alpha matters for a template image).
#[cfg(target_os = "macos")]
pub fn render(cfg: &MenuBar, units: &[Unit], fg: [u8; 3]) -> Option<(Vec<u8>, u32, u32)> {
    let height = 36usize;
    // Font sizes in px at 2x, scaled by the slider and the item's own size: one-line value/label,
    // two-line value/label. Capped so two lines always fit the 18 pt menu bar.
    let k = cfg.scale();
    let one = |u: &Unit| ((20.0 * k * u.scale).min(28.0), (13.0 * k * u.scale).min(17.0));
    let two = |u: &Unit| ((14.5 * k * u.scale).min(17.0), (11.0 * k * u.scale).min(13.0));
    let gap = cfg.gap_px();
    let mut canvas = Canvas { rgba: vec![], width: 0, height, font: &cfg.font, weight: &cfg.weight };
    let bl = blocks(cfg, units);
    if bl.is_empty() {
        return None;
    }
    let bw: Vec<f32> = {
        let c = &canvas;
        let slot = |u: &Unit, px: f32| c.width(&u.value, px).max(c.width(&u.template, px));
        let line_w = |u: &Unit, (vpx, lpx): (f32, f32)| c.label_w(u, lpx, vpx) + slot(u, vpx);
        bl.iter()
            .map(|b| match b {
                Block::One(u) => line_w(u, one(u)),
                Block::Two(a, d) => line_w(a, two(a)).max(line_w(d, two(d))),
                Block::LabelTop(u) => {
                    let (v, l) = two(u);
                    top_label_w(c, u, l).max(slot(u, v + 3.0))
                }
            })
            .collect()
    };
    let width = (bw.iter().sum::<f32>() + gap * (bl.len() - 1) as f32).ceil() as usize + 4;
    canvas.rgba = vec![0u8; width * height * 4];
    canvas.width = width;
    let center = |px: f32| {
        let (a, d) = crate::symbols::metrics(&cfg.font, px, &cfg.weight);
        ((height as f32 - (a + d)) / 2.0 + a).round() as i32
    };
    // Two-line baselines in 36 px: the bottom line sits on the bottom edge, the top one a line above.
    let bottom = 34;
    let mut x = 2.0_f32;
    for (b, bwid) in bl.iter().zip(&bw) {
        match b {
            Block::One(u) => {
                let (v, l) = one(u);
                canvas.line(u, x, *bwid, center(v), v, l, -7, false, fg)
            }
            Block::Two(a, d) => {
                let (va, la) = two(a);
                let (vd, ld) = two(d);
                let top = (bottom as f32 - vd * 1.05).round() as i32;
                canvas.line(a, x, *bwid, top, va, la, 0, true, fg);
                canvas.line(d, x, *bwid, bottom, vd, ld, 0, true, fg);
            }
            Block::LabelTop(u) => {
                // Label (or icon) and value centred over each other in the column.
                let (v, l) = two(u);
                let v = v + 3.0;
                let (lw, vw) = (top_label_w(&canvas, u, l), canvas.width(&u.value, v));
                let label_base = (bottom as f32 - v * 1.05).round() as i32;
                let lc = u.label_color.unwrap_or(fg);
                match u.icon {
                    Some(i) => canvas.icon(i, x + (bwid - lw) / 2.0, label_base as f32, l * 1.1, lc),
                    None => canvas.text(&u.label, l, x + (bwid - lw) / 2.0, label_base, lc),
                }
                canvas.text(&u.value, v, x + (bwid - vw) / 2.0, bottom, u.color.unwrap_or(fg));
            }
        }
        x += bwid + gap;
    }
    Some((canvas.rgba, width as u32, height as u32))
}

/// Renders as many items as fit in `max_width`, dropping from the end, so the menu-bar item never
/// grows so wide that macOS hides it. Returns the image and how many items were left out.
#[cfg(target_os = "macos")]
pub fn render_fit(cfg: &MenuBar, units: &[Unit], fg: [u8; 3]) -> (Option<(Vec<u8>, u32, u32)>, usize) {
    let max = cfg.max_width_px() as u32;
    let mut n = units.len();
    loop {
        let img = render(cfg, &units[..n], fg);
        match &img {
            Some((_, w, _)) if *w > max && n > 1 => n -= 1,
            _ => return (img, units.len() - n),
        }
    }
}

/// Width of the small label (or icon) above the value in the "label on top" layout.
#[cfg(target_os = "macos")]
fn top_label_w(c: &Canvas, u: &Unit, lpx: f32) -> f32 {
    match u.icon {
        Some(i) => c.icon_w(i, lpx * 1.1),
        None => c.width(&u.label, lpx),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn values() -> Values {
        Values {
            agent: (Agent::Done, 1),
            tick: 0,
            tokens: Some("151M".into()),
            stats: crate::stats::Stats { cpu: 23.4, mem_used: 6, mem_total: 10, disk_free: 212_000_000_000, net_down: 1_260_000.0, net_up: 48_000.0, battery: Some(82.0), charging: false, cpu_temp: Some(47.4), ..Default::default() },
            now: chrono::NaiveDate::from_ymd_opt(2026, 10, 4).unwrap().and_hms_opt(14, 5, 0).unwrap(),
        }
    }

    #[test]
    fn first_launch_is_three_plain_items() {
        let d = MenuBar::default();
        assert_eq!(d.items, ["agent", "net", "temp"]);
        assert!(!d.combined && !d.ring_color && !d.colored(), "separate items, menu-bar colour only");
        assert!(d.scale() >= 1.2, "normal size, not tiny");
    }

    #[test]
    fn colors_parse() {
        assert_eq!(rgb("#33c759"), Some([0x33, 0xc7, 0x59]));
        assert_eq!(rgb(""), None);
        assert_eq!(rgb("#zz0000"), None);
    }

    #[test]
    fn composes_the_chosen_items_in_order() {
        let cfg = MenuBar { items: vec!["net".into(), "battery".into(), "tokens".into(), "temp".into()], ..Default::default() };
        let u = units(&cfg, &values());
        assert_eq!(u.iter().map(|x| format!("{}{}", x.label, x.value)).collect::<Vec<_>>(), ["↑48K", "↓1.3M", "BAT82%", "T151M", "TEMP47°"]);
        let top = MenuBar { layout: "top".into(), ..cfg.clone() };
        assert_eq!(units(&top, &values()).iter().map(|x| x.label.as_str()).collect::<Vec<_>>(), ["↑", "↓", "BATTERY", "TOKENS", "CPU TEMP"], "label on top spells words out");
        let bare = MenuBar { labels: false, ..cfg };
        assert!(units(&bare, &values()).iter().all(|u| u.label.is_empty()), "labels off hides arrows too, like the owner's example");
    }

    #[test]
    fn each_item_has_its_own_style() {
        let mut cfg = MenuBar { items: vec!["battery".into(), "cpu".into()], value_color: "#ffffff".into(), ..Default::default() };
        cfg.styles.insert("battery".into(), ItemStyle { label: "icon".into(), color: "#34c759".into(), scale: 1.2, ..Default::default() });
        cfg.styles.insert("cpu".into(), ItemStyle { label: "none".into(), ..Default::default() });
        let u = units(&cfg, &values());
        assert_eq!(u[0].icon, Some(Icon::Battery(0.82, false)));
        assert_eq!(u[0].color, Some([0x34, 0xc7, 0x59]));
        assert_eq!(u[0].scale, 1.2);
        assert!(u[1].label.is_empty() && u[1].icon.is_none());
        assert_eq!(u[1].color, Some([255, 255, 255]), "falls back to the general colour");
        assert!(cfg.colored());
    }

    #[test]
    fn each_item_can_have_its_own_layout() {
        let mut cfg = MenuBar { items: vec!["cpu".into(), "mem".into(), "clock".into()], ..Default::default() };
        cfg.styles.insert("cpu".into(), ItemStyle { layout: "top".into(), ..Default::default() });
        let u = units(&cfg, &values());
        assert_eq!(u[0].layout, "top");
        assert_eq!(u[0].label, "CPU");
        assert_eq!(u[1].layout, "row");
        let b = blocks(&cfg, &u);
        assert!(matches!(b[0], Block::LabelTop(_)) && matches!(b[1], Block::One(_)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn too_many_items_drop_from_the_end_instead_of_vanishing() {
        let all = ["tokens", "net", "cpu", "temp", "mem", "disk", "battery", "clock"];
        let cfg = MenuBar { items: all.iter().map(|s| s.to_string()).collect(), clock: Clock { weekday: true, day: true, month: true, hour12: true, ampm: true }, max_width: 120.0, ..Default::default() };
        let u = units(&cfg, &values());
        let (img, hidden) = render_fit(&cfg, &u, [0; 3]);
        let (_, w, _) = img.unwrap();
        assert!(w <= 240, "fits in 120 pt, got {} pt", w / 2);
        assert!(hidden > 0);
    }

    #[test]
    fn clock_formats() {
        let v = values();
        let clock = |c: Clock| units(&MenuBar { items: vec!["clock".into()], clock: c, ..Default::default() }, &v).remove(0);
        assert_eq!(clock(Clock::default()).value, "14:05");
        assert_eq!(clock(Clock { hour12: true, ampm: true, ..Default::default() }).value, "2:05 PM");
        let full = clock(Clock { hour12: true, ampm: true, weekday: true, day: true, month: true });
        assert_eq!(full.value, "Sun 4 Oct 2:05 PM");
        assert_eq!(full.template, "Wed 30 Sep 10:58 PM");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn widths_stay_fixed_and_layouts_save_space() {
        let width = |cfg: &MenuBar, v: &Values| render(cfg, &units(cfg, v), [0; 3]).unwrap().1;
        let mut quiet = values();
        quiet.stats.net_up = 0.0;
        quiet.stats.net_down = 0.0;
        quiet.stats.cpu = 3.0;
        let mut busy = values();
        busy.stats.net_up = 888_000.0;
        busy.stats.net_down = 888_000.0;
        busy.stats.cpu = 100.0;
        for layout in ["row", "stacked", "top"] {
            let cfg = MenuBar { items: vec!["net".into(), "cpu".into()], layout: layout.into(), ..Default::default() };
            assert_eq!(width(&cfg, &quiet), width(&cfg, &busy), "{layout}: the menu bar doesn't shift as numbers change");
        }
        let net = |stack: bool| MenuBar { items: vec!["net".into()], net_stack: stack, ..Default::default() };
        assert!(width(&net(true), &busy) < width(&net(false), &busy), "network stacked is narrower");
        let cpu_disk = |layout: &str| MenuBar { items: vec!["cpu".into(), "disk".into()], layout: layout.into(), ..Default::default() };
        assert!(width(&cpu_disk("top"), &busy) < width(&cpu_disk("row"), &busy), "label on top is narrower than side by side");
        let gap = |g: f32| MenuBar { items: vec!["cpu".into(), "disk".into()], gap_pt: Some(g), ..Default::default() };
        assert!(width(&gap(0.0), &busy) < width(&gap(1.0), &busy), "spacing can go down to 0");
        let weight = |s: &str| MenuBar { items: vec!["cpu".into()], weight: s.into(), ..Default::default() };
        assert!(width(&weight("bold"), &busy) > width(&weight("regular"), &busy));
        let size = |s: &str| MenuBar { items: vec!["tokens".into()], size: s.into(), scale: 0.0, ..Default::default() };
        assert!(width(&size("tiny"), &busy) < width(&size("small"), &busy) && width(&size("small"), &busy) < width(&size("normal"), &busy));
        let mut big = MenuBar { items: vec!["cpu".into()], ..Default::default() };
        let normal_w = width(&big, &busy);
        big.styles.insert("cpu".into(), ItemStyle { scale: 1.3, ..Default::default() });
        assert!(width(&big, &busy) > normal_w, "an item can be made larger on its own");
    }
}

#[cfg(all(test, target_os = "macos"))]
mod stress {
    use super::*;

    /// Every layout × size extreme × spacing extreme × label style × item mix: never panics, always fits 36 px.
    #[test]
    fn every_setting_combination_renders() {
        let mut v = tests::values();
        v.stats = crate::stats::Stats { cpu: 100.0, mem_used: 9, mem_total: 10, disk_free: 1_500_000_000_000, net_down: 999_000_000.0, net_up: 0.0, battery: Some(100.0), charging: true, cpu_temp: Some(105.0), ..Default::default() };
        let all = ["agent", "tokens", "net", "cpu", "temp", "mem", "disk", "battery", "clock"];
        let mut n = 0;
        for layout in ["row", "stacked", "top"] {
            for scale in [0.7, 1.3] {
                for gap in [0.0, 12.0] {
                    for label in ["text", "icon", "none"] {
                        for net_stack in [true, false] {
                            for k in 0..=all.len() {
                                let items: Vec<String> = all[..k].iter().map(|s| s.to_string()).collect();
                                for (fi, (weight, item_scale)) in [("regular", 0.0), ("medium", 1.4), ("bold", 0.7)].into_iter().enumerate() {
                                    let font = FONTS[(fi + k) % FONTS.len()];
                                    let styles = items.iter().map(|i| (i.clone(), ItemStyle { label: label.into(), scale: item_scale, color: "#33c759".into(), ..Default::default() })).collect();
                                    let clock = Clock { hour12: true, ampm: true, weekday: true, day: true, month: true };
                                    let cfg = MenuBar { items: items.clone(), layout: layout.into(), scale, gap_pt: Some(gap), net_stack, font: font.into(), weight: weight.into(), styles, clock, ..Default::default() };
                                    if let Some((rgba, w, h)) = render(&cfg, &units(&cfg, &v), [0; 3]) {
                                        assert_eq!(h, 36);
                                        assert_eq!(rgba.len(), (w * h * 4) as usize);
                                    }
                                    n += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
        assert!(n > 500);
    }

    #[test]
    fn every_font_loads() {
        for key in FONTS {
            assert!(crate::symbols::text("42%", 20.0, key, "regular").is_some(), "{key}");
        }
    }

    #[test]
    fn redraws_are_fast() {
        let v = tests::values();
        let mut cfg = MenuBar { items: vec!["tokens".into(), "net".into(), "cpu".into(), "battery".into(), "clock".into()], ..Default::default() };
        cfg.styles.insert("battery".into(), ItemStyle { label: "icon".into(), ..Default::default() });
        render(&cfg, &units(&cfg, &v), [0; 3]); // first call loads the font
        let t = std::time::Instant::now();
        for _ in 0..200 {
            render(&cfg, &units(&cfg, &v), [0; 3]).unwrap();
        }
        let per = t.elapsed().as_secs_f64() * 1000.0 / 200.0;
        println!("render: {per:.2} ms each");
        assert!(per < 20.0, "a redraw should be cheap, got {per:.1} ms");
    }
}

#[cfg(all(test, target_os = "macos"))]
mod preview {
    use super::*;

    /// Writes example renders for a visual check: ICON_PREVIEW_DIR=… cargo test write_previews
    #[test]
    fn write_previews() {
        let Ok(dir) = std::env::var("ICON_PREVIEW_DIR") else { return };
        let icons = |items: &[&str]| items.iter().map(|i| (i.to_string(), ItemStyle { label: "icon".into(), ..Default::default() })).collect::<BTreeMap<_, _>>();
        let all = ["tokens", "cpu", "temp", "mem", "disk", "battery", "clock"];
        let full = Clock { hour12: true, ampm: true, weekday: true, day: true, month: false };
        let cases = [
            ("1-cpu-ssd-label-on-top", MenuBar { items: vec!["cpu".into(), "disk".into()], layout: "top".into(), ..Default::default() }),
            ("2-net-stacked-no-labels", MenuBar { items: vec!["net".into()], labels: false, ..Default::default() }),
            ("3-row-all-icons", MenuBar { items: all.iter().map(|s| s.to_string()).collect(), styles: icons(&all), clock: full.clone(), ..Default::default() }),
            ("4-top-all-icons", MenuBar { items: all.iter().map(|s| s.to_string()).collect(), layout: "top".into(), styles: icons(&all), ..Default::default() }),
            ("5-top-words-bold", MenuBar { items: vec!["tokens".into(), "cpu".into(), "temp".into(), "mem".into()], layout: "top".into(), weight: "bold".into(), gap_pt: Some(2.0), ..Default::default() }),
            ("7-din-bold-icons", MenuBar { items: vec!["cpu".into(), "temp".into(), "battery".into()], font: "din".into(), weight: "bold".into(), styles: icons(&["cpu", "temp", "battery"]), ..Default::default() }),
            ("8-newyork", MenuBar { items: vec!["tokens".into(), "clock".into()], font: "newyork".into(), ..Default::default() }),
            ("9-futura-top", MenuBar { items: vec!["tokens".into(), "mem".into()], font: "futura".into(), layout: "top".into(), ..Default::default() }),
            ("91-agent-pill", MenuBar { items: vec!["agent".into(), "cpu".into()], ..Default::default() }),
            ("92-agent-text", MenuBar { items: vec!["agent".into(), "cpu".into()], styles: [("agent".to_string(), ItemStyle { label: "text".into(), ..Default::default() })].into_iter().collect(), ..Default::default() }),
            ("90-battery-inside", MenuBar { items: vec!["battery".into(), "clock".into()], styles: [("battery".to_string(), ItemStyle { label: "inside".into(), ..Default::default() })].into_iter().collect(), ..Default::default() }),
            ("6-battery-icon-clock-12h", MenuBar { items: vec!["battery".into(), "clock".into()], styles: icons(&["battery"]), clock: full, ..Default::default() }),
        ];
        for (i, (name, cfg)) in cases.into_iter().enumerate() {
            let mut v = tests::values();
            if name.starts_with("91") || name.starts_with("92") {
                for (st, n, tag) in [(Agent::Working, 1, "a"), (Agent::Waiting, 1, "b"), (Agent::Done, 2, "c"), (Agent::Idle, 0, "d")] {
                    v.agent = (st, n);
                    let (rgba, w, h) = render(&cfg, &units(&cfg, &v), [0; 3]).unwrap();
                    let mut ppm = format!("P6 {w} {h} 255\n").into_bytes();
                    ppm.extend(rgba.chunks(4).flat_map(|p| (0..3).map(move |k| ((p[k] as u32 * p[3] as u32 + 235 * (255 - p[3] as u32)) / 255) as u8)));
                    std::fs::write(format!("{dir}/mb-{name}-{tag}.ppm"), ppm).unwrap();
                }
                continue;
            }
            if name.starts_with("90") {
                for (lvl, ch, tag) in [(82.0, false, "a"), (9.0, false, "b"), (100.0, true, "c"), (45.0, true, "d")] {
                    v.stats.battery = Some(lvl);
                    v.stats.charging = ch;
                    let (rgba, w, h) = render(&cfg, &units(&cfg, &v), [0; 3]).unwrap();
                    let mut ppm = format!("P6 {w} {h} 255\n").into_bytes();
                    ppm.extend(rgba.chunks(4).flat_map(|p| (0..3).map(move |k| ((p[k] as u32 * p[3] as u32 + 235 * (255 - p[3] as u32)) / 255) as u8)));
                    std::fs::write(format!("{dir}/mb-{name}-{tag}.ppm"), ppm).unwrap();
                }
                continue;
            }
            let mut u = units(&cfg, &v);
            if i < 3 {
                u.insert(0, status_unit([[0xff, 0x9f, 0x0a], [0xff, 0x45, 0x3a], [0x30, 0xd1, 0x58]][i]));
            }
            let (rgba, w, h) = render(&cfg, &u, [0; 3]).unwrap();
            // On a light menu bar: blend each pixel's colour over light grey.
            let mut ppm = format!("P6 {w} {h} 255\n").into_bytes();
            ppm.extend(rgba.chunks(4).flat_map(|p| (0..3).map(move |k| ((p[k] as u32 * p[3] as u32 + 235 * (255 - p[3] as u32)) / 255) as u8)));
            std::fs::write(format!("{dir}/mb-{name}.ppm"), ppm).unwrap();
            println!("{name}: {} pt wide", w / 2);
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod demo {
    use super::*;

    /// README images: DEMO_OUT=dir cargo test write_demo -- writes <name>.json (base64 RGBA, light and dark).
    #[test]
    fn write_demo() {
        let Ok(dir) = std::env::var("DEMO_OUT") else { return };
        use base64::Engine;
        let mut v = tests::values();
        v.tokens = Some("48.2M".into());
        v.stats.battery = Some(76.0);
        v.stats.net_up = 312_000.0;
        v.stats.net_down = 2_400_000.0;
        v.stats.cpu = 18.0;
        v.now = chrono::NaiveDate::from_ymd_opt(2026, 10, 9).unwrap().and_hms_opt(9, 41, 0).unwrap();
        let style = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, l)| (k.to_string(), ItemStyle { label: l.to_string(), ..Default::default() })).collect::<BTreeMap<_, _>>();
        let hero = MenuBar { items: ["agent", "tokens", "net", "cpu", "battery", "clock"].map(String::from).to_vec(), styles: style(&[("battery", "inside"), ("cpu", "icon")]), clock: Clock { hour12: true, ampm: true, weekday: true, ..Default::default() }, gap_pt: Some(6.0), ..Default::default() };
        let stats = MenuBar { items: ["net", "cpu", "temp", "mem", "disk"].map(String::from).to_vec(), layout: "top".into(), gap_pt: Some(5.0), ..Default::default() };
        let cases: Vec<(&str, MenuBar, Agent)> = vec![
            ("hero", hero.clone(), Agent::Working),
            ("stats", stats, Agent::Idle),
            ("working", MenuBar { items: vec!["agent".into(), "tokens".into()], ..Default::default() }, Agent::Working),
            ("waiting", MenuBar { items: vec!["agent".into(), "tokens".into()], ..Default::default() }, Agent::Waiting),
            ("done", MenuBar { items: vec!["agent".into(), "tokens".into()], ..Default::default() }, Agent::Done),
        ];
        for (name, cfg, a) in cases {
            v.agent = (a, 1);
            let u = units(&cfg, &v);
            let (light, w, h) = render(&cfg, &u, [0, 0, 0]).unwrap();
            let (dark, _, _) = render(&cfg, &u, [255, 255, 255]).unwrap();
            let b = |x: Vec<u8>| base64::engine::general_purpose::STANDARD.encode(x);
            std::fs::write(format!("{dir}/{name}.json"), format!("{{\"width\":{w},\"height\":{h},\"light\":\"{}\",\"dark\":\"{}\",\"hidden\":0,\"text\":\"\"}}", b(light), b(dark))).unwrap();
        }
    }
}

