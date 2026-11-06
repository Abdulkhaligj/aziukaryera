#!/usr/bin/env bash
# Checks the public endpoints through HTTPS, as the sites will use them.
. "$(dirname "$0")/lib.sh"
load_env
base="https://$API_DOMAIN"
anon="$(api_env_get ANON_KEY)"
fail=0
check() { # name expected-status curl-args…
  local name="$1" want="$2"; shift 2
  local got; got="$(curl -s -o /dev/null -w '%{http_code}' "$@" || true)"
  if [ "$got" = "$want" ]; then echo "  OK   $name ($got)"; else echo "  XƏTA $name: $got, gözlənilən $want"; fail=1; fi
}
step "Yoxlama: $base"
check "Giriş xidməti" 200 "$base/auth/v1/health"
check "Açarsız sorğu rədd olunur" 401 "$base/rest/v1/jobs?select=id"
check "Açıq vakansiyalar (anon)" 200 "$base/rest/v1/jobs?select=id&limit=1" -H "apikey: $anon"
check "Qorunan RPC anonimə bağlı" 401 -X POST "$base/rest/v1/rpc/career_bootstrap_v1" -H "apikey: $anon" -H 'Content-Type: application/json' -d '{}'
check "Reklamlar RPC (anon)" 200 -X POST "$base/rest/v1/rpc/active_ads" -H "apikey: $anon" -H 'Content-Type: application/json' -d '{"p_placement":null}'
check "Storage: gizli bucket açıq deyil" 404 "$base/storage/v1/object/public/avatars/x.webp"
check "Moderasiya funksiyası secret istəyir" 401 -X POST "$base/functions/v1/content-moderation" -H 'Content-Type: application/json' -d '{}'
check "admin-users JWT istəyir" 401 -X POST "$base/functions/v1/admin-users" -H 'Content-Type: application/json' -d '{}'
[ $fail -eq 0 ] && echo "Hamısı qaydasındadır." || die "Yoxlama uğursuz oldu."
