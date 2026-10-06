package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"devicetally/agent/internal/hooks"
	"devicetally/agent/internal/local"
	"devicetally/agent/internal/schedule"
	"devicetally/agent/internal/spawn"
	"devicetally/agent/internal/state"
	"devicetally/agent/internal/tools"
)

// localSetup is "Just this computer": installs the tracker and Claude Code's hooks (for agent
// status) with no server. Usage is counted on this computer; nothing is uploaded.
func localSetup() error {
	exe, err := install()
	if err != nil {
		return err
	}
	if err := os.WriteFile(local.Marker(), []byte("DeviceTally runs without a server on this computer.\n"), 0o600); err != nil {
		return err
	}
	for _, d := range state.ClaudeDirs() {
		if _, err := hooks.Install(filepath.Join(d, "settings.json"), exe); err != nil {
			return err
		}
	}
	hooks.InstallCodex(codexConfig(), exe)
	linkOnPath(exe)
	schedule.Remove()             // was joined: its 5-minute check-in has nothing to do now
	spawn.Detached("local-tools") // other AI tools' history, in the background
	fmt.Println("✓ DeviceTally is set up on this computer. Monitoring is on.")
	return nil
}

func toolsCache() string { return filepath.Join(state.Dir(), "local-tools.json") }

// localTools refreshes other AI tools' daily totals (tokscale, downloaded from npm and checked
// against its pinned fingerprint). Run in the background; usage reads the saved result.
func localTools() error {
	seen := tools.Detect()
	out := local.ToolDays{}
	if len(seen) > 0 {
		bin, err := tools.Ensure("")
		if err != nil {
			return err
		}
		days, err := tools.Daily(bin, seen, "")
		if err != nil {
			return err
		}
		for _, d := range days {
			for _, r := range d.Rows {
				if out[d.Day] == nil {
					out[d.Day] = map[string]map[string]int64{}
				}
				if out[d.Day][r.Tool] == nil {
					out[d.Day][r.Tool] = map[string]int64{}
				}
				out[d.Day][r.Tool][r.Model] += r.In + r.Out + r.CacheRead + r.CacheWrite
			}
		}
	}
	b, _ := json.Marshal(out)
	tmp := toolsCache() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, toolsCache())
}

// usageCmd prints this computer's usage as JSON: `usage <days>` (the server's /overview) or
// `usage summary <1|7|30>` (its /summary). Other tools come from the last background refresh,
// started again when it's over 15 minutes old.
func usageCmd(args []string) error {
	summary := len(args) > 0 && args[0] == "summary"
	if summary {
		args = args[1:]
	}
	days := 30
	if len(args) > 0 {
		if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 && n <= 3660 {
			days = n
		}
	}
	other := local.ToolDays{}
	if b, err := os.ReadFile(toolsCache()); err == nil {
		json.Unmarshal(b, &other)
	}
	if info, err := os.Stat(toolsCache()); err != nil || time.Since(info.ModTime()) > 15*time.Minute {
		spawn.Detached("local-tools")
	}
	o := local.Overview(state.ClaudeDirs(), other, days, time.Now())
	var v any = o
	if summary {
		v = local.Summary(o)
	}
	return json.NewEncoder(os.Stdout).Encode(v)
}
