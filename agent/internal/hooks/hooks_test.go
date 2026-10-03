package hooks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const existing = `{
  "model": "opus",
  "permissions": {"allow": ["Bash(ls)"]},
  "hooks": {
    "Stop": [{"hooks": [{"type": "command", "command": "say done"}]}],
    "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "check.sh"}]}]
  }
}`

func read(t *testing.T, p string) map[string]any {
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	m := map[string]any{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestInstallMergesAndUninstallRestores(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "settings.json")
	os.WriteFile(p, []byte(existing), 0o600)
	exe := "/Users/me/.devicetally/bin/devicetally"

	if changed, err := Install(p, exe); err != nil || !changed {
		t.Fatal(changed, err)
	}
	m := read(t, p)
	hooks := m["hooks"].(map[string]any)
	if len(hooks["Stop"].([]any)) != 2 || len(hooks["PreToolUse"].([]any)) != 1 || hooks["SessionStart"] == nil || hooks["UserPromptSubmit"] == nil {
		t.Fatalf("merge lost or missed hooks: %v", hooks)
	}
	if m["model"] != "opus" {
		t.Fatal("other settings lost")
	}
	h := hooks["UserPromptSubmit"].([]any)[0].(map[string]any)["hooks"].([]any)[0].(map[string]any)
	if h["async"] != true || h["command"] != Command(exe, "UserPromptSubmit") {
		t.Fatalf("hook: %v", h)
	}
	if backups, _ := filepath.Glob(p + ".devicetally-backup-*"); len(backups) != 1 {
		t.Fatalf("want 1 backup, got %v", backups)
	}

	if changed, _ := Install(p, exe); changed {
		t.Fatal("second install should be a no-op")
	}

	if changed, err := Uninstall(p); err != nil || !changed {
		t.Fatal(changed, err)
	}
	want := map[string]any{}
	json.Unmarshal([]byte(existing), &want)
	if got := read(t, p); !reflect.DeepEqual(got, want) {
		t.Fatalf("uninstall should restore the original settings\ngot  %v\nwant %v", got, want)
	}
}

func TestInstallCreatesMissingFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	if _, err := Install(p, "/x/devicetally"); err != nil {
		t.Fatal(err)
	}
	if len(read(t, p)["hooks"].(map[string]any)) != len(Events) {
		t.Fatal("want every event")
	}
}

func TestRefusesInvalidJSON(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	os.WriteFile(p, []byte("{ not json"), 0o600)
	if _, err := Install(p, "/x/devicetally"); err == nil {
		t.Fatal("must not overwrite a settings file it cannot parse")
	}
	if b, _ := os.ReadFile(p); string(b) != "{ not json" {
		t.Fatal("file was modified")
	}
}

func TestManagedHasOurs(t *testing.T) {
	p := filepath.Join(t.TempDir(), "managed-settings.json")
	if ManagedHasOurs(p) {
		t.Fatal("missing file")
	}
	os.WriteFile(p, []byte(`{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"\"/Library/Application Support/DeviceTally/bin/devicetally\" hook Stop","async":true}]}]}}`), 0o600)
	if !ManagedHasOurs(p) {
		t.Fatal("should find our hook")
	}
	os.WriteFile(p, []byte(`{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"other"}]}]}}`), 0o600)
	if ManagedHasOurs(p) {
		t.Fatal("someone else's hook isn't ours")
	}
}
