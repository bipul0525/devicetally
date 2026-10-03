//go:build !darwin && !linux && !windows

package schedule

import "errors"

func Install(string) error { return errors.New("no scheduler on this platform") }
func Remove() error        { return nil }
