# Project Context

## Always Read First
- context.md — infrastructure and service details
- memory.md — past decisions and known issues
- skills.md — coding patterns and color palette

## What This Is
A custom homelab monitoring dashboard built with Next.js.
Displays real-time metrics from TrueNAS server and services.

## Infrastructure
- TrueNAS Scale IP: 192.168.88.196
- Prometheus: http://192.168.88.196:30104
- Grafana: http://192.168.88.196:30037
- Node Exporter: http://192.168.88.196:9100 (Docker)
- NVIDIA GPU Exporter: http://192.168.88.196:9835 (Docker)
- Router: MikroTik hAP ax³ at 192.168.88.1
- RouterOS: 7.22.1 (stable)

## Services Running on TrueNAS
- Radarr: :30025 | apiKey: ***REMOVED***
- Sonarr: :33027 | apiKey: ***REMOVED***
- Bazarr: :30046 | apiKey: ***REMOVED***
- Tautulli: :30047 | apiKey: ***REMOVED***
- qBittorrent: :30024 | admin/admin
- Overseerr: :30002 | apiKey: ***REMOVED***
- PiHole: :20720 | token: ***REMOVED***
- Prowlarr: :30050 | apiKey: ***REMOVED***
- Nginx Proxy: :30020 | ***REMOVED*** / ***REMOVED***
- SpeedTracker: :30220 (display only, do NOT trigger tests)
- Uptime Kuma: :31050
- Overseerr: :30002
- Homepage: running separately

## Hardware
- CPU: Intel Xeon E5-2680 v4 (28 cores)
- RAM: 63 GB ECC
- GPU: NVIDIA GeForce GTX 1660 SUPER (6GB)
- Storage Pool: /mnt/Pool (4.4TB)
- Media: /mnt/Pool/Media/

## Location
- Launceston, Tasmania, Australia
- Weather API: open-meteo.com
  lat: -41.4419, lon: 147.1450