#!/usr/bin/env bash
# Smoke tests against the new server's public HTTPS address.
source "$(dirname "$0")/lib.sh"
load_kit_env
require PUBLIC_DOMAIN

base="https://$PUBLIC_DOMAIN"
anon="$(env_get ANON_KEY)"
failures=0
check() { # name expected-status url [curl args...]
  local name="$1" want="$2" url="$3" got; shift 3
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$@" "$url" || echo 000)"
  if [ "$got" = "$want" ]; then echo "  OK    $name ($got)"; else echo "  XƏTA  $name: $got, gözlənilən $want"; failures=$((failures + 1)); fi
}

step "HTTPS və API"
check "Auth sağlamlıq"            200 "$base/auth/v1/health" -H "apikey: $anon"
check "Vakansiyalar (anonim oxu)" 200 "$base/rest/v1/jobs?select=id&limit=1" -H "apikey: $anon"
profiles="$(curl -s --max-time 60 -H "apikey: $anon" "$base/rest/v1/profiles?select=id&limit=1" || true)"
if [ "$profiles" = "[]" ]; then echo "  OK    Profillər anonimə bağlı"; else echo "  XƏTA  Profillər anonimə görünür və ya sorğu alınmadı"; failures=$((failures + 1)); fi
check "Qorunan RPC anonimə bağlı" 401 "$base/rest/v1/rpc/career_bootstrap_v1" -X POST -H "apikey: $anon" -H 'Content-Type: application/json' -d '{}'

step "Edge Functions"
check "AIDA cavab verir (boş sual)"     400 "$base/functions/v1/aida-chat" -X POST -H "apikey: $anon" -H 'Content-Type: application/json' -d '{}'
check "Career AI girişsiz bağlı"        401 "$base/functions/v1/career-ai" -X POST -H "apikey: $anon" -H 'Content-Type: application/json' -d '{}'
check "Admin users girişsiz bağlı"      401 "$base/functions/v1/admin-users" -X POST -H "apikey: $anon" -H 'Content-Type: application/json' -d '{}'
check "Moderasiya imzasız sorğunu rədd edir" 401 "$base/functions/v1/content-moderation" -X POST -H 'Content-Type: application/json' -d '{}'

step "Bazadan imzalı moderasiya sorğusu"
request_id="$(db_psql -At -c "select private.moderation_send('posts', coalesce((select id from public.posts where moderation_status = 'visible' limit 1), gen_random_uuid()))")"
status=""
for _ in $(seq 1 20); do
  status="$(db_psql -At -c "select status_code from net._http_response where id = $request_id")"
  [ -n "$status" ] && break
  sleep 2
done
if [ "$status" = 200 ]; then echo "  OK    webhook 200"; else echo "  XƏTA  webhook: '${status:-cavab yoxdur}'"; failures=$((failures + 1)); fi

step "Sətir sayları (bulud → yeni server)"
db_psql -At -F " " < "$KIT_DIR/sql/counts.sql" > "$DUMP_DIR/counts-new.txt"
if [ -f "$DUMP_DIR/counts-cloud.txt" ]; then
  if diff "$DUMP_DIR/counts-cloud.txt" "$DUMP_DIR/counts-new.txt" >/dev/null; then echo "  OK    saylar eynidir"
  else echo "  QEYD  saylar fərqlidir (köçürmədən sonra yeni yazılar ola bilər):"; diff "$DUMP_DIR/counts-cloud.txt" "$DUMP_DIR/counts-new.txt" || true; fi
fi

echo
if [ "$failures" -eq 0 ]; then echo "Bütün yoxlamalar keçdi."; else die "$failures yoxlama uğursuz oldu."; fi
