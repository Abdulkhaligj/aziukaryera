#!/usr/bin/env bash
# Shared helpers for the university-server migration scripts.
# Secrets are read from files or the environment and never echoed.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$KIT_DIR/../.." && pwd)"
DUMP_DIR="$KIT_DIR/dump"
PG_IMAGE="supabase/postgres:17.6.1.166"

die() { echo "XƏTA: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

load_kit_env() {
  [ -f "$KIT_DIR/kit.env" ] || die "kit.env yoxdur: kit.env.example faylını kit.env adı ilə köçürüb doldurun."
  set -a; . "$KIT_DIR/kit.env"; set +a
  [ -n "${SUPABASE_DIR:-}" ] || die "kit.env: SUPABASE_DIR boşdur."
  [ -f "$SUPABASE_DIR/.env" ] || die "$SUPABASE_DIR/.env tapılmadı. Əvvəlcə rəsmi setup.sh işlədilməlidir."
}

require() {
  local v
  for v in "$@"; do [ -n "${!v:-}" ] || die "kit.env: $v boşdur."; done
}

# Read one key from the self-hosted .env without sourcing the whole file.
env_get() {
  awk -v k="$1" 'index($0, k"=")==1 { v=substr($0, length(k)+2) } END { print v }' "$SUPABASE_DIR/.env"
}

# Set or append KEY=VALUE in the self-hosted .env. The value travels through
# the environment, so it never appears in a process list or on screen.
env_set() {
  local file="$SUPABASE_DIR/.env" tmp
  tmp="$(mktemp)"
  KEY="$1" VAL="$2" awk 'BEGIN { k=ENVIRON["KEY"]; v=ENVIRON["VAL"]; done=0 }
    { if (index($0, k"=")==1) { print k"="v; done=1 } else print }
    END { if (!done) print k"="v }' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

dc() { (cd "$SUPABASE_DIR" && docker compose "$@"); }

# psql inside the self-hosted database container, as the postgres superuser.
db_psql() { docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

wait_healthy() {
  local deadline=$((SECONDS + ${2:-300})) c status
  for c in $1; do
    until status="$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" && [ "$status" = healthy ]; do
      [ $SECONDS -lt $deadline ] || die "$c sağlam vəziyyətə keçmədi (son status: ${status:-yoxdur})."
      sleep 3
    done
  done
}
