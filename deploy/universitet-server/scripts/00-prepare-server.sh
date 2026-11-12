#!/usr/bin/env bash
# Adds the ASOIU Career settings to a self-hosted Supabase project created by
# the official setup.sh: HTTPS proxy, auth behaviour, function secrets.
source "$(dirname "$0")/lib.sh"
load_kit_env
require PUBLIC_DOMAIN CERTBOT_EMAIL SITE_URL ADMIN_URL

step "Təhlükəsiz açarların yaradıldığı yoxlanılır"
for k in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY DASHBOARD_PASSWORD; do
  v="$(env_get "$k")"
  [ -n "$v" ] || die ".env: $k boşdur. Rəsmi setup.sh və ya utils/generate-keys.sh --update-env işlədin."
  case "$v" in
    your-super-secret*|this_password_is_insecure*) die ".env: $k hələ nümunə dəyərdədir. utils/generate-keys.sh --update-env işlədin." ;;
  esac
done

step "docker-compose.career.yml köçürülür"
cp "$KIT_DIR/docker-compose.career.yml" "$SUPABASE_DIR/docker-compose.career.yml"

step ".env yenilənir"
env_set COMPOSE_FILE "docker-compose.yml:docker-compose.caddy.yml:docker-compose.career.yml"
env_set PROXY_DOMAIN "$PUBLIC_DOMAIN"
env_set CERTBOT_EMAIL "$CERTBOT_EMAIL"
env_set SUPABASE_PUBLIC_URL "https://$PUBLIC_DOMAIN"
env_set API_EXTERNAL_URL "https://$PUBLIC_DOMAIN"
env_set SITE_URL "$SITE_URL"
env_set ADDITIONAL_REDIRECT_URLS "$SITE_URL/**,$ADMIN_URL/**"
env_set ENABLE_EMAIL_SIGNUP true
autoconfirm="${ENABLE_EMAIL_AUTOCONFIRM:-false}"
case "$autoconfirm" in
  false) [ -n "${SMTP_HOST:-}" ] || die "kit.env: E-poçt təsdiqi aktivdir (ENABLE_EMAIL_AUTOCONFIRM=false), amma SMTP_HOST boşdur. SMTP məlumatlarını doldurun." ;;
  true) echo "XƏBƏRDARLIQ: ENABLE_EMAIL_AUTOCONFIRM=true — e-poçt təsdiqsiz qeydiyyat. Yalnız sınaq üçün; SMTP hazır olan kimi false edin." ;;
  *) die "kit.env: ENABLE_EMAIL_AUTOCONFIRM true və ya false olmalıdır." ;;
esac
env_set ENABLE_EMAIL_AUTOCONFIRM "$autoconfirm"
env_set ENABLE_PHONE_SIGNUP false
env_set ENABLE_ANONYMOUS_USERS false
# admin-users verifies the caller's JWT itself; the other functions are public,
# exactly as in the cloud project. VERIFY_JWT is global in self-hosting.
env_set FUNCTIONS_VERIFY_JWT false
env_set PUBLIC_SITE_URL "$SITE_URL/"
for k in SMTP_ADMIN_EMAIL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER_NAME GEMINI_API_KEY GROQ_API_KEY; do
  if [ -n "${!k:-}" ]; then env_set "$k" "${!k}"; fi
done
if [ "$(env_get MODERATION_WEBHOOK_SECRET | wc -c)" -lt 33 ]; then
  env_set MODERATION_WEBHOOK_SECRET "$(openssl rand -hex 32)"
  echo "MODERATION_WEBHOOK_SECRET yaradıldı (yalnız .env-də saxlanılır)."
fi
[ -n "$(env_get GEMINI_API_KEY)" ] || echo "XƏBƏRDARLIQ: GEMINI_API_KEY boşdur — AIDA, Career AI və moderasiya işləməyəcək."
[ -n "$(env_get SMTP_HOST)" ] || echo "XƏBƏRDARLIQ: SMTP_HOST boşdur — şifrə bərpası və dəvət e-poçtları getməyəcək."

step "Hazırdır. Növbəti addım: DNS $PUBLIC_DOMAIN → bu server, sonra scripts/01-export-cloud.sh"
