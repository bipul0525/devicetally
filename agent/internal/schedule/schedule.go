// Package schedule runs `devicetally sync` every 5 minutes with the OS's own scheduler, on every
// joined computer: it checks in (so the computer shows as online with the app closed) and syncs other
// AI tools, which have no hooks. Each run is short and exits; nothing stays resident.
package schedule

const Label = "dev.devicetally.sync"
const IntervalSeconds = 300
