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
step "Təhlükəsizlik başlıqları və CORS"
headers="$(curl -s -D - -o /dev/null "$base/auth/v1/health" || true)"
if printf '%s' "$headers" | grep -qi '^strict-transport-security:'; then echo "  OK   HSTS"; else echo "  XƏTA HSTS başlığı yoxdur"; fail=1; fi
if printf '%s' "$headers" | grep -qi '^x-content-type-options: *nosniff'; then echo "  OK   nosniff"; else echo "  XƏTA nosniff başlığı yoxdur"; fail=1; fi
cors="$(curl -s -D - -o /dev/null -H 'Origin: https://evil.example' "$base/rest/v1/jobs?select=id&limit=1" -H "apikey: $anon" || true)"
if printf '%s' "$cors" | grep -qi '^access-control-allow-origin:'; then echo "  XƏTA CORS kənar sayta açıqdır"; fail=1; else echo "  OK   CORS kənar sayta bağlıdır"; fi

step "API açarlarının müddəti"
# The keys expire after two years (M-08); rotate-keys.sh replaces them.
while read -r name days; do
  [ -n "$name" ] || continue
  if [ "$days" -le 0 ]; then echo "  XƏTA $name vaxtı keçib: scripts/rotate-keys.sh"; fail=1
  elif [ "$days" -lt 60 ]; then echo "  DİQQƏT $name $days gün sonra bitir: scripts/rotate-keys.sh"
  else echo "  OK   $name ($days gün qalıb)"; fi
done <<EOF2
$(dc run --rm --no-deps -T api node -e 'for (const k of ["ANON_KEY", "SERVICE_ROLE_KEY"]) { const p = JSON.parse(Buffer.from(String(process.env[k]).split(".")[1] || "e30", "base64url")); console.log(k, p.exp ? Math.floor((p.exp * 1000 - Date.now()) / 86400000) : 99999); }')
EOF2
[ $fail -eq 0 ] && echo "Hamısı qaydasındadır." || die "Yoxlama uğursuz oldu."
