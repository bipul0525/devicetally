//go:build !windows

package spawn

import "syscall"

func sysProcAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setsid: true} }
