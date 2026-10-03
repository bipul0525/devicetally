package schedule

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func unitDir() string {
	home, _ := os.UserHomeDir()
	if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
		return filepath.Join(x, "systemd", "user")
	}
	return filepath.Join(home, ".config", "systemd", "user")
}

const unit = "devicetally-sync"

func Install(exe string) error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return fmt.Errorf("no systemd: other AI tools sync only when Claude Code runs (or run `devicetally sync` from cron)")
	}
	if err := os.MkdirAll(unitDir(), 0o755); err != nil {
		return err
	}
	svc := fmt.Sprintf("[Unit]\nDescription=DeviceTally sync\n\n[Service]\nType=oneshot\nExecStart=%q sync\nNice=10\n", exe)
	timer := fmt.Sprintf("[Unit]\nDescription=DeviceTally sync every 5 minutes\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=%ds\n\n[Install]\nWantedBy=timers.target\n", IntervalSeconds)
	if err := os.WriteFile(filepath.Join(unitDir(), unit+".service"), []byte(svc), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(unitDir(), unit+".timer"), []byte(timer), 0o644); err != nil {
		return err
	}
	exec.Command("systemctl", "--user", "daemon-reload").Run()
	return exec.Command("systemctl", "--user", "enable", "--now", unit+".timer").Run()
}

func Remove() error {
	exec.Command("systemctl", "--user", "disable", "--now", unit+".timer").Run()
	os.Remove(filepath.Join(unitDir(), unit+".timer"))
	os.Remove(filepath.Join(unitDir(), unit+".service"))
	exec.Command("systemctl", "--user", "daemon-reload").Run()
	return nil
}
