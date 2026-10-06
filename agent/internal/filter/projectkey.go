package filter

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ProjectKey identifies a project across machines: the normalised `origin` remote
// (host/owner/repo, lowercase host, no scheme, user or .git), else "local/<folder name>".
// Test vectors: fixtures/project-key.json.
func ProjectKey(cwd string) (key, name string) {
	// Claude Code's agent worktrees (<repo>/.claude/worktrees/<name>) belong to <repo>, also after
	// the folder is deleted.
	if i := strings.Index(filepath.ToSlash(cwd), "/.claude/worktrees/"); i > 0 {
		cwd = cwd[:i]
	}
	root, url := gitOrigin(cwd)
	if url != "" {
		if k := NormalizeRemote(url); k != "" {
			return k, k[strings.LastIndex(k, "/")+1:]
		}
	}
	// A repo without a remote: its folder name, not the subfolder Claude Code ran in. (Not a home
	// folder kept in git for dotfiles: every project would become "home".)
	if home, _ := os.UserHomeDir(); root != "" && root != home && filepath.Dir(root) != root {
		cwd = root
	}
	base := filepath.Base(cwd)
	return "local/" + base, base
}

var scpLike = regexp.MustCompile(`^(?:[^@/]+@)?([^:/]+):(.+)$`)

func NormalizeRemote(u string) string {
	u = strings.TrimSpace(u)
	var host, p string
	if i := strings.Index(u, "://"); i >= 0 {
		rest := u[i+3:]
		if at := strings.LastIndex(strings.SplitN(rest, "/", 2)[0], "@"); at >= 0 {
			rest = rest[at+1:]
		}
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) < 2 {
			return ""
		}
		host, p = parts[0], parts[1]
		if h, _, ok := strings.Cut(host, ":"); ok {
			host = h // drop port
		}
	} else if m := scpLike.FindStringSubmatch(u); m != nil {
		host, p = m[1], m[2]
	} else {
		return ""
	}
	p = strings.TrimSuffix(strings.Trim(p, "/"), ".git")
	if host == "" || p == "" {
		return ""
	}
	return strings.ToLower(host) + "/" + p
}

// gitOrigin walks up from dir to the repo root and reads [remote "origin"] url from .git/config.
func gitOrigin(dir string) (root, url string) {
	for d := dir; ; d = filepath.Dir(d) {
		gitPath := filepath.Join(d, ".git")
		if fi, err := os.Stat(gitPath); err == nil {
			cfg := filepath.Join(gitPath, "config")
			if !fi.IsDir() { // worktree or submodule: "gitdir: <path>"
				b, _ := os.ReadFile(gitPath)
				gd := strings.TrimSpace(strings.TrimPrefix(string(b), "gitdir:"))
				if !filepath.IsAbs(gd) {
					gd = filepath.Join(d, gd)
				}
				cfg = filepath.Join(gd, "config")
				if c := filepath.Join(gd, "commondir"); fileExists(c) {
					cb, _ := os.ReadFile(c)
					cfg = filepath.Join(gd, strings.TrimSpace(string(cb)), "config")
				}
			}
			return d, readOrigin(cfg)
		}
		if filepath.Dir(d) == d {
			return "", ""
		}
	}
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func readOrigin(cfg string) string {
	f, err := os.Open(cfg)
	if err != nil {
		return ""
	}
	defer f.Close()
	in := false
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		l := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(l, "[") {
			in = l == `[remote "origin"]`
			continue
		}
		if k, v, ok := strings.Cut(l, "="); in && ok && strings.TrimSpace(k) == "url" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
