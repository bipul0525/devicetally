// Package update replaces the agent binary with the latest GitHub release, after checking its SHA-256
// against the release's checksums.txt. The previous binary is kept for `devicetally update --rollback`.
package update

import (
	"bufio"
	"crypto/sha256"
	"devicetally/agent/internal/netx"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

// API is the GitHub API base (tests point it at a fake server).
var API = "https://api.github.com"

type Release struct {
	Version string
	Binary  string // download URL for this platform
	Sums    string // download URL of checksums.txt
	Asset   string // asset file name, as listed in checksums.txt
}

// AssetName is the goreleaser binary name for this platform (see .goreleaser.yaml).
func AssetName(goos, goarch string) string {
	n := fmt.Sprintf("devicetally_%s_%s", goos, goarch)
	if goos == "windows" {
		n += ".exe"
	}
	return n
}

var client = netx.Client(60 * time.Second)

func Latest(repo string) (*Release, error) {
	res, err := client.Get(fmt.Sprintf("%s/repos/%s/releases/latest", API, repo))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("checking releases: %s", res.Status)
	}
	var r struct {
		Tag    string `json:"tag_name"`
		Assets []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		return nil, err
	}
	rel := &Release{Version: strings.TrimPrefix(r.Tag, "v"), Asset: AssetName(runtime.GOOS, runtime.GOARCH)}
	for _, a := range r.Assets {
		switch a.Name {
		case rel.Asset:
			rel.Binary = a.URL
		case "checksums.txt":
			rel.Sums = a.URL
		}
	}
	if rel.Binary == "" || rel.Sums == "" {
		return nil, fmt.Errorf("release %s has no %s or checksums.txt", r.Tag, rel.Asset)
	}
	return rel, nil
}

// FromServer describes the release a DeviceTally server serves at /dl/ (its edge-cached copy of
// the GitHub release, much faster than GitHub on some networks).
func FromServer(server, version string) *Release {
	asset := AssetName(runtime.GOOS, runtime.GOARCH)
	base := strings.TrimRight(server, "/") + "/dl/"
	return &Release{Version: version, Binary: base + asset, Sums: base + "checksums.txt", Asset: asset}
}

// Newer reports whether version a is newer than b (semver major.minor.patch).
func Newer(a, b string) bool {
	pa, pb := parts(a), parts(b)
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func parts(v string) [3]int {
	var p [3]int
	for i, s := range strings.SplitN(strings.SplitN(strings.TrimPrefix(v, "v"), "-", 2)[0], ".", 3) {
		fmt.Sscanf(s, "%d", &p[i])
	}
	return p
}

func get(url string, limit int64) ([]byte, error) {
	res, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s: %s", url, res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, limit))
}

// Install downloads the release, verifies its checksum and swaps it in for the binary at path.
func Install(rel *Release, path string) error {
	sums, err := get(rel.Sums, 1<<20)
	if err != nil {
		return err
	}
	want := ""
	sc := bufio.NewScanner(strings.NewReader(string(sums)))
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) == 2 && f[1] == rel.Asset {
			want = f[0]
		}
	}
	if want == "" {
		return fmt.Errorf("checksums.txt has no entry for %s", rel.Asset)
	}
	bin, err := get(rel.Binary, 100<<20)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(bin)
	if got := hex.EncodeToString(sum[:]); got != want {
		return fmt.Errorf("checksum mismatch for %s: refusing to install (got %s, want %s)", rel.Asset, got, want)
	}
	tmp := path + ".new"
	if err := os.WriteFile(tmp, bin, 0o700); err != nil {
		return err
	}
	// Keep the old binary for rollback. On Windows a running .exe can be renamed but not overwritten.
	old := path + ".old"
	os.Remove(old)
	if err := os.Rename(path, old); err != nil && !errors.Is(err, os.ErrNotExist) {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Rename(old, path)
		return err
	}
	return nil
}

// Rollback restores the binary that the last update replaced.
func Rollback(path string) error {
	old := path + ".old"
	if _, err := os.Stat(old); err != nil {
		return fmt.Errorf("no previous version to roll back to")
	}
	bad := path + ".bad"
	os.Remove(bad)
	if err := os.Rename(path, bad); err != nil {
		return err
	}
	return os.Rename(old, path)
}
