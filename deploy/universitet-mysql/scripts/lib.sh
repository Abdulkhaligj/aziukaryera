#!/usr/bin/env bash
# Shared helpers. Secrets stay in kit.env / api.env and are never printed.
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$KIT_DIR/../.." && pwd)"
die() { echo "XƏTA: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }
dc() { docker compose -f "$KIT_DIR/docker-compose.yml" --env-file "$KIT_DIR/kit.env" "$@"; }
load_env() {
  [ -f "$KIT_DIR/kit.env" ] || die "kit.env yoxdur. Əvvəlcə scripts/01-init.sh işlədin."
  [ -f "$KIT_DIR/api.env" ] || die "api.env yoxdur. Əvvəlcə scripts/01-init.sh işlədin."
  set -a; . "$KIT_DIR/kit.env"; set +a
}
api_env_get() { awk -v k="$1" 'index($0, k"=")==1 { v=substr($0, length(k)+2) } END { print v }' "$KIT_DIR/api.env"; }
# KEY=VALUE in a file; the value travels through the environment, not argv.
env_set() {
  local file="$1" tmp; tmp="$(mktemp)"
  KEY="$2" VAL="$3" awk 'BEGIN { k=ENVIRON["KEY"]; v=ENVIRON["VAL"]; done=0 }
    { if (index($0, k"=")==1) { print k"="v; done=1 } else print } END { if (!done) print k"="v }' "$file" > "$tmp"
  cat "$tmp" > "$file"; rm -f "$tmp"
}
random() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }
# Passwords reach the client through the environment (-e NAME without a
# value), never as a command-line argument that "ps" would show (#83).
mysql_app() { ( export MYSQL_PWD="$MYSQL_PASSWORD"; dc exec -T -e MYSQL_PWD mysql mysql -uasoiu asoiu_career "$@" ); }
mysql_root() { ( export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; dc exec -T -e MYSQL_PWD mysql mysql -uroot "$@" ); }
# The API's own account reads and writes rows and calls the functions; the
# schema and the migrations are applied as root (audit 2026-11-13, #55).
app_grants() {
  printf "REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'asoiu'@'%%';\nGRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON asoiu_career.* TO 'asoiu'@'%%';\nFLUSH PRIVILEGES;\n" | mysql_root
}
# Schema and migrations (db/setup.mjs) as root, then the limited grants.
migrate() {
  ROOT="$MYSQL_ROOT_PASSWORD" dc run --rm -T -e ROOT api \
    sh -c 'MYSQL_URL="mysql://root:$ROOT@mysql:3306/asoiu_career" node server/db/setup.mjs'
  app_grants
}
