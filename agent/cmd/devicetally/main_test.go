package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLinkOnPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no PATH link on Windows")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	other := filepath.Join(home, ".othertool", "bin") // another tool's folder, earlier on PATH
	local := filepath.Join(home, ".local", "bin")
	os.MkdirAll(other, 0o700)
	os.MkdirAll(local, 0o700)
	t.Setenv("PATH", other+string(os.PathListSeparator)+local)
	exe := filepath.Join(home, ".devicetally", "bin", "devicetally")

	if link := linkOnPath(exe); link != filepath.Join(local, "devicetally") {
		t.Fatalf("want link in ~/.local/bin, got %q", link)
	}
	if _, err := os.Lstat(filepath.Join(other, "devicetally")); err == nil {
		t.Fatal("must not write into another tool's folder")
	}
	if linkOnPath(exe) == "" {
		t.Fatal("second call should find the existing link")
	}
	unlinkFromPath(exe)
	if _, err := os.Lstat(filepath.Join(local, "devicetally")); err == nil {
		t.Fatal("uninstall should remove the link")
	}

	// A file that isn't ours is left alone.
	os.WriteFile(filepath.Join(local, "devicetally"), []byte("someone else's"), 0o700)
	if linkOnPath(exe) != "" {
		t.Fatal("must not replace a file it did not create")
	}
}

func TestEnrollSummary(t *testing.T) {
	got := enrollSummary("", []string{"codex", "opencode"}, []string{"codex", "opencode", "kimi"})
	want := "  Tracking: Codex, OpenCode.\n  Also found Kimi: the admin can turn it on in Settings → Other AI tools.\n  Claude Code: no account signed in yet. Once someone signs in, the admin approves it under Devices → Claude accounts.\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if got := enrollSummary("you@example.com", nil, nil); got != "  Tracking: Claude Code.\n" {
		t.Fatalf("with a Claude account: %q", got)
	}
}
