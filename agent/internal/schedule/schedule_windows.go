package schedule

import (
	"fmt"
	"os/exec"
	"syscall"
)

const task = "DeviceTally Sync"

func run(args ...string) error {
	cmd := exec.Command("schtasks", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func Install(exe string) error {
	// conhost --headless (Windows 10 1809+) runs the console agent without flashing a window every 5 minutes.
	return run("/Create", "/F", "/SC", "MINUTE", "/MO", fmt.Sprint(IntervalSeconds/60), "/TN", task, "/TR", fmt.Sprintf(`conhost.exe --headless "%s" sync`, exe))
}

func Remove() error {
	run("/Delete", "/F", "/TN", task)
	return nil
}
