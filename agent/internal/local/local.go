// Package local is "Just this computer": usage counted on this computer, with no server. It reads
// Claude Code's transcripts with the same parser the syncer uses (deduplicated by message id, like
// the server) and other tools' daily totals from tokscale, and reports them in the shape of the
// server's /overview and /summary, so the app shows them the same way. Nothing is uploaded.
package local

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"devicetally/agent/internal/filter"
	"devicetally/agent/internal/state"
	"devicetally/agent/internal/transcript"
)

// Marker is the file that puts the tracker in local mode (no server, nothing uploaded).
func Marker() string { return filepath.Join(state.Dir(), "local") }

// On reports whether this computer uses DeviceTally without a server.
func On() bool { _, err := os.Stat(Marker()); return err == nil }

// turn is what's kept per Claude Code reply: enough to count tokens by day, model and project.
type turn struct {
	TS      int64  `json:"t"`
	Model   string `json:"m,omitempty"`
	Session string `json:"s"`
	Project string `json:"p"`
	Tokens  int64  `json:"n"`
}

// file caches one transcript's replies, reused while its size and time haven't changed.
type file struct {
	Size  int64            `json:"size"`
	Mod   int64            `json:"mod"`
	Turns map[string]*turn `json:"turns"` // by message id
}

// Other tools' daily totals (from tokscale): day -> tool -> model -> tokens.
type ToolDays map[string]map[string]map[string]int64

func cachePath() string { return filepath.Join(state.Dir(), "local-usage.json") }

// claudeTurns reads every transcript (only changed ones are parsed again) and returns the
// replies, deduplicated by message id across files, keeping the largest count (like the server).
func claudeTurns(dirs []string) map[string]*turn {
	cache := map[string]*file{}
	if b, err := os.ReadFile(cachePath()); err == nil {
		json.Unmarshal(b, &cache)
	}
	seen := map[string]bool{}
	projects := map[string]string{}
	changed := false
	for _, d := range dirs {
		root := filepath.Join(d, "projects")
		filepath.WalkDir(root, func(p string, e os.DirEntry, err error) error {
			if err != nil || e.IsDir() || !strings.HasSuffix(p, ".jsonl") {
				return nil
			}
			info, err := e.Info()
			if err != nil {
				return nil
			}
			seen[p] = true
			if c := cache[p]; c != nil && c.Size == info.Size() && c.Mod == info.ModTime().UnixMilli() {
				return nil
			}
			f, err := os.Open(p)
			if err != nil {
				return nil
			}
			chunk, err := transcript.Parse(f, strings.Contains(p, string(filepath.Separator)+"subagents"+string(filepath.Separator)))
			f.Close()
			if err != nil {
				return nil
			}
			out := &file{Size: info.Size(), Mod: info.ModTime().UnixMilli(), Turns: map[string]*turn{}}
			for _, t := range chunk.Turns {
				proj := ""
				if s := chunk.Sessions[t.SessionID]; s != nil && s.CWD != "" {
					if k, ok := projects[s.CWD]; ok {
						proj = k
					} else {
						proj, _ = filter.ProjectKey(s.CWD)
						projects[s.CWD] = proj
					}
				}
				n := t.InTok + t.OutTok + t.CacheWriteTok + t.CacheReadTok
				if prev := out.Turns[t.ID]; prev == nil || n > prev.Tokens {
					out.Turns[t.ID] = &turn{TS: t.TS, Model: t.Model, Session: t.SessionID, Project: proj, Tokens: n}
				}
			}
			cache[p] = out
			changed = true
			return nil
		})
	}
	for p := range cache {
		if !seen[p] {
			delete(cache, p) // transcript deleted
			changed = true
		}
	}
	if changed {
		if b, err := json.Marshal(cache); err == nil {
			tmp := cachePath() + ".tmp"
			if os.WriteFile(tmp, b, 0o600) == nil {
				os.Rename(tmp, cachePath())
			}
		}
	}
	all := map[string]*turn{}
	for _, f := range cache {
		for id, t := range f.Turns {
			if prev := all[id]; prev == nil || t.Tokens > prev.Tokens {
				all[id] = t
			}
		}
	}
	return all
}

// Item is one row of a breakdown.
type Item struct {
	Key    string  `json:"key"`
	Label  string  `json:"label,omitempty"`
	Tokens int64   `json:"tokens"`
	Cost   float64 `json:"cost"`
}

var toolNames = map[string]string{"claude": "Claude Code", "codex": "Codex", "opencode": "OpenCode", "kimi": "Kimi", "gemini": "Gemini CLI", "cursor": "Cursor"}

func day(ms int64) string { return time.UnixMilli(ms).Local().Format("2006-01-02") }

// Overview is the server's /overview for this computer over the last `days` days (today included).
func Overview(dirs []string, other ToolDays, days int, now time.Time) map[string]any {
	to := now.Local().Format("2006-01-02")
	from := now.Local().AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	pfrom := now.Local().AddDate(0, 0, -(2*days - 1)).Format("2006-01-02")
	turns := claudeTurns(dirs)

	daily := map[string]int64{}
	byTool, byModel, byProject := map[string]int64{}, map[string]int64{}, map[string]int64{}
	var total, previous, replies int64
	sessions := map[string][]int64{}
	for _, t := range turns {
		d := day(t.TS)
		if d >= pfrom && d < from {
			previous += t.Tokens
		}
		if d < from || d > to {
			continue
		}
		total += t.Tokens
		replies++
		daily[d] += t.Tokens
		byTool["claude"] += t.Tokens
		if t.Model != "" {
			byModel[t.Model] += t.Tokens
		}
		if t.Project != "" {
			byProject[t.Project] += t.Tokens
		}
		sessions[t.Session] = append(sessions[t.Session], t.TS)
	}
	for d, tools := range other {
		for tool, models := range tools {
			for model, n := range models {
				if d >= pfrom && d < from {
					previous += n
				}
				if d < from || d > to {
					continue
				}
				total += n
				daily[d] += n
				byTool[tool] += n
				if model != "" {
					byModel[model] += n
				}
			}
		}
	}
	// Active time: gaps of up to 5 minutes between replies in a session.
	var active int64
	for _, ts := range sessions {
		sort.Slice(ts, func(i, j int) bool { return ts[i] < ts[j] })
		for i := 1; i < len(ts); i++ {
			if g := ts[i] - ts[i-1]; g <= 5*60_000 {
				active += g / 1000
			}
		}
	}
	list := func(m map[string]int64, label func(string) string) []Item {
		out := []Item{}
		for k, n := range m {
			if n > 0 {
				out = append(out, Item{Key: k, Label: label(k), Tokens: n})
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Tokens > out[j].Tokens })
		return out
	}
	same := func(k string) string { return k }
	tool := func(k string) string {
		if n := toolNames[k]; n != "" {
			return n
		}
		return k
	}
	series := []map[string]any{}
	for i := days - 1; i >= 0; i-- {
		d := now.Local().AddDate(0, 0, -i).Format("2006-01-02")
		series = append(series, map[string]any{"day": d, "tokens": daily[d]})
	}
	projects := []map[string]string{}
	for k := range byProject {
		projects = append(projects, map[string]string{"key": k, "display_name": k[strings.LastIndex(k, "/")+1:]})
	}
	seen := []string{}
	for k := range byTool {
		if k != "claude" {
			seen = append(seen, k)
		}
	}
	sort.Strings(seen)
	return map[string]any{
		"local":    true,
		"range":    map[string]any{"from": from, "to": to, "days": days},
		"totals":   map[string]any{"tokens": total, "cost": 0, "sessions": len(sessions), "active_seconds": active, "turns": replies, "prompts": 0},
		"previous": map[string]any{"tokens": previous},
		"daily":    series,
		"by":       map[string]any{"tool": list(byTool, tool), "model": list(byModel, same), "project": list(byProject, same), "device": []Item{}, "account": []Item{}, "effort": []Item{}},
		"heat":     [][]int{},
		"unpriced": []string{},
		"labels":   map[string]any{"devices": []any{}, "accounts": []any{}, "projects": projects, "tools": toolNames, "tools_seen": seen},
	}
}

// Summary is the server's /summary (the menu-bar panel) for this computer.
func Summary(o map[string]any) map[string]any {
	by := o["by"].(map[string]any)
	top := by["model"].([]Item)
	if len(top) > 6 {
		top = top[:6]
	}
	return map[string]any{
		"scope": "device", "device": nil, "local": true,
		"range":           map[string]any{"days": o["range"].(map[string]any)["days"]},
		"tokens":          o["totals"].(map[string]any)["tokens"],
		"cost":            0,
		"previous_tokens": o["previous"].(map[string]any)["tokens"],
		"by_tool":         by["tool"],
		"by_model":        top,
		"by_device":       []any{},
	}
}
