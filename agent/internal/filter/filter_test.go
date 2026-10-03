package filter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNormalizeRemote(t *testing.T) {
	b, err := os.ReadFile("../../../fixtures/project-key.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct{ Cases [][2]string }
	json.Unmarshal(b, &f)
	for _, c := range f.Cases {
		if got := NormalizeRemote(c[0]); got != c[1] {
			t.Errorf("%q: got %q want %q", c[0], got, c[1])
		}
	}
}

func TestProjectKeyFromGitConfig(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, ".git"), 0o700)
	os.WriteFile(filepath.Join(root, ".git", "config"), []byte("[core]\n\tbare = false\n[remote \"origin\"]\n\turl = git@github.com:me/app.git\n"), 0o600)
	sub := filepath.Join(root, "src", "pkg")
	os.MkdirAll(sub, 0o700)
	if k, n := ProjectKey(sub); k != "github.com/me/app" || n != "app" {
		t.Fatalf("got %q %q", k, n)
	}
	if k, _ := ProjectKey(t.TempDir()); !strings.HasPrefix(k, "local/") {
		t.Fatalf("no repo: got %q", k)
	}
}

func TestRedact(t *testing.T) {
	secrets := []string{
		"sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
		"AKIAIOSFODNN7EXAMPLE",
		"ghp_abcdefghijklmnopqrstuvwxyz0123456789",
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		"hunter2-but-longer",
		"postgres://admin:s3cretpass@db.example.com",
		"-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
	}
	in := "key " + secrets[0] + " aws " + secrets[1] + " gh " + secrets[2] + " jwt " + secrets[3] +
		"\npassword = " + secrets[4] + "\nurl " + secrets[5] + "\n" + secrets[6] + "\nDATABASE_URL_TOKEN_X=abcdefghijklmnop\n"
	out := Redact(in)
	for _, s := range secrets {
		if strings.Contains(out, s) {
			t.Errorf("not redacted: %q\nin: %s", s, out)
		}
	}
	if keep := "Please refactor the sync module, it has 3 bugs."; Redact(keep) != keep {
		t.Errorf("normal text changed: %q", Redact(keep))
	}
}

func TestExcluded(t *testing.T) {
	home, _ := os.UserHomeDir()
	p := []string{"~/personal/*", filepath.Join(home, "x", "secret-*")}
	cases := map[string]bool{
		filepath.Join(home, "personal"):               true,
		filepath.Join(home, "personal", "diary", "a"): true,
		filepath.Join(home, "personalish"):            false,
		filepath.Join(home, "x", "secret-proj"):       true,
		filepath.Join(home, "work", "repo"):           false,
	}
	for cwd, want := range cases {
		if Excluded(cwd, p) != want {
			t.Errorf("%s: want %v", cwd, want)
		}
	}
}

func TestResolveMostSpecificWins(t *testing.T) {
	rows := []ScopedSettings{
		{Scope: "global", JSON: json.RawMessage(`{"prompt_text": false, "git": false}`)},
		{Scope: "account", ScopeID: "a1", JSON: json.RawMessage(`{"prompt_text": true}`)},
		{Scope: "project", ScopeID: "github.com/me/app", JSON: json.RawMessage(`{"prompt_text": false}`)},
	}
	if s := Resolve(rows, "a1", "d1", "other"); !s.PromptText || s.Git || !s.Tokens {
		t.Errorf("account layer: %+v", s)
	}
	if s := Resolve(rows, "a1", "d1", "github.com/me/app"); s.PromptText {
		t.Errorf("project layer should win: %+v", s)
	}
}

func TestTemporaryFolders(t *testing.T) {
	cases := []struct {
		cwd  string
		want bool
	}{
		{filepath.Join(os.TempDir(), "run", "e2e"), true},
		{filepath.Join(home(), "projects", "devicetally"), false},
		{"", false},
	}
	if runtime.GOOS != "windows" {
		cases = append(cases, []struct {
			cwd  string
			want bool
		}{
			{"/private/tmp/claude-501/scratchpad/hookspike", true},
			{"/tmp/x", true},
			{"/var/folders/ab/T/run", true},
			{"/Users/x/projects/devicetally", false},
			{"/Users/x/tmp-notes", false},
		}...)
	}
	for _, c := range cases {
		if got := Temporary(c.cwd); got != c.want {
			t.Errorf("Temporary(%q) = %v, want %v", c.cwd, got, c.want)
		}
	}
}

func home() string { h, _ := os.UserHomeDir(); return h }
