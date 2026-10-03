package syncer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"devicetally/agent/internal/state"
)

const sessionID = "11111111-1111-4111-8111-111111111111"

type fakeServer struct {
	mu       sync.Mutex
	batches  []Batch
	fail     bool
	settings string
	approved []string
}

func (f *fakeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("authorization") != "Bearer key" {
		w.WriteHeader(401)
		return
	}
	switch r.URL.Path {
	case "/api/v1/config":
		var acc []string
		for _, a := range f.approved {
			acc = append(acc, `{"uuid":"`+a+`","status":"approved"}`)
		}
		settings := f.settings
		if settings == "" {
			settings = "[]"
		}
		w.Write([]byte(`{"device_id":"d1","accounts":[` + strings.Join(acc, ",") + `],"settings":` + settings + `}`))
	case "/api/v1/ingest":
		if f.fail {
			w.WriteHeader(503)
			return
		}
		var b Batch
		json.NewDecoder(r.Body).Decode(&b)
		f.batches = append(f.batches, b)
		w.Write([]byte(`{}`))
	}
}

func (f *fakeServer) all() (b Batch) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, x := range f.batches {
		b.Accounts = append(b.Accounts, x.Accounts...)
		b.Sessions = append(b.Sessions, x.Sessions...)
		b.Prompts = append(b.Prompts, x.Prompts...)
		b.Turns = append(b.Turns, x.Turns...)
	}
	return
}

// setup makes a Claude config folder holding the fixtures, signed in as account "acct-me".
func setup(t *testing.T, f *fakeServer) (*state.State, *Client, string) {
	t.Setenv("DEVICETALLY_HOME", t.TempDir())
	claude := t.TempDir()
	proj := filepath.Join(claude, "projects", "-home-dev-work-repo")
	os.MkdirAll(filepath.Join(proj, sessionID, "subagents"), 0o700)
	copyFile(t, "session.jsonl", filepath.Join(proj, sessionID+".jsonl"))
	copyFile(t, "subagent.jsonl", filepath.Join(proj, sessionID, "subagents", "agent-ag1.jsonl"))
	os.WriteFile(filepath.Join(claude, ".claude.json"), []byte(`{"oauthAccount":{"accountUuid":"acct-me","emailAddress":"me@work.com","seatTier":"max"}}`), 0o600)
	st, _ := state.Load()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return st, &Client{Server: srv.URL, Key: "key", Version: "0.1.0"}, claude
}

func copyFile(t *testing.T, name, dst string) {
	b, err := os.ReadFile("../../../fixtures/transcripts/" + name)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(dst, b, 0o600)
}

func TestSyncUploadsFilteredData(t *testing.T) {
	f := &fakeServer{approved: []string{"acct-me"}}
	st, c, claude := setup(t, f)
	if _, err := Run(st, c, []string{claude}); err != nil {
		t.Fatal(err)
	}
	b := f.all()
	if len(b.Prompts) != 2 || len(b.Turns) != 4 {
		t.Fatalf("want 2 prompts, 4 turns (3 + 1 subagent); got %d, %d", len(b.Prompts), len(b.Turns))
	}
	if strings.Contains(*b.Prompts[0].Text, "sk-ant-") || !strings.Contains(*b.Prompts[0].Text, "[REDACTED]") {
		t.Fatalf("secret not redacted: %q", *b.Prompts[0].Text)
	}
	sub := 0
	for _, tr := range b.Turns {
		if tr.AccountUUID != "acct-me" {
			t.Fatalf("turn without account: %+v", tr)
		}
		if tr.IsSubagent {
			sub++
		}
	}
	if sub != 1 {
		t.Fatalf("want 1 subagent turn, got %d", sub)
	}
	if len(b.Accounts) == 0 || b.Accounts[0].Email != "me@work.com" || b.Accounts[0].Plan != "max" {
		t.Fatalf("accounts: %+v", b.Accounts)
	}
	if s := b.Sessions[0]; s.ProjectKey != "local/repo" || s.Title != "Fix login and add tests" {
		t.Fatalf("session: %+v", s)
	}

	// Second run: nothing new, nothing re-sent.
	n := len(f.batches)
	Run(st, c, []string{claude})
	if got := f.all(); len(got.Turns) != 4 || len(f.batches) > n+1 {
		t.Fatalf("re-sent data: %d batches after %d", len(f.batches), n)
	}
}

func TestUnapprovedAccountNeverLeavesTheDevice(t *testing.T) {
	f := &fakeServer{} // nothing approved
	st, c, claude := setup(t, f)
	Run(st, c, []string{claude})
	b := f.all()
	if len(b.Turns)+len(b.Prompts)+len(b.Sessions) != 0 {
		t.Fatalf("uploaded data for an unapproved account: %+v", b)
	}
	if len(b.Accounts) != 1 {
		t.Fatal("the account itself should be reported so it can be approved")
	}
}

func TestOfflineKeepsDataQueued(t *testing.T) {
	f := &fakeServer{approved: []string{"acct-me"}, fail: true}
	st, c, claude := setup(t, f)
	if _, err := Run(st, c, []string{claude}); err == nil {
		t.Fatal("want error while server is down")
	}
	for p, off := range st.Offsets {
		t.Fatalf("offset advanced without upload: %s=%d", p, off)
	}
	f.fail = false
	if _, err := Run(st, c, []string{claude}); err != nil {
		t.Fatal(err)
	}
	if b := f.all(); len(b.Turns) != 4 {
		t.Fatalf("after reconnect want 4 turns, got %d", len(b.Turns))
	}
}

func TestSettingsApplyOnDevice(t *testing.T) {
	f := &fakeServer{approved: []string{"acct-me"}, settings: `[{"scope":"global","scope_id":"","json":{"prompt_text":false,"subagents":false,"full_paths":false}}]`}
	st, c, claude := setup(t, f)
	Run(st, c, []string{claude})
	b := f.all()
	for _, p := range b.Prompts {
		if p.Text != nil {
			t.Fatal("prompt text sent while turned off")
		}
	}
	for _, tr := range b.Turns {
		if tr.IsSubagent {
			t.Fatal("subagent turn sent while turned off")
		}
	}
	if b.Sessions[0].CWD != "repo" {
		t.Fatalf("full path sent: %q", b.Sessions[0].CWD)
	}
}

func TestExcludedFolderAndPause(t *testing.T) {
	f := &fakeServer{approved: []string{"acct-me"}, settings: `[{"scope":"global","scope_id":"","json":{"excluded_folders":["/home/dev/work/*"]}}]`}
	st, c, claude := setup(t, f)
	Run(st, c, []string{claude})
	if b := f.all(); len(b.Turns)+len(b.Prompts) != 0 {
		t.Fatal("excluded folder uploaded")
	}

	f2 := &fakeServer{approved: []string{"acct-me"}}
	st2, c2, claude2 := setup(t, f2)
	st2.Paused = true
	Run(st2, c2, []string{claude2})
	if b := f2.all(); len(b.Turns)+len(b.Prompts) != 0 {
		t.Fatal("uploaded while paused")
	}
}

func TestPromptAccountFromHookEvents(t *testing.T) {
	f := &fakeServer{approved: []string{"acct-me", "acct-work"}}
	st, c, claude := setup(t, f)
	// The hook saw p-2 submitted while signed in to another account.
	os.WriteFile(state.EventsFile(), []byte(`{"prompt_id":"p-2","session_id":"`+sessionID+`","account":{"uuid":"acct-work","email":"me@corp.com"}}`+"\n"), 0o600)
	Run(st, c, []string{claude})
	b := f.all()
	byPrompt := map[string]string{}
	for _, p := range b.Prompts {
		byPrompt[p.ID] = p.AccountUUID
	}
	if byPrompt["p-1"] != "acct-me" || byPrompt["p-2"] != "acct-work" {
		t.Fatalf("prompt accounts: %v", byPrompt)
	}
	for _, tr := range b.Turns {
		if tr.ID == "msg_C" && tr.AccountUUID != "acct-work" {
			t.Fatalf("turn after p-2 should belong to acct-work: %+v", tr)
		}
	}
	if _, err := os.Stat(state.EventsFile()); err == nil {
		t.Fatal("events file should be consumed")
	}
}
