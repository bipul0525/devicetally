// Package syncer uploads new transcript data. Read positions only advance after the server
// accepts a batch, so the transcripts themselves are the offline queue and nothing is lost.
package syncer

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"devicetally/agent/internal/filter"
	"devicetally/agent/internal/state"
	"devicetally/agent/internal/transcript"
)

const maxItems = 500 // server limit per array

var ErrUpdateRequired = errors.New("server requires a newer agent: run `devicetally update`")

type Account struct {
	UUID        string `json:"uuid"`
	Email       string `json:"email,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
	OrgName     string `json:"org_name,omitempty"`
	Plan        string `json:"plan,omitempty"`
}

// CurrentAccount reads the account signed in to a Claude config folder (nil if signed out).
func CurrentAccount(claudeDir string) *Account {
	b, err := os.ReadFile(state.AccountFile(claudeDir))
	if err != nil {
		return nil
	}
	var f struct {
		OAuth *struct {
			UUID        string `json:"accountUuid"`
			Email       string `json:"emailAddress"`
			DisplayName string `json:"displayName"`
			OrgName     string `json:"organizationName"`
			BillingType string `json:"billingType"`
			SeatTier    string `json:"seatTier"`
		} `json:"oauthAccount"`
	}
	if json.Unmarshal(b, &f) != nil || f.OAuth == nil || f.OAuth.UUID == "" {
		return nil
	}
	o := f.OAuth
	plan := o.SeatTier
	if plan == "" {
		plan = o.BillingType
	}
	return &Account{UUID: o.UUID, Email: o.Email, DisplayName: o.DisplayName, OrgName: o.OrgName, Plan: plan}
}

// Event is one line the UserPromptSubmit hook appends to the events file.
type Event struct {
	PromptID  string   `json:"prompt_id"`
	SessionID string   `json:"session_id"`
	Account   *Account `json:"account"`
	TS        int64    `json:"ts"`
}

type Config struct {
	DeviceID string `json:"device_id"`
	Accounts []struct {
		UUID   string `json:"uuid"`
		Status string `json:"status"`
	} `json:"accounts"`
	Settings []filter.ScopedSettings `json:"settings"`
	// GitHub "owner/repo" whose releases this server's agents update from (empty: no auto-update).
	ReleaseRepo string `json:"release_repo"`
	// Latest agent version the server can serve from /dl/ (empty: ask GitHub instead).
	AgentLatest string `json:"agent_latest"`
}

func (c *Client) Config() (*Config, error) {
	cfg := &Config{}
	return cfg, c.do("GET", "/api/v1/config", nil, cfg)
}

type Batch struct {
	Accounts []*Account            `json:"accounts,omitempty"`
	Sessions []*transcript.Session `json:"sessions,omitempty"`
	Prompts  []*transcript.Prompt  `json:"prompts,omitempty"`
	Turns    []*transcript.Turn    `json:"turns,omitempty"`
}

type Client struct {
	Server, Key, Version string
	HTTP                 *http.Client
}

// Health sends this computer's health report (merged with the app's on the server).
func (c *Client) Health(report any) error { return c.do("POST", "/api/v1/health", report, nil) }

func (c *Client) do(method, path string, body, out any) error {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, strings.TrimRight(c.Server, "/")+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+c.Key)
	req.Header.Set("x-devicetally-agent", c.Version)
	req.Header.Set("content-type", "application/json")
	h := c.HTTP
	if h == nil {
		h = &http.Client{Timeout: 10 * time.Second}
	}
	res, err := h.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUpgradeRequired {
		return ErrUpdateRequired
	}
	if res.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("%s %s: %s %s", method, path, res.Status, msg)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

// Run performs one sync over every Claude config folder and returns the server config it fetched.
func Run(st *state.State, c *Client, claudeDirs []string) (*Config, error) {
	accounts := readEvents(st)
	cfg := &Config{}
	if err := c.do("GET", "/api/v1/config", nil, cfg); err != nil {
		return cfg, err
	}
	approved := map[string]bool{}
	for _, a := range cfg.Accounts {
		approved[a.UUID] = a.Status == "approved"
	}
	s := &run{st: st, c: c, cfg: cfg, approved: approved, keys: map[string][2]string{}}
	for _, dir := range claudeDirs {
		s.current = CurrentAccount(dir)
		if s.current != nil {
			accounts[s.current.UUID] = s.current
		}
	}
	// Every account seen goes to the server (so the dashboard can offer to approve it), never its data.
	for _, a := range accounts {
		s.accounts = append(s.accounts, a)
	}
	for _, dir := range claudeDirs {
		s.current = CurrentAccount(dir)
		if err := s.dir(dir); err != nil {
			return cfg, err
		}
	}
	if len(s.accounts) > 0 { // nothing else to send, still report accounts
		if err := c.do("POST", "/api/v1/ingest", Batch{Accounts: s.accounts}, nil); err != nil {
			return cfg, err
		}
	}
	return cfg, nil
}

type run struct {
	st       *state.State
	c        *Client
	cfg      *Config
	approved map[string]bool
	current  *Account
	accounts []*Account           // sent with the first batch, then cleared
	keys     map[string][2]string // cwd -> project key, name
}

func (s *run) dir(claudeDir string) error {
	var files []string
	filepath.WalkDir(filepath.Join(claudeDir, "projects"), func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".jsonl") {
			files = append(files, p)
		}
		return nil
	})
	sort.Strings(files) // main transcript before its subagents/ folder: sessions get their prompts first
	for _, f := range files {
		if err := s.file(f); err != nil {
			return err
		}
	}
	return nil
}

func (s *run) file(path string) error {
	fi, err := os.Stat(path)
	if err != nil {
		return nil
	}
	off := s.st.Offsets[path]
	if fi.Size() < off {
		off = 0 // rewritten: start over (the server ignores what it already has)
	}
	if fi.Size() == off {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		return err
	}
	chunk, err := transcript.Parse(bufio.NewReader(f), strings.Contains(filepath.ToSlash(path), "/subagents/"))
	if err != nil {
		return err
	}
	if chunk.Consumed == 0 {
		return nil
	}
	if !s.st.Paused {
		if err := s.send(chunk); err != nil {
			s.st.LastError = err.Error()
			return err
		}
	}
	s.st.Offsets[path] = off + chunk.Consumed
	return s.st.Save()
}

func (s *run) accountFor(promptID, sessionID string) string {
	if a := s.st.PromptAccount[promptID]; promptID != "" && a != "" {
		return a
	}
	if a := s.st.SessionAccount[sessionID]; a != "" {
		return a
	}
	if s.current != nil {
		return s.current.UUID
	}
	return ""
}

func (s *run) project(cwd string) (string, string) {
	k, ok := s.keys[cwd]
	if !ok {
		key, name := filter.ProjectKey(cwd)
		k = [2]string{key, name}
		s.keys[cwd] = k
	}
	return k[0], k[1]
}

// send applies the filter pipeline (docs/dev/PLAN.md §2.2) and uploads in server-sized batches.
func (s *run) send(ch *transcript.Chunk) error {
	type ctx struct {
		set filter.Settings
		ok  bool
	}
	sessionCtx := map[string]ctx{}
	sessions := map[string]*transcript.Session{}
	// In file order: a prompt without a hook record takes the account of the prompt before it.
	promptAccount := map[string]string{}
	for _, p := range ch.Prompts {
		p.AccountUUID = s.accountFor(p.ID, p.SessionID)
		promptAccount[p.ID] = p.AccountUUID
		s.st.SessionAccount[p.SessionID] = p.AccountUUID
	}
	for id, se := range ch.Sessions {
		se.AccountUUID = s.accountFor("", id)
		se.ProjectKey, se.ProjectName = s.project(se.CWD)
		set := filter.Resolve(s.cfg.Settings, se.AccountUUID, s.cfg.DeviceID, se.ProjectKey)
		ok := se.AccountUUID != "" && s.approved[se.AccountUUID] && set.Tracking && !filter.Excluded(se.CWD, set.ExcludedFolders) && !filter.Temporary(se.CWD)
		sessionCtx[id] = ctx{set, ok}
		if !ok {
			continue
		}
		if !set.Git {
			se.GitBranch = ""
			se.ProjectKey, se.ProjectName = "local/"+filepath.Base(se.CWD), filepath.Base(se.CWD)
		}
		if !set.FullPaths {
			se.CWD = filepath.Base(se.CWD)
		}
		if !set.SessionTitles {
			se.Title = ""
		} else if set.RedactSecrets {
			se.Title = filter.Redact(se.Title)
		}
		sessions[id] = se
	}

	var b Batch
	keep := func(sessionID, account string) (filter.Settings, bool) {
		sc := sessionCtx[sessionID]
		if !sc.ok || !s.approved[account] {
			return sc.set, false
		}
		if account != sessions[sessionID].AccountUUID { // account switched mid-session: its own settings
			set := filter.Resolve(s.cfg.Settings, account, s.cfg.DeviceID, sessions[sessionID].ProjectKey)
			return set, set.Tracking
		}
		return sc.set, true
	}
	for _, p := range ch.Prompts {
		set, ok := keep(p.SessionID, p.AccountUUID)
		if !ok {
			continue
		}
		switch {
		case !set.PromptText:
			p.Text = nil
		case set.RedactSecrets && p.Text != nil:
			r := filter.Redact(*p.Text)
			p.Text = &r
		}
		b.Prompts = append(b.Prompts, p)
	}
	for i, t := range ch.Turns {
		t.AccountUUID = promptAccount[ch.TurnPrompt[i]]
		if t.AccountUUID == "" {
			t.AccountUUID = s.accountFor(ch.TurnPrompt[i], t.SessionID)
		}
		set, ok := keep(t.SessionID, t.AccountUUID)
		if !ok || (t.IsSubagent && !set.Subagents) {
			continue
		}
		if !set.ModelEffort {
			t.Model, t.Effort = "", ""
		}
		if !set.Tokens {
			t.InTok, t.OutTok, t.CacheWriteTok, t.CacheReadTok, t.CacheWrite1hTok, t.ThinkingTok = 0, 0, 0, 0, 0, nil
		}
		b.Turns = append(b.Turns, t)
	}
	if len(b.Prompts) == 0 && len(b.Turns) == 0 {
		return nil
	}
	for len(b.Prompts) > 0 || len(b.Turns) > 0 {
		part := Batch{Accounts: s.accounts}
		part.Prompts, b.Prompts = split(b.Prompts)
		part.Turns, b.Turns = split(b.Turns)
		used := map[string]bool{}
		for _, p := range part.Prompts {
			used[p.SessionID] = true
		}
		for _, t := range part.Turns {
			used[t.SessionID] = true
		}
		for id := range used {
			part.Sessions = append(part.Sessions, sessions[id])
		}
		if err := s.c.do("POST", "/api/v1/ingest", part, nil); err != nil {
			return err
		}
		s.accounts = nil
	}
	return nil
}

func split[T any](a []T) ([]T, []T) {
	if len(a) <= maxItems {
		return a, nil
	}
	return a[:maxItems], a[maxItems:]
}

// readEvents moves the hook's events file aside and records which account sent each prompt.
// A leftover .processing file (crash mid-sync) is read first.
func readEvents(st *state.State) map[string]*Account {
	accounts := map[string]*Account{}
	proc := state.EventsFile() + ".processing"
	if _, err := os.Stat(proc); err != nil {
		os.Rename(state.EventsFile(), proc)
	} else if b, err := os.ReadFile(state.EventsFile()); err == nil {
		f, _ := os.OpenFile(proc, os.O_APPEND|os.O_WRONLY, 0o600)
		f.Write(b)
		f.Close()
		os.Remove(state.EventsFile())
	}
	b, err := os.ReadFile(proc)
	if err != nil {
		return accounts
	}
	for _, l := range bytes.Split(b, []byte("\n")) {
		var e Event
		if json.Unmarshal(l, &e) != nil || e.Account == nil {
			continue
		}
		accounts[e.Account.UUID] = e.Account
		if e.PromptID != "" {
			st.PromptAccount[e.PromptID] = e.Account.UUID
		}
	}
	if st.Save() == nil {
		os.Remove(proc)
	}
	return accounts
}
