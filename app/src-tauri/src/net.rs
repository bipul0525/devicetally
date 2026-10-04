//! Network panel details beyond speeds (like Stats' Network module): connectivity history with
//! latency and jitter, DNS servers, apps using the network, and the public address.

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

/// One connectivity check: the time to open a connection to 1.1.1.1 (ms), None when it failed.
/// A TCP connection needs no special permission (a ping would need a raw socket).
pub fn probe() -> Option<f32> {
    let addr: SocketAddr = "1.1.1.1:443".parse().ok()?;
    let t = Instant::now();
    TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).ok()?;
    Some(t.elapsed().as_secs_f32() * 1000.0)
}

/// The last 90 checks, oldest first.
#[derive(Default)]
pub struct Connectivity {
    pub checks: VecDeque<Option<f32>>,
}

impl Connectivity {
    pub fn push(&mut self, r: Option<f32>) {
        self.checks.push_back(r);
        while self.checks.len() > 90 {
            self.checks.pop_front();
        }
    }
    /// Average latency and jitter (average change between consecutive successful checks), ms.
    pub fn latency(&self) -> (Option<f32>, Option<f32>) {
        let ok: Vec<f32> = self.checks.iter().flatten().copied().collect();
        if ok.is_empty() {
            return (None, None);
        }
        let avg = ok.iter().sum::<f32>() / ok.len() as f32;
        let jitter = (ok.len() > 1).then(|| ok.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / (ok.len() - 1) as f32);
        (Some(avg), jitter)
    }
}

/// DNS servers in use (macOS and Linux keep them in /etc/resolv.conf).
pub fn dns() -> Vec<String> {
    std::fs::read_to_string("/etc/resolv.conf")
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().strip_prefix("nameserver").map(|s| s.trim().to_string()))
        .take(3)
        .collect()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct NetProc {
    pub name: String,
    pub down: f64, // bytes per second
    pub up: f64,
}

/// Apps using the network now (macOS nettop), busiest first. Rates are the change since the last
/// call, so the first call returns nothing.
#[derive(Default)]
pub struct Apps {
    last: Option<(Instant, HashMap<String, (u64, u64)>)>,
}

impl Apps {
    pub fn top(&mut self, n: usize) -> Vec<NetProc> {
        let Ok(out) = std::process::Command::new("/usr/bin/nettop").args(["-P", "-L", "1", "-n", "-x", "-J", "bytes_in,bytes_out"]).output() else { return vec![] };
        self.from_csv(&String::from_utf8_lossy(&out.stdout), Instant::now(), n)
    }

    fn from_csv(&mut self, csv: &str, now: Instant, n: usize) -> Vec<NetProc> {
        let cur = parse(csv);
        let mut list = vec![];
        if let Some((t, prev)) = &self.last {
            let secs = now.duration_since(*t).as_secs_f64().max(0.5);
            for (k, (i, o)) in &cur {
                let (pi, po) = prev.get(k).copied().unwrap_or((*i, *o));
                let (down, up) = (i.saturating_sub(pi) as f64 / secs, o.saturating_sub(po) as f64 / secs);
                if down + up > 0.0 {
                    let name = k.rsplit_once('.').map(|(a, _)| a).unwrap_or(k).to_string();
                    list.push(NetProc { name, down, up });
                }
            }
        }
        self.last = Some((now, cur));
        list.sort_by(|a, b| (b.down + b.up).total_cmp(&(a.down + a.up)));
        list.truncate(n);
        list
    }
}

/// "name.pid,bytes_in,bytes_out," lines, keyed by name.pid.
fn parse(csv: &str) -> HashMap<String, (u64, u64)> {
    csv.lines()
        .skip(1)
        .filter_map(|l| {
            let mut f = l.split(',');
            let k = f.next()?.to_string();
            Some((k, (f.next()?.parse().ok()?, f.next()?.parse().ok()?)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_rates_come_from_the_change_between_calls() {
        let mut a = Apps::default();
        let t = Instant::now();
        assert!(a.from_csv(",bytes_in,bytes_out,\nGoogle Chrome H.12,1000,500,\nmDNSResponder.204,10,10,\n", t, 5).is_empty(), "first call: no rates yet");
        let r = a.from_csv(",bytes_in,bytes_out,\nGoogle Chrome H.12,3000,1500,\nmDNSResponder.204,10,10,\n", t + Duration::from_secs(2), 5);
        assert_eq!(r, vec![NetProc { name: "Google Chrome H".into(), down: 1000.0, up: 500.0 }], "idle apps left out, pid dropped");
    }

    #[test]
    fn latency_and_jitter() {
        let mut c = Connectivity::default();
        for r in [Some(10.0), None, Some(20.0), Some(30.0)] {
            c.push(r);
        }
        assert_eq!(c.latency(), (Some(20.0), Some(10.0)));
        for _ in 0..100 {
            c.push(None);
        }
        assert_eq!(c.checks.len(), 90);
    }
}
