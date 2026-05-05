# Project Memory

## Key Decisions Made

### Architecture
- All data fetching is CLIENT-SIDE ONLY in page.tsx
- No Next.js API routes — they cause build errors in this setup
- No server-side rendering for metrics data

### Known CORS Issues
- MikroTik REST API (192.168.88.1) always blocked by CORS
  → Use hardcoded fallback values, make bar clickable
- PiHole, Bazarr, qBittorrent sometimes blocked
  → Use no-cors ping for status, try/catch for data
- All service API calls wrapped in try/catch
  → Show "—" for stats gracefully, never crash

### GPU Metrics (nvidia_smi exporter)
- nvidia_smi_utilization_gpu_ratio → already 0-1, multiply by 100 only
- nvidia_smi_temperature_gpu → already Celsius, use directly
- nvidia_smi_memory_used/total_bytes → divide by 1073741824 for GB
- nvidia_smi_power_draw_watts → already watts, use directly

### Memory / RAM Warning Fix
- TrueNAS uses ZFS ARC cache which inflates RAM usage
- real_used = MemTotal - MemAvailable - SReclaimable
- Only warn if real_used / MemTotal > 85%
- Donut chart can show total usage, warning uses real_used only

### SpeedTest
- Do NOT trigger tests — SpeedTracker app handles scheduling
- Only fetch: GET http://192.168.88.196:30220/api/v1/results?take=20
- Refresh display every 60 seconds

### Filesystems
- Only show paths starting with /mnt/Pool/Media/
- Exclude: tmpfs, devtmpfs, overlay

### Prometheus Docker
- Container ID: 8fe9924cfe12
- Config: /mnt/.ix-apps/app_mounts/prometheus/config/prometheus.yml
- Reload: docker restart 8fe9924cfe12

## Bugs Fixed Previously
- autoprefixer missing → npm install autoprefixer postcss tailwindcss
- PowerShell execution policy → Set-ExecutionPolicy RemoteSigned
- Broken API route file → delete app/api/mikrotik/route.js
- GPU showing wrong values → wrong unit conversions (see above)
- Filesystem showing all mounts → filter to /mnt/Pool/Media/ only