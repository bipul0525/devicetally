package hooks

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodexNotify(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.toml")
	if changed, _ := InstallCodex(p, "/x/devicetally"); changed {
		t.Fatal("no Codex config: leave it alone")
	}
	orig := "model = \"gpt-5\"\n\n[profiles.fast]\nmodel = \"gpt-5-mini\"\n"
	os.WriteFile(p, []byte(orig), 0o600)
	if changed, err := InstallCodex(p, "/x/devicetally"); !changed || err != nil {
		t.Fatal("should add notify", err)
	}
	b, _ := os.ReadFile(p)
	if !strings.HasPrefix(string(b), `notify = ["/x/devicetally", "codex-notify"]`) || !strings.HasSuffix(string(b), orig) {
		t.Fatalf("notify must be the first line, rest untouched:\n%s", b)
	}
	if changed, _ := InstallCodex(p, "/x/devicetally"); changed {
		t.Fatal("second install is a no-op")
	}
	if changed, _ := UninstallCodex(p); !changed {
		t.Fatal("should remove ours")
	}
	if b, _ := os.ReadFile(p); string(b) != orig {
		t.Fatalf("uninstall restores the file exactly:\n%s", b)
	}
	// The user's own notify program is never replaced or removed.
	own := "notify = [\"my-notifier\"]\n" + orig
	os.WriteFile(p, []byte(own), 0o600)
	InstallCodex(p, "/x/devicetally")
	UninstallCodex(p)
	if b, _ := os.ReadFile(p); string(b) != own {
		t.Fatalf("user's notify untouched:\n%s", b)
	}
}
