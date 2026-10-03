package hooks

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

// Codex has no hooks, but runs its `notify` program after each finished turn. We add ours to
// ~/.codex/config.toml only when Codex is installed and no notify program is set (never replacing
// the user's own), as the first line, since TOML top-level keys must come before any [table].

var notifyKey = regexp.MustCompile(`(?m)^\s*notify\s*=`)

func codexLine(exe string) string {
	return fmt.Sprintf("notify = [%q, \"codex-notify\"] # added by devicetally (Agent status)", exe)
}

// InstallCodex adds the notify line. Returns true if the file changed.
func InstallCodex(path, exe string) (bool, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return false, nil // Codex not set up here
	}
	if err != nil {
		return false, err
	}
	if notifyKey.Match(b) {
		return false, nil // ours already, or the user's own
	}
	if err := os.WriteFile(fmt.Sprintf("%s.devicetally-backup-%s", path, time.Now().Format("20060102-150405")), b, 0o600); err != nil {
		return false, err
	}
	return true, os.WriteFile(path, []byte(codexLine(exe)+"\n"+string(b)), 0o600)
}

// UninstallCodex removes our notify line (and only ours).
func UninstallCodex(path string) (bool, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return false, nil
	}
	var kept []string
	changed := false
	for _, l := range strings.SplitAfter(string(b), "\n") {
		if notifyKey.MatchString(l) && strings.Contains(l, "codex-notify") && strings.Contains(l, marker) {
			changed = true
			continue
		}
		kept = append(kept, l)
	}
	if !changed {
		return false, nil
	}
	return true, os.WriteFile(path, []byte(strings.Join(kept, "")), 0o600)
}
