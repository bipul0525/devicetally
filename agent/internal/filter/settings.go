// Package filter decides what may leave the device. Every upload path goes through Apply.
package filter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Settings are layered global -> account -> device -> project; the most specific value wins.
type Settings struct {
	Tracking        bool     `json:"tracking"`
	Tokens          bool     `json:"tokens"`
	ModelEffort     bool     `json:"model_effort"`
	PromptText      bool     `json:"prompt_text"`
	RedactSecrets   bool     `json:"redact_secrets"`
	SessionTitles   bool     `json:"session_titles"`
	FullPaths       bool     `json:"full_paths"`
	Git             bool     `json:"git"`
	Subagents       bool     `json:"subagents"`
	ExcludedFolders []string `json:"excluded_folders"`
	NewAccounts     string   `json:"new_account_policy"` // ignore | ask | track
	AutoUpdate      bool     `json:"auto_update"`
	// Other AI tools to read with tokscale, by tokscale client id. Off unless turned on.
	Tools map[string]bool `json:"tools"`
}

func Defaults() Settings {
	return Settings{Tracking: true, Tokens: true, ModelEffort: true, PromptText: true, RedactSecrets: true,
		SessionTitles: true, FullPaths: true, Git: true, Subagents: true, NewAccounts: "ignore", AutoUpdate: true}
}

type ScopedSettings struct {
	Scope   string          `json:"scope"`
	ScopeID string          `json:"scope_id"`
	JSON    json.RawMessage `json:"json"`
}

// Resolve layers the server's settings rows for one account + device + project.
func Resolve(rows []ScopedSettings, account, device, project string) Settings {
	s := Defaults()
	for _, layer := range []struct{ scope, id string }{{"global", ""}, {"account", account}, {"device", device}, {"project", project}} {
		for _, r := range rows {
			if r.Scope == layer.scope && r.ScopeID == layer.id {
				json.Unmarshal(r.JSON, &s) // only keys present in the row override
			}
		}
	}
	return s
}

// Excluded reports whether cwd falls under one of the patterns.
// "~/personal/*" or "~/personal/**" exclude the whole folder tree; other patterns use glob matching.
// Temporary reports whether cwd is inside a temporary folder (/tmp, /private/tmp, /var/folders or
// $TMPDIR): scratch and automated runs (e.g. `claude -p` in a test), not real projects.
func Temporary(cwd string) bool {
	if cwd == "" {
		return false
	}
	slash := func(p string) string { return strings.ToLower(filepath.ToSlash(filepath.Clean(p))) }
	c := slash(cwd)
	roots := []string{slash(os.TempDir())}
	if runtime.GOOS != "windows" {
		roots = append(roots, "/tmp", "/private/tmp", "/var/folders", "/private/var/folders")
	}
	for _, t := range roots {
		if t != "." && t != "/" && (c == t || strings.HasPrefix(c, t+"/")) {
			return true
		}
	}
	return false
}

func Excluded(cwd string, patterns []string) bool {
	home, _ := os.UserHomeDir()
	cwd = filepath.Clean(cwd)
	for _, p := range patterns {
		if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
			p = filepath.Join(home, p[1:])
		}
		p = filepath.Clean(p)
		if base, ok := strings.CutSuffix(p, string(filepath.Separator)+"**"); ok {
			p = base
		} else if base, ok := strings.CutSuffix(p, string(filepath.Separator)+"*"); ok {
			p = base
		}
		if cwd == p || strings.HasPrefix(cwd, p+string(filepath.Separator)) {
			return true
		}
		if ok, _ := filepath.Match(p, cwd); ok {
			return true
		}
	}
	return false
}
