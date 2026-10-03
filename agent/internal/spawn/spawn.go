// Package spawn starts a process that outlives its parent. Claude Code kills unfinished hooks
// when it exits (Phase 0), so the hook only queues and hands the upload to a detached `sync`.
package spawn

import (
	"os"
	"os/exec"
)

func Detached(args ...string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, args...)
	cmd.SysProcAttr = sysProcAttr()
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
