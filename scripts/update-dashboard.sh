#!/usr/bin/env bash
# ── ComExe health-gated deploy ───────────────────────────────────────────────
# Drop-in replacement for /root/update-dashboard.sh on TrueNAS.
#
# The old script was `docker pull && docker stop && docker rm && docker run`.
# If the new image was broken the old container was already gone — downtime
# with no way back. This pulls, starts the new image as a CANDIDATE on a spare
# port, waits for its HEALTHCHECK to report healthy, and only then promotes it.
# A failed candidate leaves the running container untouched and exits non-zero.
#
# The previous image is retagged :rollback before every pull, so a bad deploy
# that somehow passes its healthcheck is still one command from being undone.
#
# NOTE: with `--network host` two containers can't share port 3000, so the
# promotion step is a brief stop/start rather than a true zero-downtime
# cutover. The win is that a broken image never replaces a working one.
#
# Install:
#   cp scripts/update-dashboard.sh /root/update-dashboard.sh
#   chmod +x /root/update-dashboard.sh
#
# /app/data (wizard config, alerts, history) is always kept on the host. If
# the running container has no mount there, its data is copied out to
# DATA_DIR (default /root/comexe-data) and mounted from then on.

set -euo pipefail

IMAGE="ghcr.io/syedhashmi-bit/comexe:latest"
NAME="comexe"
CANDIDATE="comexe-next"
CANDIDATE_PORT="${CANDIDATE_PORT:-3001}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"   # seconds to wait for healthy
DATA_DIR="${DATA_DIR:-/root/comexe-data}"

log()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!!!\033[0m %s\n' "$*"; }
die()  { printf '\033[31mxxx\033[0m %s\n' "$*" >&2; exit 1; }

cleanup_candidate() {
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
}
trap cleanup_candidate EXIT

docker inspect "$NAME" >/dev/null 2>&1 || die "Container '$NAME' not found. Deploy it once by hand first."

# Reuse the running container's env so secrets live in exactly one place (the
# container) instead of being duplicated into this script. Image-level vars are
# filtered out so we don't pin things the new image should choose for itself —
# COMEXE_GIT_SHA especially: carrying the old image's SHA over froze
# /api/version on it and left "update available" showing forever.
log "Capturing environment from running container"
mapfile -t ENV_ARGS < <(
  docker inspect "$NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -vE '^(PATH|HOME|HOSTNAME|TERM|NODE_VERSION|YARN_VERSION|NEXT_TELEMETRY|PORT|COMEXE_GIT_SHA)=' \
    | grep -vE '^\s*$' \
    | sed 's/^/--env=/'
)
[ ${#ENV_ARGS[@]} -gt 0 ] || warn "No environment variables captured — check the new container afterwards"

# Bind mounts by host path, named (and anonymous) volumes by volume name.
mapfile -t MOUNT_ARGS < <(
  docker inspect "$NAME" --format \
    '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}:{{.Destination}}{{if not .RW}}:ro{{end}}{{println}}{{else if eq .Type "volume"}}{{.Name}}:{{.Destination}}{{if not .RW}}:ro{{end}}{{println}}{{end}}{{end}}' \
    | grep -vE '^\s*$' \
    | sed 's/^/--volume=/'
)

PREV_IMAGE_ID="$(docker inspect "$NAME" --format '{{.Image}}')"
log "Tagging current image as :rollback"
docker tag "$PREV_IMAGE_ID" "ghcr.io/syedhashmi-bit/comexe:rollback" >/dev/null

log "Pulling $IMAGE"
docker pull "$IMAGE"

NEW_IMAGE_ID="$(docker inspect "$IMAGE" --format '{{.Id}}')"
if [ "$NEW_IMAGE_ID" = "$PREV_IMAGE_ID" ]; then
  log "Already running the latest image — nothing to do."
  exit 0
fi

# ── Keep /app/data across the swap ───────────────────────────────────────────
# config.json (every key the /setup wizard saved), alerts.json and history all
# live in /app/data. Unmounted, they sit in the container's own writable layer
# and the `docker rm` below deletes them — every update sent you back to the
# setup wizard. Rescue them to the host first; nothing has been touched yet,
# so a failed copy aborts with the old container still running.
if [ -z "$(docker inspect "$NAME" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}x{{end}}{{end}}')" ]; then
  warn "/app/data is not mounted — copying it to $DATA_DIR and mounting that from now on"
  mkdir -p "$DATA_DIR"
  docker cp "$NAME:/app/data/." "$DATA_DIR/" || die "Could not copy /app/data out of '$NAME'. Nothing changed."
  chown -R 1001:1001 "$DATA_DIR"   # the image runs as nextjs (uid 1001)
  MOUNT_ARGS+=("--volume=$DATA_DIR:/app/data")
fi

# ── Stage the candidate ──────────────────────────────────────────────────────
cleanup_candidate
log "Starting candidate on port $CANDIDATE_PORT"
docker run -d \
  --name "$CANDIDATE" \
  --network host \
  --env "PORT=$CANDIDATE_PORT" \
  "${ENV_ARGS[@]}" \
  ${MOUNT_ARGS[@]+"${MOUNT_ARGS[@]}"} \
  "$IMAGE" >/dev/null

log "Waiting up to ${HEALTH_TIMEOUT}s for the candidate to become healthy"
deadline=$(( SECONDS + HEALTH_TIMEOUT ))
healthy=0
while [ $SECONDS -lt $deadline ]; do
  # Prefer the image's own HEALTHCHECK; fall back to probing /api/health
  # directly for images built before it was added.
  status="$(docker inspect "$CANDIDATE" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo gone)"

  if [ "$status" = "healthy" ]; then healthy=1; break; fi
  if [ "$status" = "none" ] && curl -fsS -m 3 "http://localhost:${CANDIDATE_PORT}/api/health" >/dev/null 2>&1; then
    healthy=1; break
  fi
  if ! docker inspect "$CANDIDATE" >/dev/null 2>&1; then
    die "Candidate container exited. Logs:
$(docker logs --tail 40 "$CANDIDATE" 2>&1 || true)
Existing container left running untouched."
  fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  warn "Candidate never became healthy — aborting. Last logs:"
  docker logs --tail 40 "$CANDIDATE" 2>&1 || true
  die "Deploy aborted. '$NAME' is still running the previous image."
fi

log "Candidate healthy — promoting"
cleanup_candidate

docker stop "$NAME" >/dev/null
docker rm   "$NAME" >/dev/null

docker run -d \
  --name "$NAME" \
  --network host \
  --restart unless-stopped \
  "${ENV_ARGS[@]}" \
  ${MOUNT_ARGS[@]+"${MOUNT_ARGS[@]}"} \
  "$IMAGE" >/dev/null

# ── Verify the promoted container, roll back if it fails ─────────────────────
log "Verifying promoted container"
deadline=$(( SECONDS + HEALTH_TIMEOUT ))
promoted=0
while [ $SECONDS -lt $deadline ]; do
  if curl -fsS -m 3 "http://localhost:3000/api/health" >/dev/null 2>&1; then promoted=1; break; fi
  sleep 3
done

if [ "$promoted" -ne 1 ]; then
  warn "Promoted container is not answering — rolling back to :rollback"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$NAME" \
    --network host \
    --restart unless-stopped \
    "${ENV_ARGS[@]}" \
    ${MOUNT_ARGS[@]+"${MOUNT_ARGS[@]}"} \
    "ghcr.io/syedhashmi-bit/comexe:rollback" >/dev/null
  die "Rolled back. Investigate with: docker logs $NAME"
fi

log "Deployed successfully. Previous image kept as :rollback"
docker image prune -f >/dev/null 2>&1 || true
