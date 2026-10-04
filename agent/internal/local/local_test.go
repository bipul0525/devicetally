package local

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Counts a real (scrubbed) transcript, deduplicated, by day/model/tool, and gives the same
// answer from the cache; other tools' totals are added in.
func TestOverviewCountsThisComputer(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DEVICETALLY_HOME", filepath.Join(home, "dt"))
	os.MkdirAll(filepath.Join(home, "dt"), 0o700)
	claude := filepath.Join(home, "claude")
	proj := filepath.Join(claude, "projects", "-work-app")
	os.MkdirAll(proj, 0o700)
	entries, _ := os.ReadDir("../../../fixtures/transcripts")
	n := 0
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".jsonl" {
			b, _ := os.ReadFile(filepath.Join("../../../fixtures/transcripts", e.Name()))
			os.WriteFile(filepath.Join(proj, e.Name()), b, 0o600)
			n++
		}
	}
	if n == 0 {
		t.Skip("no fixture transcripts")
	}
	now := time.Now().AddDate(1, 0, 0) // a window wide enough to hold the fixtures' dates
	o := Overview([]string{claude}, ToolDays{now.Format("2006-01-02"): {"opencode": {"kimi-k2": 500}}}, 3660, now)
	tot := o["totals"].(map[string]any)["tokens"].(int64)
	if tot <= 500 {
		t.Fatalf("expected Claude Code tokens plus 500 from OpenCode, got %d", tot)
	}
	again := Overview([]string{claude}, ToolDays{now.Format("2006-01-02"): {"opencode": {"kimi-k2": 500}}}, 3660, now)
	if again["totals"].(map[string]any)["tokens"].(int64) != tot {
		t.Fatal("the cached second read must give the same total")
	}
	tools := o["by"].(map[string]any)["tool"].([]Item)
	if len(tools) != 2 || tools[0].Key != "claude" {
		t.Fatalf("by tool: %+v", tools)
	}
	s := Summary(Overview([]string{claude}, nil, 1, now))
	if s["local"] != true || s["range"].(map[string]any)["days"] != 1 {
		t.Fatalf("summary: %+v", s)
	}
}
