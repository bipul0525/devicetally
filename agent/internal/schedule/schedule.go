// Package schedule runs `devicetally sync` every 5 minutes with the OS's own scheduler. It is only
// installed while another AI tool is tracked: those tools have no hooks, so nothing else would trigger
// a sync. Each run is short (tokscale reads in well under a second) and exits; nothing stays resident.
package schedule

const Label = "dev.devicetally.sync"
const IntervalSeconds = 300
