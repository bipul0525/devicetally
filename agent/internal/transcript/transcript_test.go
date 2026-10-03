package transcript

import (
	"os"
	"strings"
	"testing"
)

func parseFile(t *testing.T, name string, sub bool) *Chunk {
	f, err := os.Open("../../../fixtures/transcripts/" + name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	c, err := Parse(f, sub)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestParseSession(t *testing.T) {
	c := parseFile(t, "session.jsonl", false)
	if len(c.Prompts) != 2 || c.Prompts[0].ID != "p-1" || c.Prompts[1].ID != "p-2" || *c.Prompts[1].Text != "Now add tests" {
		t.Fatalf("prompts: %+v", c.Prompts)
	}
	if len(c.Turns) != 3 {
		t.Fatalf("want 3 turns (msg_A collapsed, <synthetic> skipped), got %d", len(c.Turns))
	}
	a := c.Turns[0]
	if a.ID != "msg_A" || a.OutTok != 106 || a.ThinkingTok == nil || *a.ThinkingTok != 20 || a.Effort != "high" {
		t.Fatalf("msg_A should keep its most complete line: %+v", a)
	}
	if c.Turns[1].CacheWrite1hTok != 200 || c.Turns[0].CacheWrite1hTok != 0 {
		t.Fatalf("1-hour cache writes: %+v", c.Turns[1])
	}
	if c.Turns[2].Effort != "medium" || c.TurnPrompt[2] != "p-2" || c.TurnPrompt[0] != "p-1" {
		t.Fatalf("effort/prompt links wrong: %+v %v", c.Turns[2], c.TurnPrompt)
	}
	s := c.Sessions["11111111-1111-4111-8111-111111111111"]
	if s.Title != "Fix login and add tests" || s.GitBranch != "main" || s.Entrypoint != "claude-vscode" || s.CCVersion != "2.1.283" {
		t.Fatalf("session: %+v", s)
	}
	if len(c.Drift) != 0 {
		t.Fatalf("unexpected drift %v", c.Drift)
	}
}

func TestParseSubagent(t *testing.T) {
	c := parseFile(t, "subagent.jsonl", true)
	if len(c.Prompts) != 0 {
		t.Fatal("a subagent's task text is not a user prompt")
	}
	if len(c.Turns) != 1 || !c.Turns[0].IsSubagent || c.Turns[0].Model != "claude-haiku-4-5-20251001" {
		t.Fatalf("%+v", c.Turns)
	}
}

func TestPartialLastLineIsLeftForNextSync(t *testing.T) {
	b, _ := os.ReadFile("../../../fixtures/transcripts/session.jsonl")
	cut := len(b) - 10
	c, err := Parse(strings.NewReader(string(b[:cut])), false)
	if err != nil {
		t.Fatal(err)
	}
	if c.Consumed >= int64(cut) || b[c.Consumed-1] != '\n' {
		t.Fatalf("consumed %d of %d; must stop at the last complete line", c.Consumed, cut)
	}
}

func TestDriftIsReported(t *testing.T) {
	c, _ := Parse(strings.NewReader(`{"type":"assistant","sessionId":"s","message":{"id":"m","model":"x"}}`+"\n"), false)
	if len(c.Drift) != 1 || c.Drift[0] != "message.usage" {
		t.Fatalf("drift %v", c.Drift)
	}
}
