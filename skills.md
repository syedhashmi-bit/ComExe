Here's the complete skills.md — copy and paste this exactly into the file:

markdown# Project Skills

## Tech Stack
- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- No external chart libraries — use Canvas or inline SVG

## Data Fetching Pattern
All fetching in useEffect with setInterval:

```typescript
useEffect(() => {
  const fetchData = async () => {
    try {
      const res = await fetch('http://192.168.88.196:30104/api/v1/query?query=METRIC')
      const json = await res.json()
      const value = parseFloat(json.data.result[0]?.value[1] || '0')
      setState(value)
    } catch (e) {
      console.error(e)
    }
  }
  fetchData()
  const interval = setInterval(fetchData, 10000)
  return () => clearInterval(interval)
}, [])
```

## Prometheus Query Format
GET http://192.168.88.196:30104/api/v1/query?query=METRIC_NAME
Response shape: { data: { result: [{ value: [timestamp, "value"] }] } }

## Common Prometheus Queries
- CPU: 100-(avg(rate(node_cpu_seconds_total{mode="idle"}[1m]))*100)
- RAM total: node_memory_MemTotal_bytes
- RAM available: node_memory_MemAvailable_bytes
- RAM reclaimable: node_memory_SReclaimable_bytes
- Network RX: rate(node_network_receive_bytes_total{device="enp4s0"}[1m])
- Network TX: rate(node_network_transmit_bytes_total{device="enp4s0"}[1m])
- Uptime: node_time_seconds - node_boot_time_seconds
- Disk size: node_filesystem_size_bytes
- Disk used: node_filesystem_used_bytes
- GPU utilization: nvidia_smi_utilization_gpu_ratio (multiply by 100 for %)
- GPU temp: nvidia_smi_temperature_gpu (already Celsius)
- GPU VRAM used: nvidia_smi_memory_used_bytes (divide by 1073741824 for GB)
- GPU VRAM total: nvidia_smi_memory_total_bytes (divide by 1073741824 for GB)
- GPU power: nvidia_smi_power_draw_watts (already watts)
- GPU power limit: nvidia_smi_power_limit_watts (already watts)

## Refresh Intervals
- System metrics (CPU, RAM, Network, GPU): 10 seconds
- Services (Radarr, Sonarr, etc): 10 seconds
- Uptime: 60 seconds
- SpeedTest display: 60 seconds
- Weather: 600 seconds
- MikroTik: 30 seconds (attempt only, CORS will always block)

## Card Component Pattern
Each card follows this structure:
- Top accent border: 2px solid, color per card type
- Label: 10px uppercase letter-spacing 0.12em muted text + icon
- Main value: large monospace white number, font-variant-numeric tabular-nums
- Progress bar or sparkline below value
- Secondary stats in muted text at bottom

## Color Palette
- Page background: #0a0c12
- Card background: rgba(255,255,255,0.04)
- Card border: rgba(255,255,255,0.08)
- Card border hover: rgba(255,255,255,0.15)
- Text primary: #ffffff
- Text secondary: rgba(255,255,255,0.65)
- Text muted: rgba(255,255,255,0.4)
- Cyan: #06b6d4
- Green: #10b981
- Amber: #f59e0b
- Red: #ef4444
- Purple: #8b5cf6
- Blue: #3b82f6
- Orange: #f97316

## Card Accent Colors
- CPU: #06b6d4
- Memory: #10b981
- Filesystems: #f59e0b
- Network: #3b82f6
- GPU: #ef4444
- Speedtest: #8b5cf6
- System: #6b7280

## Progress Bar Style
- Height: 5px
- Border-radius: 999px
- Track: rgba(255,255,255,0.08)
- Fill: linear-gradient using card accent color

## Sparkline Style
- Height: 36px
- Line color: card accent color
- Subtle gradient fill below line
- No axes or labels

## Rules — Never Break These
- Never create Next.js API routes (causes build errors)
- Never trigger speedtests (SpeedTracker handles scheduling)
- Always wrap every fetch in try/catch
- All external links open in _blank
- Use tabular-nums for all metric numbers
- All CORS failures handled gracefully, show dashes not errors
- No external chart libraries, use Canvas or SVG only
- Mobile responsiveness not required

## Known CORS Failures
These will always fail due to CORS, handle gracefully:
- MikroTik REST API at 192.168.88.1
- PiHole API at 192.168.88.196:20720
- Bazarr API at 192.168.88.196:30046
- qBittorrent API at 192.168.88.196:30024

For these: use fetch mode no-cors for ping/status check only.
Show green dot if server responds, dashes for stats.

## SpeedTest API
- Fetch: GET http://192.168.88.196:30220/api/v1/results?take=20
- Display only, never trigger tests
- Response shape: { data: [ { download, upload, ping, created_at } ] }
- Download and upload may be in bits/s, divide by 1000000 for Mbps
- Check if value is over 1000 to determine if conversion needed

## Filesystem Filter
- Only show paths starting with /mnt/Pool/Media/
- Exclude: tmpfs, devtmpfs, overlay filesystem types

## Memory Warning Calculation
- real_used = MemTotal - MemAvailable - SReclaimable
- real_percent = real_used / MemTotal * 100
- WARNING only if real_percent > 85%
- CRITICAL only if real_percent > 95%
- Donut chart shows total including ZFS cache
- Status bar uses real_percent only