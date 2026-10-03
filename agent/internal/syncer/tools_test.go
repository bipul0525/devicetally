package syncer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"devicetally/agent/internal/filter"
	"devicetally/agent/internal/state"
	"devicetally/agent/internal/tools"
)

func TestRunToolsSendsEnabledToolsOnce(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script as fake tokscale")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CODEX_HOME", "")
	t.Setenv("XDG_DATA_HOME", "")
	t.Setenv("KIMI_CODE_HOME", "")
	t.Setenv("DEVICETALLY_HOME", filepath.Join(home, ".devicetally"))
	os.MkdirAll(filepath.Join(home, ".codex", "sessions"), 0o700)
	os.MkdirAll(filepath.Join(home, ".kimi", "sessions"), 0o700)

	// Fake tokscale: records its arguments and environment, prints the fixture.
	bin := filepath.Join(state.Dir(), "tokscale", tools.Version, "tokscale")
	os.MkdirAll(filepath.Dir(bin), 0o700)
	fixture, _ := filepath.Abs("../../../fixtures/tokscale-graph.json")
	argsLog := filepath.Join(home, "args")
	os.WriteFile(bin, []byte("#!/bin/sh\necho \"$* PRICING=$TOKSCALE_PRICING_CACHE_ONLY\" >> "+argsLog+"\ncat "+fixture+"\n"), 0o700)

	var mu sync.Mutex
	var posts []toolsUpload
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var u toolsUpload
		json.NewDecoder(r.Body).Decode(&u)
		mu.Lock()
		posts = append(posts, u)
		mu.Unlock()
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	c := &Client{Server: srv.URL, Key: "k", Version: "test"}
	cfg := &Config{DeviceID: "d1", Settings: byteSettings(`{"tools":{"codex":true,"opencode":true}}`)}
	st, _ := state.Load()

	if err := RunTools(st, c, cfg); err != nil {
		t.Fatal(err)
	}
	if len(posts) != 2 || strings.Join(posts[0].Seen, ",") != "codex,kimi" {
		t.Fatalf("first post should report the tools found: %+v", posts)
	}
	// opencode is enabled but not on this machine; kimi is here but not enabled: only codex is read.
	if got := posts[1]; strings.Join(got.Tools, ",") != "codex" || len(got.Days) != 1 {
		t.Fatalf("snapshot: %+v", got)
	}
	args, _ := os.ReadFile(argsLog)
	if !strings.Contains(string(args), "graph --no-spinner -c codex PRICING=1") || strings.Contains(string(args), "--since") {
		t.Fatalf("first run must read all history with pricing downloads off: %q", args)
	}

	// Second run: same data, nothing new is sent, and only recent days are read.
	if err := RunTools(st, c, cfg); err != nil {
		t.Fatal(err)
	}
	if len(posts) != 2 {
		t.Fatalf("unchanged snapshot was re-sent: %d posts", len(posts))
	}
	args, _ = os.ReadFile(argsLog)
	if !strings.Contains(string(args), "--since") {
		t.Fatalf("later runs should only read recent days: %q", args)
	}
}

func byteSettings(global string) []filter.ScopedSettings {
	return []filter.ScopedSettings{{Scope: "global", JSON: json.RawMessage(global)}}
}
