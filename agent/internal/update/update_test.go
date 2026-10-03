package update

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func fakeRelease(t *testing.T, bin []byte, sum string) {
	asset := AssetName(runtime.GOOS, runtime.GOARCH)
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/me/devicetally/releases/latest":
			fmt.Fprintf(w, `{"tag_name":"v9.9.9","assets":[{"name":%q,"browser_download_url":"%s/bin"},{"name":"checksums.txt","browser_download_url":"%s/sums"}]}`, asset, srv.URL, srv.URL)
		case "/bin":
			w.Write(bin)
		case "/sums":
			fmt.Fprintf(w, "%s  %s\n%s  other_file\n", sum, asset, sum)
		}
	}))
	t.Cleanup(srv.Close)
	API = srv.URL
}

func TestInstallVerifiesChecksumAndKeepsOldBinary(t *testing.T) {
	bin := []byte("new agent")
	s := sha256.Sum256(bin)
	fakeRelease(t, bin, hex.EncodeToString(s[:]))
	path := filepath.Join(t.TempDir(), "devicetally")
	os.WriteFile(path, []byte("old agent"), 0o700)

	rel, err := Latest("me/devicetally")
	if err != nil || rel.Version != "9.9.9" {
		t.Fatal(rel, err)
	}
	if err := Install(rel, path); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != "new agent" {
		t.Fatalf("not replaced: %s", b)
	}
	if err := Rollback(path); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != "old agent" {
		t.Fatalf("rollback failed: %s", b)
	}
}

func TestRefusesBadChecksum(t *testing.T) {
	fakeRelease(t, []byte("tampered"), "0000000000000000000000000000000000000000000000000000000000000000")
	path := filepath.Join(t.TempDir(), "devicetally")
	os.WriteFile(path, []byte("old agent"), 0o700)
	rel, _ := Latest("me/devicetally")
	if err := Install(rel, path); err == nil {
		t.Fatal("installed a binary with a wrong checksum")
	}
	if b, _ := os.ReadFile(path); string(b) != "old agent" {
		t.Fatal("old binary was touched")
	}
}

func TestFromServer(t *testing.T) {
	r := FromServer("https://dt.example/", "0.3.0")
	if r.Binary != "https://dt.example/dl/"+AssetName(runtime.GOOS, runtime.GOARCH) || r.Sums != "https://dt.example/dl/checksums.txt" || r.Version != "0.3.0" {
		t.Fatalf("%+v", r)
	}
}

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"0.2.0", "0.1.9", true}, {"0.1.0", "0.1.0", false}, {"1.0.0", "0.9.9", true}, {"0.1.10", "0.1.9", true}, {"v0.1.0", "0.2.0", false}} {
		if Newer(c.a, c.b) != c.want {
			t.Errorf("Newer(%s, %s) != %v", c.a, c.b, c.want)
		}
	}
}
