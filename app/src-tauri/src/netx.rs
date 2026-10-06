//! The app's DNS: when this computer's own lookup gives a name a fake address (a hosts-file line
//! sending it to 0.0.0.0, :: or 127.0.0.1), ask Cloudflare's DNS (1.1.1.1, over HTTPS) for the real
//! one. TLS still checks the server's certificate. Same as the tracker's netx package.

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::{IpAddr, SocketAddr};

pub struct Resolver;

/// Whether any address is real (not this computer, not "nowhere").
pub fn real(ips: &[IpAddr]) -> bool {
    ips.iter().any(|ip| !ip.is_loopback() && !ip.is_unspecified())
}

/// IPv4 addresses in a DNS-over-HTTPS JSON answer.
pub fn parse_doh(v: &serde_json::Value) -> Vec<IpAddr> {
    v["Answer"].as_array().into_iter().flatten().filter(|a| a["type"] == 1).filter_map(|a| a["data"].as_str()?.parse().ok()).collect()
}

impl Resolve for Resolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let mine: Vec<IpAddr> = tokio::net::lookup_host((host.as_str(), 0)).await.map(|it| it.map(|a| a.ip()).collect()).unwrap_or_default();
            if real(&mine) {
                return Ok(Box::new(mine.into_iter().map(|ip| SocketAddr::new(ip, 0))) as Addrs);
            }
            // Blocked or no answer here: the real address from 1.1.1.1 (a plain client, by IP).
            let doh = async {
                let v: serde_json::Value = reqwest::Client::builder().timeout(std::time::Duration::from_secs(8)).build().ok()?
                    .get(format!("https://1.1.1.1/dns-query?type=A&name={host}")).header("accept", "application/dns-json").send().await.ok()?.json().await.ok()?;
                Some(parse_doh(&v))
            };
            let ips = doh.await.filter(|ips| !ips.is_empty()).unwrap_or(mine);
            Ok(Box::new(ips.into_iter().map(|ip| SocketAddr::new(ip, 0))) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn fake_addresses_and_doh_answers() {
        assert!(!super::real(&["0.0.0.0".parse().unwrap(), "::".parse().unwrap(), "127.0.0.1".parse().unwrap()]));
        assert!(super::real(&["::".parse().unwrap(), "104.21.1.1".parse().unwrap()]));
        let v = serde_json::json!({ "Answer": [{ "type": 5, "data": "y." }, { "type": 1, "data": "104.21.1.1" }] });
        assert_eq!(super::parse_doh(&v), vec!["104.21.1.1".parse::<std::net::IpAddr>().unwrap()]);
    }
}
