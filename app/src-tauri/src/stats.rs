//! System stats for the menu bar and popover: CPU, memory, disk, network, battery.
//! Read from the OS's own counters (cheap); CPU and network rates need two samples, so a `Sampler`
//! is kept and refreshed on each tick.

use serde::Serialize;
use std::time::Instant;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};

#[derive(Serialize, Clone, Default)]
pub struct Stats {
    pub cpu: f32,          // percent, all cores
    pub mem_used: u64,     // bytes
    pub mem_total: u64,
    pub disk_free: u64,    // bytes, on the system disk
    pub disk_total: u64,
    pub net_down: f64,     // bytes per second
    pub net_up: f64,
    pub battery: Option<f32>, // percent
    pub charging: bool,
    pub cpu_temp: Option<f32>, // °C, hottest CPU sensor
    pub uptime: u64,           // seconds since boot
}

pub struct Sampler {
    sys: System,
    nets: Networks,
    temps: Option<sysinfo::Components>, // read only when the menu bar shows the temperature
    last: Instant,
}

impl Sampler {
    pub fn new() -> Self {
        let sys = System::new_with_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_cpu_usage()).with_memory(MemoryRefreshKind::nothing().with_ram()));
        Sampler { sys, nets: Networks::new_with_refreshed_list(), temps: None, last: Instant::now() }
    }

    /// CPU temperature: the hottest CPU die sensor (Apple Silicon "PMU tdie…", Intel/AMD "CPU…",
    /// "Package…", "Tctl", "coretemp…"). None where the system exposes no such sensor.
    pub fn cpu_temp(&mut self) -> Option<f32> {
        let c = self.temps.get_or_insert_with(sysinfo::Components::new_with_refreshed_list);
        c.refresh(false);
        c.iter()
            .filter(|x| {
                let l = x.label().to_lowercase();
                l.contains("tdie") || l.contains("cpu") || l.contains("package") || l.contains("tctl") || l.contains("coretemp")
            })
            .filter_map(|x| x.temperature())
            .filter(|t| *t > 0.0 && *t < 150.0)
            .reduce(f32::max)
    }

    pub fn sample(&mut self) -> Stats {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.nets.refresh(true);
        let secs = self.last.elapsed().as_secs_f64().max(0.5);
        self.last = Instant::now();
        // Physical interfaces only: loopback and virtual adapters would double-count.
        let (mut down, mut up) = (0u64, 0u64);
        for (name, n) in &self.nets {
            let virtual_if = name.starts_with("lo") || name.starts_with("utun") || name.starts_with("awdl") || name.starts_with("llw")
                || name.starts_with("bridge") || name.starts_with("veth") || name.starts_with("docker") || name.contains("Loopback");
            if !virtual_if {
                down += n.received();
                up += n.transmitted();
            }
        }
        let disks = Disks::new_with_refreshed_list();
        let root = disks.iter().find(|d| {
            let m = d.mount_point().to_string_lossy();
            m == "/" || m == "/System/Volumes/Data" || m.eq_ignore_ascii_case("C:\\")
        });
        let (bat, charging) = battery();
        Stats {
            cpu: self.sys.global_cpu_usage(),
            mem_used: self.sys.used_memory(),
            mem_total: self.sys.total_memory(),
            disk_free: root.map(|d| d.available_space()).unwrap_or(0),
            disk_total: root.map(|d| d.total_space()).unwrap_or(0),
            net_down: down as f64 / secs,
            net_up: up as f64 / secs,
            battery: bat,
            charging,
            cpu_temp: None,
            uptime: System::uptime(),
        }
    }
}

fn battery() -> (Option<f32>, bool) {
    let Ok(m) = starship_battery::Manager::new() else { return (None, false) };
    let Some(Ok(b)) = m.batteries().ok().and_then(|mut it| it.next()) else { return (None, false) };
    let pct = b.state_of_charge().value * 100.0;
    (Some(pct), matches!(b.state(), starship_battery::State::Charging | starship_battery::State::Full))
}

/// Short forms for the menu bar: "1.2M/s" style rates, "45%", "212G".
pub fn rate(bps: f64) -> String {
    let (v, u) = if bps >= 1e9 { (bps / 1e9, "G") } else if bps >= 1e6 { (bps / 1e6, "M") } else if bps >= 1e3 { (bps / 1e3, "K") } else { (bps, "B") };
    if v >= 10.0 || u == "B" { format!("{}{u}", v.round() as u64) } else { format!("{v:.1}{u}") }
}

pub fn bytes(b: u64) -> String {
    let b = b as f64;
    if b >= 1e12 { format!("{:.1}T", b / 1e12) } else if b >= 1e9 { format!("{}G", (b / 1e9).round() as u64) } else { format!("{}M", (b / 1e6).round() as u64) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_forms() {
        assert_eq!(rate(0.0), "0B");
        assert_eq!(rate(1_500.0), "1.5K");
        assert_eq!(rate(12_300_000.0), "12M");
        assert_eq!(bytes(212_000_000_000), "212G");
        assert_eq!(bytes(1_500_000_000_000), "1.5T");
    }

    #[test]
    fn samples_this_machine() {
        let mut s = Sampler::new();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let x = s.sample();
        assert!(x.mem_total > 0 && x.mem_used <= x.mem_total);
        assert!(x.cpu >= 0.0 && x.cpu <= 100.0 + 1e-3);
        assert!(x.disk_total > 0, "system disk found");
    }
}

