// Package netx is the tracker's HTTP client. When this computer's own lookup gives a server's name
// a fake address (a hosts-file line sending it to 0.0.0.0, ::, or 127.0.0.1), it asks Cloudflare's
// DNS (1.1.1.1, over HTTPS) for the real one and connects there. TLS still checks the server's own
// certificate, so this only routes around the block; it can't connect to the wrong server.
package netx

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// HostsPath is the hosts file (a variable for tests).
var HostsPath = func() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("SystemRoot"), "System32", "drivers", "etc", "hosts")
	}
	return "/etc/hosts"
}()

// Blocked reports whether the hosts file sends host to this computer or nowhere, which is how a
// server gets blocked by hand.
func Blocked(host string) bool {
	f, err := os.Open(HostsPath)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line, _, _ := strings.Cut(sc.Text(), "#")
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		ip := net.ParseIP(fields[0])
		if ip == nil || !(ip.IsLoopback() || ip.IsUnspecified()) {
			continue
		}
		for _, name := range fields[1:] {
			if strings.EqualFold(name, host) {
				return true
			}
		}
	}
	return false
}

// HostOf is the host name in a server URL.
func HostOf(server string) string {
	u, err := url.Parse(server)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// real reports whether any address is usable (not this computer, not "nowhere").
func real(ips []net.IP) bool {
	for _, ip := range ips {
		if !ip.IsLoopback() && !ip.IsUnspecified() {
			return true
		}
	}
	return false
}

var (
	cacheMu sync.Mutex
	cache   = map[string][]string{}
)

// parseDoH reads the IPv4 addresses in a DNS-over-HTTPS JSON answer.
func parseDoH(b []byte) []string {
	var r struct {
		Answer []struct {
			Type int    `json:"type"`
			Data string `json:"data"`
		}
	}
	json.Unmarshal(b, &r)
	var out []string
	for _, a := range r.Answer {
		if a.Type == 1 && net.ParseIP(a.Data) != nil {
			out = append(out, a.Data)
		}
	}
	return out
}

// lookupDoH asks 1.1.1.1 over HTTPS (the certificate is checked for 1.1.1.1 itself).
func lookupDoH(ctx context.Context, host string) []string {
	cacheMu.Lock()
	if ips, ok := cache[host]; ok {
		cacheMu.Unlock()
		return ips
	}
	cacheMu.Unlock()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://1.1.1.1/dns-query?type=A&name="+url.QueryEscape(host), nil)
	req.Header.Set("accept", "application/dns-json")
	res, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	var b []byte
	buf := make([]byte, 8192)
	for {
		n, err := res.Body.Read(buf)
		b = append(b, buf[:n]...)
		if err != nil || len(b) > 64<<10 {
			break
		}
	}
	ips := parseDoH(b)
	if len(ips) > 0 {
		cacheMu.Lock()
		cache[host] = ips
		cacheMu.Unlock()
	}
	return ips
}

// systemLookup is this computer's own lookup (hosts file, then DNS); replaced in tests.
var systemLookup = net.DefaultResolver.LookupIPAddr

func dial(ctx context.Context, network, addr string) (net.Conn, error) {
	d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	host, port, err := net.SplitHostPort(addr)
	if err != nil || net.ParseIP(host) != nil {
		return d.DialContext(ctx, network, addr)
	}
	addrs, lerr := systemLookup(ctx, host)
	ips := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		ips = append(ips, a.IP)
	}
	if lerr == nil && real(ips) {
		return d.DialContext(ctx, network, addr)
	}
	// This computer's lookup failed or sent the name nowhere: the real address from 1.1.1.1.
	for _, ip := range lookupDoH(ctx, host) {
		if c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(ip, port)); err == nil {
			return c, nil
		}
	}
	return d.DialContext(ctx, network, addr)
}

// Client is an HTTP client with the block workaround.
func Client(timeout time.Duration) *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.DialContext = dial
	return &http.Client{Timeout: timeout, Transport: t}
}
