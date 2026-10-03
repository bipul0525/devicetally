// Package transcript reads the few fields DeviceTally needs from Claude Code's JSONL transcripts.
// The format is undocumented; everything else is ignored, and missing fields are reported as drift.
package transcript

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"time"
)

type Turn struct {
	ID            string `json:"id"`
	SessionID     string `json:"session_id"`
	AccountUUID   string `json:"account_uuid"`
	TS            int64  `json:"ts"`
	Model         string `json:"model,omitempty"`
	Effort        string `json:"effort,omitempty"`
	InTok         int64  `json:"in_tok"`
	OutTok        int64  `json:"out_tok"`
	CacheWriteTok int64  `json:"cache_write_tok"`
	CacheReadTok  int64  `json:"cache_read_tok"`
	// Part of CacheWriteTok written to the 1-hour cache, which is priced higher (Milestone 5 cost check).
	CacheWrite1hTok int64  `json:"cache_write_1h_tok"`
	ThinkingTok     *int64 `json:"thinking_tok"`
	IsSubagent      bool   `json:"is_subagent"`
}

type Prompt struct {
	ID          string  `json:"id"`
	SessionID   string  `json:"session_id"`
	AccountUUID string  `json:"account_uuid"`
	TS          int64   `json:"ts"`
	Text        *string `json:"text"`
}

type Session struct {
	ID          string `json:"id"`
	AccountUUID string `json:"account_uuid"`
	ProjectKey  string `json:"project_key"`
	ProjectName string `json:"project_name,omitempty"`
	CWD         string `json:"cwd,omitempty"`
	GitBranch   string `json:"git_branch,omitempty"`
	Title       string `json:"title,omitempty"`
	Entrypoint  string `json:"entrypoint,omitempty"`
	CCVersion   string `json:"cc_version,omitempty"`
	StartedAt   int64  `json:"started_at"`
	EndedAt     int64  `json:"ended_at"`
}

// Chunk is what one read of a transcript produced. Accounts are filled in later by the syncer.
type Chunk struct {
	Sessions map[string]*Session
	Turns    []*Turn
	Prompts  []*Prompt
	// PromptOrder links each turn to the prompt before it in the file (turn index -> prompt id, "" if none).
	TurnPrompt []string
	Consumed   int64    // bytes of complete lines read
	Drift      []string // expected fields that were missing
}

type line struct {
	Type        string          `json:"type"`
	SessionID   string          `json:"sessionId"`
	Timestamp   string          `json:"timestamp"`
	CWD         string          `json:"cwd"`
	GitBranch   string          `json:"gitBranch"`
	Version     string          `json:"version"`
	Entrypoint  string          `json:"entrypoint"`
	IsSidechain bool            `json:"isSidechain"`
	IsMeta      bool            `json:"isMeta"`
	PromptID    string          `json:"promptId"`
	Effort      string          `json:"effort"`
	ToolResult  json.RawMessage `json:"toolUseResult"`
	AITitle     string          `json:"aiTitle"`
	Origin      *struct {
		Kind string `json:"kind"`
	} `json:"origin"`
	Message *struct {
		ID      string          `json:"id"`
		Model   string          `json:"model"`
		Content json.RawMessage `json:"content"`
		Usage   *struct {
			Input      int64 `json:"input_tokens"`
			Output     int64 `json:"output_tokens"`
			CacheWrite int64 `json:"cache_creation_input_tokens"`
			CacheRead  int64 `json:"cache_read_input_tokens"`
			CacheSplit *struct {
				OneHour int64 `json:"ephemeral_1h_input_tokens"`
			} `json:"cache_creation"`
			Details *struct {
				Thinking *int64 `json:"thinking_tokens"`
			} `json:"output_tokens_details"`
		} `json:"usage"`
	} `json:"message"`
}

// Parse reads complete lines from r. isSubagent marks files under <session>/subagents/.
// Replies written on several lines (Phase 0) are collapsed, keeping the largest output count.
func Parse(r io.Reader, isSubagent bool) (*Chunk, error) {
	c := &Chunk{Sessions: map[string]*Session{}}
	byID := map[string]int{}
	seenPrompt := map[string]bool{}
	drift := map[string]bool{}
	lastPrompt := ""
	br := bufio.NewReaderSize(r, 1<<20)
	for {
		raw, err := br.ReadBytes('\n')
		if err == io.EOF {
			break // a partial last line is left for the next sync
		}
		if err != nil {
			return nil, err
		}
		c.Consumed += int64(len(raw))
		var l line
		if json.Unmarshal(bytes.TrimSpace(raw), &l) != nil || l.SessionID == "" {
			continue
		}
		ts := parseTS(l.Timestamp)
		s := c.Sessions[l.SessionID]
		if s == nil {
			s = &Session{ID: l.SessionID, StartedAt: ts, EndedAt: ts}
			c.Sessions[l.SessionID] = s
		}
		if ts != 0 {
			if s.StartedAt == 0 || ts < s.StartedAt {
				s.StartedAt = ts
			}
			if ts > s.EndedAt {
				s.EndedAt = ts
			}
		}
		set(&s.CWD, l.CWD)
		set(&s.GitBranch, l.GitBranch)
		set(&s.CCVersion, l.Version)
		set(&s.Entrypoint, l.Entrypoint)

		switch l.Type {
		case "ai-title":
			s.Title = l.AITitle // the latest title wins
		case "user":
			// origin.kind other than "human" (e.g. "task-notification") is text Claude Code wrote, not a prompt.
			automated := l.Origin != nil && l.Origin.Kind != "" && l.Origin.Kind != "human"
			if isSubagent || automated || l.IsMeta || l.IsSidechain || len(l.ToolResult) > 0 || l.PromptID == "" || l.Message == nil || seenPrompt[l.PromptID] {
				continue
			}
			text, ok := promptText(l.Message.Content)
			if !ok {
				continue
			}
			seenPrompt[l.PromptID] = true
			lastPrompt = l.PromptID
			c.Prompts = append(c.Prompts, &Prompt{ID: l.PromptID, SessionID: l.SessionID, TS: ts, Text: &text})
		case "assistant":
			m := l.Message
			if m == nil || m.ID == "" || m.Model == "<synthetic>" {
				continue
			}
			if m.Usage == nil {
				drift["message.usage"] = true
				continue
			}
			if l.Effort == "" {
				drift["effort"] = true
			}
			t := &Turn{
				ID: m.ID, SessionID: l.SessionID, TS: ts, Model: m.Model, Effort: l.Effort,
				InTok: m.Usage.Input, OutTok: m.Usage.Output, CacheWriteTok: m.Usage.CacheWrite, CacheReadTok: m.Usage.CacheRead,
				IsSubagent: isSubagent || l.IsSidechain,
			}
			if m.Usage.CacheSplit != nil {
				t.CacheWrite1hTok = m.Usage.CacheSplit.OneHour
			}
			if m.Usage.Details != nil {
				t.ThinkingTok = m.Usage.Details.Thinking
			}
			if i, ok := byID[m.ID]; ok {
				if t.OutTok >= c.Turns[i].OutTok {
					t.TS = c.Turns[i].TS
					c.Turns[i] = t
				}
				continue
			}
			byID[m.ID] = len(c.Turns)
			c.Turns = append(c.Turns, t)
			c.TurnPrompt = append(c.TurnPrompt, lastPrompt)
		}
	}
	for k := range drift {
		c.Drift = append(c.Drift, k)
	}
	return c, nil
}

func set(dst *string, v string) {
	if v != "" {
		*dst = v
	}
}

func parseTS(s string) int64 {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

// promptText accepts a plain string or a list of blocks with at least one text block.
func promptText(raw json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, s != ""
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return "", false
	}
	var parts []string
	for _, b := range blocks {
		switch b.Type {
		case "text":
			parts = append(parts, b.Text)
		case "tool_result":
			return "", false
		}
	}
	return strings.Join(parts, "\n"), len(parts) > 0
}
