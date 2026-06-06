# Multi-stage build. CI (GitHub Actions on Ubuntu x86_64) builds this reliably;
# the SIGSEGV that originally drove us to a runtime-only Dockerfile only
# manifests on certain TrueNAS hosts. The published GHCR image therefore goes
# back to a single self-contained image with `next build` happening inside.
#
# If you're building this locally on a host that hits the same SIGSEGV: pull
# the prebuilt image from ghcr.io/<owner>/<repo>:latest instead of running a
# local `docker build`.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time tag — CI passes --build-arg COMEXE_GIT_SHA=${{ github.sha }}.
# Baked into the runtime env so /api/version can compare against the
# latest commit on GitHub and show an "update available" banner.
ARG COMEXE_GIT_SHA=""
ENV COMEXE_GIT_SHA=$COMEXE_GIT_SHA

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid 1001 --shell /bin/false nextjs

# Writable directory for the /setup wizard's "Save & apply". Create it owned by
# nextjs so a host-mount or a no-mount fresh install both work without permission
# pain. If the user mounts a host dir over this, that mount needs to be writable
# by uid 1001 (or the user can `chmod 777` if they don't care about file ownership).
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Production deps only — saves ~150 MB vs the full builder node_modules.
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output + public assets (icons, etc.) + optional bookmarks.json.
# Override bookmarks at runtime via `-v /path/bookmarks.json:/app/bookmarks.json:ro`.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs bookmarks.example.json ./bookmarks.example.json

# Optional bookmarks file — only present when the build-context happened to
# include a bookmarks.json. Falls back to /api/config's DEFAULT_BOOKMARKS if
# absent.
COPY --chown=nextjs:nodejs bookmarks.jso[n] ./

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Liveness probe — node:20-slim has no curl/wget, so use Node's global fetch
# against the local-only /api/health route. start-period covers Next.js boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/next", "start"]
