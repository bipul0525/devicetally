// Package tools reads other AI coding tools' token usage with tokscale (MIT, github.com/junhoyeo/tokscale),
// pinned to one version and verified against npm's sha512 integrity before it is ever run.
// Only daily token totals per tool and model are read: no prompts, no file contents.
package tools

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"devicetally/agent/internal/state"
)

// Version of tokscale DeviceTally is tested against (docs/dev/spikes/m10-tools.md).
const Version = "4.17.0"

// npm package and sha512 integrity per platform, from `npm view @tokscale/cli-<pkg>@4.17.0 dist.integrity`.
var packages = map[string][2]string{
	"darwin/arm64":     {"cli-darwin-arm64", "sha512-/Hmgh1VxxLdCo6ou+I7r12E0G4T4c0zzZwZ5iwdynlZKm1IEhoqPB0SagTmVEiLZSMV8zLxptO1GFuOKxMqwiQ=="},
	"darwin/amd64":     {"cli-darwin-x64", "sha512-AsAlm80CenvCv9pC/ys46Vmq7GJbgkufO2LxMAWRE5cubU4EBe0SqMew6+HpRY/BcAKJ5+4RFPQpEZS3Tx12lw=="},
	"linux/amd64":      {"cli-linux-x64-gnu", "sha512-wJfvqoU0dXOHVmgEdPtappcu05py0vc7jCVeWTWYS4UoJi0LuIGhTxRhLjfSb5oOUV9RE+7X+wZ3Xx7lIZ+6XA=="},
	"linux/arm64":      {"cli-linux-arm64-gnu", "sha512-wobrV3PJGeapz6ViLe5Ad6TU7+2QHQzZjf3XeVv5w25VOPZ+8XZN/pPpsdmawfguymPA2cAc34rxTj5G5M0wrg=="},
	"linux/amd64/musl": {"cli-linux-x64-musl", "sha512-ydYrHyGMBhub/t50EknkA5Xr0cp9p4TZxOCbBqPssXxwQRHHOCxpZQNW0s5ZdxOYW4igapmDRb0PiiheLJFLrQ=="},
	"linux/arm64/musl": {"cli-linux-arm64-musl", "sha512-udoB3O3xHsFlQosK5pkmdJMO1Cb9uau7BLkBDFKW1M3uJq+5D2crTRKgv5NsAhjLTlTdr20C61KdGkkRWRhPXg=="},
	"windows/amd64":    {"cli-win32-x64-msvc", "sha512-6NDfFj+LuBjnJDYzo5af9neLudojimL1y1SQvCvgNMvNmx94s+9tSyEZVlW9U6gL61MqvRaj2QK2w6iXYqyAfw=="},
	"windows/arm64":    {"cli-win32-arm64-msvc", "sha512-tovKL5nM84efBhJKqthZbH2HkuG2weKEbex4Pw0i7qOqOv7iCF+IIru39hJXx0FIicl8THhyYxQ9NHK1gGnfYQ=="},
}

// Supported tools (tokscale client ids) and where their logs live, to detect them without tokscale.
var Supported = []string{"codex", "kimi", "opencode"}

func Detect() []string {
	home, _ := os.UserHomeDir()
	env := func(k, fallback string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return fallback
	}
	dirs := map[string][]string{
		"codex":    {filepath.Join(env("CODEX_HOME", filepath.Join(home, ".codex")), "sessions")},
		"opencode": {filepath.Join(env("XDG_DATA_HOME", filepath.Join(home, ".local", "share")), "opencode")},
		"kimi":     {filepath.Join(home, ".kimi", "sessions"), filepath.Join(env("KIMI_CODE_HOME", filepath.Join(home, ".kimi-code")), "sessions")},
	}
	var found []string
	for _, t := range Supported {
		for _, d := range dirs[t] {
			if fi, err := os.Stat(d); err == nil && fi.IsDir() {
				found = append(found, t)
				break
			}
		}
	}
	return found
}

func platformKey() string {
	k := runtime.GOOS + "/" + runtime.GOARCH
	if runtime.GOOS == "linux" {
		if m, _ := filepath.Glob("/lib/ld-musl-*"); len(m) > 0 {
			k += "/musl"
		}
	}
	return k
}

func binDir() string { return filepath.Join(state.Dir(), "tokscale", Version) }

func binPath() string {
	name := "tokscale"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(binDir(), name)
}

// Ensure returns the pinned tokscale binary, downloading it through the DeviceTally server once.
func Ensure(server string) (string, error) {
	if _, err := os.Stat(binPath()); err == nil {
		return binPath(), nil
	}
	pkg, ok := packages[platformKey()]
	if !ok {
		return "", fmt.Errorf("other AI tools are not supported on %s", platformKey())
	}
	url := fmt.Sprintf("%s/dl/tokscale/%s/%s.tgz", strings.TrimRight(server, "/"), Version, pkg[0])
	res, err := (&http.Client{Timeout: 5 * time.Minute}).Get(url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("downloading tokscale: %s", res.Status)
	}
	tgz, err := io.ReadAll(io.LimitReader(res.Body, 200<<20))
	if err != nil {
		return "", err
	}
	sum := sha512.Sum512(tgz)
	if got := "sha512-" + base64.StdEncoding.EncodeToString(sum[:]); got != pkg[1] {
		return "", fmt.Errorf("tokscale %s failed its integrity check: not installing", pkg[0])
	}
	return binPath(), extract(tgz, binDir())
}

// extract writes package/bin/* (the binary and any library next to it) into dir, atomically.
func extract(tgz []byte, dir string) error {
	gz, err := gzip.NewReader(bytes.NewReader(tgz))
	if err != nil {
		return err
	}
	tmp := dir + ".tmp"
	os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name, ok := strings.CutPrefix(h.Name, "package/bin/")
		if !ok || h.Typeflag != tar.TypeReg || name == "" || strings.Contains(name, "/") || strings.Contains(name, "..") {
			continue
		}
		b, err := io.ReadAll(io.LimitReader(tr, 200<<20))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(tmp, name), b, 0o700); err != nil {
			return err
		}
	}
	os.RemoveAll(dir)
	return os.Rename(tmp, dir)
}

// Row is one tool + model's totals for one day.
type Row struct {
	Tool       string `json:"tool"`
	Model      string `json:"model"`
	Provider   string `json:"provider,omitempty"`
	In         int64  `json:"in_tok"`
	Out        int64  `json:"out_tok"`
	CacheRead  int64  `json:"cache_read_tok"`
	CacheWrite int64  `json:"cache_write_tok"`
	Reasoning  int64  `json:"reasoning_tok"`
	Messages   int64  `json:"messages"`
}

type Day struct {
	Day  string `json:"day"`
	Rows []Row  `json:"rows"`
}

// Daily asks tokscale for per-day totals of the given tools since `since` ("" = all history).
// Pricing downloads are turned off: they took ~30 s on some networks, and the server prices tokens itself.
func Daily(bin string, tools []string, since string) ([]Day, error) {
	args := []string{"graph", "--no-spinner", "-c", strings.Join(tools, ",")}
	if since != "" {
		args = append(args, "--since", since)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = append(os.Environ(), "TOKSCALE_PRICING_CACHE_ONLY=1")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("tokscale: %w", err)
	}
	return parseGraph(out)
}

// parseGraph reads only the fields we need; tokscale's JSON is unversioned (camelCase as of 4.17).
func parseGraph(b []byte) ([]Day, error) {
	var g struct {
		Contributions []struct {
			Date    string `json:"date"`
			Clients []struct {
				Client     string `json:"client"`
				ModelID    string `json:"modelId"`
				ProviderID string `json:"providerId"`
				Messages   int64  `json:"messages"`
				Tokens     struct {
					Input      int64 `json:"input"`
					Output     int64 `json:"output"`
					CacheRead  int64 `json:"cacheRead"`
					CacheWrite int64 `json:"cacheWrite"`
					Reasoning  int64 `json:"reasoning"`
				} `json:"tokens"`
			} `json:"clients"`
		} `json:"contributions"`
	}
	if err := json.Unmarshal(b, &g); err != nil {
		return nil, fmt.Errorf("reading tokscale output: %w", err)
	}
	var days []Day
	for _, c := range g.Contributions {
		var rows []Row
		for _, e := range c.Clients {
			if e.Client == "" || e.ModelID == "" {
				continue
			}
			rows = append(rows, Row{e.Client, e.ModelID, e.ProviderID, e.Tokens.Input, e.Tokens.Output, e.Tokens.CacheRead, e.Tokens.CacheWrite, e.Tokens.Reasoning, e.Messages})
		}
		if len(rows) > 0 {
			sort.Slice(rows, func(i, j int) bool { return rows[i].Tool+rows[i].Model < rows[j].Tool+rows[j].Model })
			days = append(days, Day{c.Date, rows})
		}
	}
	return days, nil
}
