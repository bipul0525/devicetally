package netx

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestBlockedByHostsFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "hosts")
	os.WriteFile(p, []byte("127.0.0.1 localhost\n127.0.0.1       dibbo.yupcha.work\n0.0.0.0 devicetally.example.workers.dev\n:: devicetally.example.workers.dev # blocked\n10.0.0.5 intranet.example\n"), 0o600)
	HostsPath = p
	if !Blocked("devicetally.example.workers.dev") || !Blocked("DeviceTally.Example.Workers.dev") {
		t.Fatal("0.0.0.0 / :: lines block the server")
	}
	if Blocked("intranet.example") || Blocked("other.workers.dev") {
		t.Fatal("a real address or another name isn't a block")
	}
	if HostOf("https://devicetally.example.workers.dev/") != "devicetally.example.workers.dev" {
		t.Fatal("host of a server URL")
	}
}

func TestRealAddresses(t *testing.T) {
	if real([]net.IP{net.ParseIP("0.0.0.0"), net.ParseIP("::"), net.ParseIP("127.0.0.1")}) {
		t.Fatal("fake addresses aren't real")
	}
	if !real([]net.IP{net.ParseIP("::"), net.ParseIP("104.21.1.1")}) {
		t.Fatal("one real address is enough")
	}
	ips := parseDoH([]byte(`{"Status":0,"Answer":[{"name":"x","type":5,"data":"y."},{"name":"y","type":1,"data":"104.21.1.1"}]}`))
	if len(ips) != 1 || ips[0] != "104.21.1.1" {
		t.Fatalf("DNS-over-HTTPS answer: %v", ips)
	}
}

// Live (DEVICETALLY_LIVE=<server URL>): with this computer's lookup sending the server to 0.0.0.0,
// as Dibbya's hosts file did, the client still reaches it, with its own certificate checked.
func TestReachesServerDespiteHostsBlock(t *testing.T) {
	server := os.Getenv("DEVICETALLY_LIVE")
	if server == "" {
		t.Skip("set DEVICETALLY_LIVE to a server URL")
	}
	systemLookup = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("0.0.0.0")}}, nil
	}
	res, err := Client(20 * 1e9).Get(server + "/api/meta")
	if err != nil {
		t.Fatalf("blocked lookup: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
}
