package syncer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"time"

	"devicetally/agent/internal/filter"
	"devicetally/agent/internal/state"
	"devicetally/agent/internal/tools"
)

type toolsUpload struct {
	Seen  []string    `json:"seen,omitempty"`
	Tools []string    `json:"tools,omitempty"`
	Days  []tools.Day `json:"days,omitempty"`
}

// Enabled returns the tools turned on for this device (global settings, overridden per device).
func Enabled(cfg *Config) []string {
	set := filter.Resolve(cfg.Settings, "", cfg.DeviceID, "").Tools
	var on []string
	for _, t := range tools.Supported {
		if set[t] {
			on = append(on, t)
		}
	}
	return on
}

// RunTools reports which tools exist on this device and uploads daily totals of the enabled ones.
// First run per tool sends its whole history; later runs send the last 3 days (snapshots replace
// server rows, so re-sending a day is harmless). Unchanged snapshots are not sent at all.
func RunTools(st *state.State, c *Client, cfg *Config) error {
	seen := tools.Detect()
	if !slices.Equal(seen, st.ToolsSeen) {
		if err := c.do("POST", "/api/v1/tools", toolsUpload{Seen: seen}, nil); err != nil {
			return err
		}
		st.ToolsSeen = seen
		st.Save()
	}
	var enabled []string
	for _, t := range Enabled(cfg) {
		if slices.Contains(seen, t) {
			enabled = append(enabled, t)
		}
	}
	st.ToolsTracked = enabled
	if len(enabled) == 0 {
		return nil
	}
	bin, err := tools.Ensure(c.Server)
	if err != nil {
		return err
	}
	since := time.Now().AddDate(0, 0, -3).Format("2006-01-02")
	for _, t := range enabled {
		if !st.ToolsFull[t] {
			since = "" // a newly enabled tool: send everything once
		}
	}
	days, err := tools.Daily(bin, enabled, since)
	if err != nil {
		return err
	}
	b, _ := json.Marshal(struct {
		T []string
		D []tools.Day
	}{enabled, days})
	h := sha256.Sum256(b)
	hash := hex.EncodeToString(h[:])
	if hash == st.ToolsHash {
		return nil
	}
	for i := 0; i < len(days) || i == 0; i += 400 { // server accepts up to 400 days per request
		end := min(i+400, len(days))
		if err := c.do("POST", "/api/v1/tools", toolsUpload{Tools: enabled, Days: days[i:end]}, nil); err != nil {
			return err
		}
	}
	if st.ToolsFull == nil {
		st.ToolsFull = map[string]bool{}
	}
	for _, t := range enabled {
		st.ToolsFull[t] = true
	}
	st.ToolsHash = hash
	return st.Save()
}
