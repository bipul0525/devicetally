package hooks

import (
	"encoding/json"
	"os"
	"runtime"
	"strings"
)

// ManagedPath is Claude Code's system-wide (managed) settings file. Hooks there run in every session,
// whatever settings folder is used, and only an administrator can change them
// (code.claude.com/docs/en/managed-settings).
func ManagedPath() string {
	switch runtime.GOOS {
	case "darwin":
		return "/Library/Application Support/ClaudeCode/managed-settings.json"
	case "windows":
		return `C:\Program Files\ClaudeCode\managed-settings.json`
	default:
		return "/etc/claude-code/managed-settings.json"
	}
}

// ManagedHasOurs reports whether the managed settings file carries DeviceTally's hooks ("locked").
func ManagedHasOurs(path string) bool {
	b, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var s map[string]any
	if json.Unmarshal(b, &s) != nil {
		return false
	}
	hooks, _ := s["hooks"].(map[string]any)
	for _, ev := range hooks {
		groups, _ := ev.([]any)
		for _, g := range groups {
			m, _ := g.(map[string]any)
			list, _ := m["hooks"].([]any)
			for _, h := range list {
				if ours(h) {
					return true
				}
			}
		}
	}
	return false
}

// UserHasOurs reports whether a user settings.json carries DeviceTally's hooks.
func UserHasOurs(path string) bool {
	b, err := os.ReadFile(path)
	return err == nil && strings.Contains(string(b), marker) && strings.Contains(string(b), " hook ")
}
