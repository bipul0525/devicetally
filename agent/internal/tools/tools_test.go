package tools

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha512"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestParseGraph(t *testing.T) {
	b, err := os.ReadFile("../../../fixtures/tokscale-graph.json")
	if err != nil {
		t.Fatal(err)
	}
	days, err := parseGraph(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 1 || days[0].Day != "2026-10-02" {
		t.Fatalf("want one day with usage, got %+v", days)
	}
	rows := days[0].Rows
	if len(rows) != 2 { // the row without a model is skipped
		t.Fatalf("rows: %+v", rows)
	}
	if r := rows[0]; r.Tool != "codex" || r.Model != "gpt-6.1-sol" || r.In != 2762 || r.Out != 14 || r.CacheRead != 12160 || r.Messages != 1 {
		t.Fatalf("codex row: %+v", r)
	}
	if r := rows[1]; r.Tool != "opencode" || r.Reasoning != 5 {
		t.Fatalf("opencode row: %+v", r)
	}
}

func tgz(t *testing.T, files map[string]string) []byte {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg})
		tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func TestExtractKeepsOnlyBinFolder(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "out")
	b := tgz(t, map[string]string{
		"package/bin/tokscale":                    "bin",
		"package/bin/libFoundationModels.dylib":   "lib",
		"package/package.json":                    "{}",
		"package/bin/../../escape":                "x",
		"package/bin/nested/../../../../tmp/evil": "x",
	})
	if err := extract(b, dir); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Fatalf("want binary + library only, got %v", entries)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "escape")); err == nil {
		t.Fatal("path traversal escaped the folder")
	}
}

func TestEnsureRefusesWrongIntegrity(t *testing.T) {
	t.Setenv("DEVICETALLY_HOME", t.TempDir())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(tgz(t, map[string]string{"package/bin/tokscale": "tampered"}))
	}))
	defer srv.Close()
	if _, err := Ensure(srv.URL); err == nil {
		t.Fatal("installed a package that failed its integrity check")
	}
	if _, err := os.Stat(binPath()); err == nil {
		t.Fatal("binary written despite failed check")
	}
}

func TestEnsureAcceptsMatchingIntegrity(t *testing.T) {
	t.Setenv("DEVICETALLY_HOME", t.TempDir())
	key := platformKey()
	pkg, ok := packages[key]
	if !ok {
		t.Skip("no package for", key)
	}
	name := "tokscale"
	if filepath.Ext(binPath()) == ".exe" {
		name += ".exe"
	}
	body := tgz(t, map[string]string{"package/bin/" + name: "fake tokscale"})
	sum := sha512.Sum512(body)
	packages[key] = [2]string{pkg[0], "sha512-" + base64.StdEncoding.EncodeToString(sum[:])}
	defer func() { packages[key] = pkg }()
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { asked = r.URL.Path; w.Write(body) }))
	defer srv.Close()
	got, err := Ensure(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if asked != "/dl/tokscale/"+Version+"/"+pkg[0]+".tgz" {
		t.Fatalf("asked the server for %s", asked)
	}
	if b, _ := os.ReadFile(got); string(b) != "fake tokscale" {
		t.Fatal("binary not installed")
	}
}

func TestDetect(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("CODEX_HOME", "")
	t.Setenv("XDG_DATA_HOME", "")
	t.Setenv("KIMI_CODE_HOME", "")
	os.MkdirAll(filepath.Join(home, ".codex", "sessions"), 0o700)
	os.MkdirAll(filepath.Join(home, ".kimi-code", "sessions"), 0o700)
	got := Detect()
	if len(got) != 2 || got[0] != "codex" || got[1] != "kimi" {
		t.Fatalf("got %v", got)
	}
}
