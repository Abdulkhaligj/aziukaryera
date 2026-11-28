# ASOIU Karyera — universitet serveri üçün MySQL dəsti

İT-nin tələbi ilə platformanın backend-i universitetin öz serverində, **MySQL 8.4** bazasında işləyir. Serverdə üç Docker konteyneri işləyir:

| Konteyner | Nə edir |
|---|---|
| `mysql` | MySQL 8.4: bütün data, istifadəçilər, fayl qeydləri |
| `api` | Node.js API (`server/`): giriş, data, RPC, fayllar, Edge Functions (AIDA, Career AI, admin assistent, admin-users, moderasiya), planlı işlər |
| `caddy` | Tələbə saytı (`student-web`) və API eyni ünvanda: API yolları (`/auth/v1`, `/rest/v1`, `/storage/v1`, `/functions/v1`) API-yə, qalanı saytın fayllarına. HTTPS-i ya universitetin firewall-u verir, ya da Caddy özü Let's Encrypt-dən alır |

API saytların artıq istifadə etdiyi HTTP protokolunu verir, saytların kodu dəyişmir. **Tələbə saytı da bu serverdən** `https://career.asoiu.edu.az` ünvanında açılır (sayt və API eyni ünvandadır). **Admin panel Vercel-də işləyir, amma bu ünvandan açılır**: Caddy `https://career.asoiu.edu.az/admin` (həmçinin `/login`, `/account`, `/api/admin`, `/_next`) sorğularını Vercel-ə ötürür, brauzer Vercel ünvanına keçmir (`kit.env`: `ADMIN_URL`), keçid günü yalnız API ünvanı və açarı yenilənir; köhnə `asoiu-career.vercel.app` ünvanı yeni ünvana yönləndirilir. Kənardan yalnız 80/443 portları açıqdır, MySQL və API daxili şəbəkədədir.

> **Köhnə baza 12.11.2026 bağlanıb.** Bütün data (istifadəçilər şifrə hash-ləri ilə, elanlar, müraciətlər) və fayllar həmin gün ehtiyat nüsxəyə alınıb və nüsxə yoxlanılıb: 92 cədvəlin sətir sayları eynidir, MySQL-ə sınaq köçürməsi uğurludur. Köçürmə bu nüsxədən edilir. Server hazır olana qədər hər iki sayt "texniki işlər" səhifəsini göstərir.

---

## 1. İT-dən tələblər

- [ ] **Server:** Ubuntu 22.04/24.04 (və ya Debian/RHEL), ən azı **2 CPU, 4 GB RAM, 40 GB SSD**, sudo girişi.
- [ ] **Docker Engine + Compose plugin** (`docker compose version` işləməlidir).
- [ ] **Domen:** `career.asoiu.edu.az`. İki yol var:
  - **Universitetin web firewall-u (WAF) arxasında** (indiki vəziyyət: domen WAF-a, 82.194.6.243, yönəlib). WAF HTTPS sertifikatını özü saxlayır və sorğuları serverə **HTTP, port 80** ilə ötürür. Host başlığı saxlanmalı, `X-Forwarded-For` göndərilməli, GET/POST/PUT/PATCH/DELETE/OPTIONS və 60 MB-a qədər sorğulara icazə verilməlidir. API sorğularında `select=`, `eq.`, `order=` kimi parametrlər var: `/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1` yolları üçün imza (SQLi) qaydaları istisna edilməli və ya yalnız log rejimində olmalıdır. `kit.env`: `CADDY_SITE_ADDRESS=:80`, `TRUSTED_PROXIES=<WAF-ın serverə qoşulduğu daxili IP>`.
  - **Birbaşa internetdə:** DNS A qeydi bu serverə, `CADDY_SITE_ADDRESS` boş: Caddy Let's Encrypt sertifikatını özü alır və yeniləyir.
- [ ] **Firewall:** internetdən yalnız **80 və 443** (WAF arxasında: yalnız WAF-dan 80).
- [ ] **Çıxış internet (HTTPS):** Google Gemini API, Let's Encrypt, Docker Hub, npm.
- [ ] **SMTP (məcburi):** host, port, istifadəçi, şifrə, göndərən ünvan (qeydiyyat təsdiqi, şifrə bərpası, admin dəvətləri). E-poçt təsdiqi standart olaraq aktivdir (`ENABLE_EMAIL_AUTOCONFIRM=false`). API production rejimində `SMTP_HOST`, `DATA_ENCRYPTION_KEY` və ən azı 32 simvolluq `MODERATION_WEBHOOK_SECRET` olmadan başlamır; `03-start.sh` bunları əvvəlcədən yoxlayır və dayanır.
- [ ] **AI açarı:** `GEMINI_API_KEY`, istəsəniz `GROQ_API_KEY`.
- [ ] **Backup yeri** gündəlik nüsxələr üçün, serverdən kənarda bir maşın da daxil olmaqla.

## 2. Quraşdırma

Repo serverə klonlanır, sonra repo kökündə:

```bash
git clone https://github.com/Abdulkhaligj/aziukaryera.git && cd aziukaryera
deploy/universitet-mysql/scripts/01-init.sh career.asoiu.edu.az
```

`01-init.sh` nə edir:
- MySQL şifrələrini, JWT secret-i, `ANON_KEY`/`SERVICE_ROLE_KEY` açarlarını, moderasiya secret-ini və `DATA_ENCRYPTION_KEY` açarını yaradır. Hamısı `kit.env` və `api.env` fayllarına yazılır (hər ikisi `chmod 600`, git-ə düşmür).
- Backup açarını (`deploy/universitet-mysql/backup.key`, `chmod 600`) yaradır. Backup-lar həmişə bu açarla şifrələnir; açarın nüsxəsini serverdən kənarda saxlayın.
- API imicini qurur, MySQL-i işə salır, sxemi və migration-ları **root** ilə tətbiq edir. API-nin öz hesabı (`asoiu`) yalnız `SELECT, INSERT, UPDATE, DELETE, EXECUTE` hüququ alır: cədvəl yarada, silə və ya dəyişə bilmir.

Sonra `deploy/universitet-mysql/api.env` faylında `SMTP_*` və `GEMINI_API_KEY` dəyərlərini doldurun.

`api.env`-də əlavə parametrlər (13.11.2026 auditindən):

| Dəyişən | Mənası |
|---|---|
| `DATA_ENCRYPTION_KEY` | Bazada şifrələnən sahələrin (güzəşt kodları) açarı. `01-init.sh` yaradır. Backup açarı ilə birlikdə serverdən kənarda saxlayın: açar itsə, həmin kodlar oxunmur. |
| `CORS_ORIGINS` | `SITE_URL` və `ADDITIONAL_REDIRECT_URLS`-dən başqa, API-yə brauzerdən müraciət edə bilən saytlar (vergüllə). Adətən boş qalır. |
| `MODERATION_WEBHOOK_SECRET` | Yalnız `api.env`-də saxlanılır, bazaya yazılmır. |
| `STORAGE_SIGNING_KEY` | İstəyə bağlı: imzalı fayl linkləri üçün ayrıca açar. Boşdursa, JWT secret-dən törədilir. |
| `MYSQL_POOL_SIZE`, `MYSQL_QUEUE_LIMIT`, `MYSQL_LOCK_WAIT_SECONDS`, `MYSQL_MAX_EXECUTION_MS` | İstəyə bağlı: bağlantı hovuzu (20), növbə (200), kilid gözləmə (10 s) və oxuma sorğusunun maksimum müddəti (15 000 ms). |
| `API_REQUESTS_PER_MINUTE_USER`, `API_REQUESTS_PER_MINUTE_ADDRESS` | İstəyə bağlı (16.11.2026 auditi): `/rest` və `/storage` üçün dəqiqəlik limit — daxil olmuş hər hesaba 600, hesabsız sorğularda hər ünvana 6000 (kampusda çox tələbə eyni IP ilə çıxır; açılış səhifəsi ~8 sorğu edir). Server açarı limitsizdir. |

Bu parametrlərdə tam ədəd olmayan dəyər (məs. `abc`) API-ni dayandırır, səssizcə başqa dəyərə çevrilmir. `kit.env`-də `API_DOMAIN` yalnız domen adı ola bilər (kiçik hərflər, rəqəm, `-`, `.`).

Şifrələr Docker əmrlərinə arqument kimi yox, mühit dəyişəni ilə ötürülür; `ps` siyahısında görünmür.

## 3. Datanın köçürülməsi (ehtiyat nüsxədən)

Ehtiyat nüsxə qovluğu (`db-final-backup-20261112`: `full.dump` və `storage/`) layihə rəhbərindən alınır və serverə köçürülür (məs. `scp -r`). Qovluqda şəxsi data və şifrə hash-ləri var: yalnız root oxuya bilsin (`chmod -R go-rwx`), köçürmədən sonra serverdən silinsin, nüsxəsi təhlükəsiz yerdə saxlanılsın.

```bash
export IMPORT_BACKUP_DIR=/root/db-final-backup-20261112
deploy/universitet-mysql/scripts/02-import.sh
```

- Nüsxə müvəqqəti Postgres konteynerinə yüklənir; köçürmədən sonra konteyner özü silinir.
- MySQL bazası boş qurulur, bütün cədvəllər köçürülür, **şifrə hash-ları da** köçür (istifadəçilər eyni şifrə ilə daxil olur). Sətir sayları və bütün xarici açarlar yoxlanılır.
- Fayllar (profil şəkilləri, admin şəkilləri) nüsxədən diskə köçürülür, hər faylın ölçüsü yoxlanılır. Skript təkrar işə salına bilər.

## 4. İşə salma və yoxlama

```bash
deploy/universitet-mysql/scripts/03-start.sh     # servislər + moderasiya webhook-u bu serverə
deploy/universitet-mysql/scripts/04-verify.sh    # HTTPS üzərindən API, sayt və başlıqlar
# WAF domeni hələ ötürmürsə, serverin özündə: VERIFY_URL=http://127.0.0.1 deploy/universitet-mysql/scripts/04-verify.sh
```

## 5. Keçid günü (saytların yeni serverə yönəldilməsi)

Saytlar hazırda "texniki işlər" səhifəsini göstərir, yazı artıq dayanıb.

1. `02-import.sh`, sonra `03-start.sh` və `04-verify.sh` (yuxarıda).
2. **Admin panel** (Vercel → `asoiu-career-admin` → Settings → Environment Variables, Production), növbəti addımdakı push-dan **əvvəl**:
   - `NEXT_PUBLIC_API_URL` = `https://career.asoiu.edu.az`
   - `NEXT_PUBLIC_API_KEY` = `ANON_KEY`

   Dəyişənlərin adları köhnədir, dəyərlər yeni MySQL API-nin ünvanı və açarıdır.
3. **Saytlar:** repo kökündə, `api.env`-dəki `ANON_KEY` ilə:
   ```bash
   node deploy/universitet-mysql/scripts/05-switch-frontend.mjs --url https://career.asoiu.edu.az --key <ANON_KEY> --site https://career.asoiu.edu.az
   ```
   Skript əsas saytın `runtime-config.js`-ini və CSP-ni yeni ünvana yönəldir, admin paneldə texniki işlər səhifəsini söndürür, `--site` ilə isə Vercel-dəki köhnə tələbə saytı bütün yolları yeni ünvana yönləndirir. Serverdəki sayt öz `runtime-config.js`-ini `03-start.sh`-dən alır (git-də saxlanmır). Sonra testlər, commit və `main`-ə push. Vercel hər iki saytı avtomatik deploy edir. Bildirişlər realtime əvəzinə 30 saniyədən bir yenilənir (avtomatikdir).
4. Yoxlama: giriş, qeydiyyat, profil şəkli, şəbəkə paylaşımı, vakansiya, admin panel.
5. Problem olarsa 3-cü addımın commit-i geri qaytarılır (`git revert`), saytlar yenidən texniki işlər səhifəsini göstərir.

## 6. Gündəlik iş

| Əməliyyat | Əmr |
|---|---|
| Vəziyyət | `docker compose -f deploy/universitet-mysql/docker-compose.yml --env-file deploy/universitet-mysql/kit.env ps` |
| Loglar | `… logs -f api` |
| Yeniləmə | `git pull && deploy/universitet-mysql/scripts/03-start.sh` (yeni migration-ları root ilə tətbiq edir, `asoiu` hesabının hüquqlarını yeniləyir, sonra API-ni yenidən qurur; migration-lar təkrar işlədilə bilər) |
| Backup | `deploy/universitet-mysql/scripts/backup.sh /srv/backups/asoiu`, cron ilə gündəlik: `30 3 * * *`. `BACKUP_REMOTE` boşdursa, skript hər dəfə xəbərdarlıq edir. |
| Açarların yenilənməsi | `ANON_KEY` və `SERVICE_ROLE_KEY` 2 il yaşayır; `04-verify.sh` və API logu bitməyə 30–60 gün qalmış xəbərdarlıq edir. `deploy/universitet-mysql/scripts/rotate-keys.sh` yeni açarları yazır və API-ni yenidən başladır; API yeni açarlarla cavab verəndən sonra köhnə secret-lərin nüsxəsi (`api.env.before-rotate`) avtomatik silinir. Serverdəki saytın `runtime-config.js`-i avtomatik yenilənir; yeni `ANON_KEY` yalnız Vercel-də admin panelin `NEXT_PUBLIC_API_KEY`-inə yazılır. |
| Bərpa | `gunzip -c db-….sql.gz \| docker compose … exec -T mysql mysql -uroot -p asoiu_career` və `storage-….tar.gz` faylının `storage` volume-una açılması. Nüsxələr həmişə şifrələnir; əvvəlcə: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:deploy/universitet-mysql/backup.key -in db-….sql.gz.enc \| gunzip -c \| …` |

Planlı işlər API-nin içində işləyir, ayrıca cron lazım deyil: moderasiya təkrarları (hər dəqiqə), paket müddətləri və bitmiş vakansiyaların bağlanması (hər saat), köhnə sessiya, link, AI rezervasiyası və bildirişlərin silinməsi (hər gün 23:30 UTC).

## 7. Təhlükəsizlik

- `kit.env` və `api.env` serverdə qalır, heç vaxt git-ə və ya çata yazılmır. `SERVICE_ROLE_KEY` serverdən çıxmır: admin panel istifadəçi idarəsini `admin-users` funksiyası ilə edir.
- MySQL və API portları kənara açılmır, yalnız Caddy (80/443).
- Backup fayllarında şəxsi data və şifrə hash-ləri var: həmişə AES-256 ilə şifrələnir (`BACKUP_KEY_FILE` boş olsa, `backup.sh` dayanır). `BACKUP_REMOTE` ilə serverdən kənar nüsxəni də doldurun. Açar faylının nüsxəsini serverdən kənarda saxlayın.
- API-nin MySQL hesabı yalnız sətirləri oxuyub-yazır və funksiyaları çağırır; sxem dəyişiklikləri root ilə edilir.
- Caddy HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options` başlıqlarını əlavə edir və 60 MB-dan böyük sorğuları qəbul etmir. API-nin özü də eyni başlıqları göndərir (Caddy-siz də).
- `/rest` və `/storage` üçün hər hesaba və ünvana dəqiqəlik limit var; IPv6 ünvanları /64 bloku üzrə sayılır.
- Docker imicləri digest ilə sabitlənib; hər servisin yaddaş, CPU və proses limiti var. Paketlər quraşdırma skriptləri işlədilmədən (`--ignore-scripts`) qurulur.

## 8. Microsoft (Outlook) ilə giriş

Tələbələr və məzunlar universitetin Microsoft 365 hesabı (`@asoiu.edu.az`) ilə şifrəsiz daxil olurlar. Saytda "Outlook ilə daxil ol" düyməsi həmişə görünür; API-də aşağıdakı üç dəyər dolu olanda aktiv olur (o vaxta qədər "Tezliklə" yazılır).

**İT (Entra ID administratoru) bir dəfə tətbiq qeydiyyatı edir:**

1. [entra.microsoft.com](https://entra.microsoft.com) → **App registrations** → **New registration**.
   - Ad: `ADNSU Karyera`.
   - Supported account types: **Accounts in this organizational directory only** (yalnız universitet).
   - Redirect URI: **Web**, `https://career.asoiu.edu.az/auth/v1/callback`.
2. **Certificates & secrets** → **New client secret** (məs. 24 ay). Dəyəri dərhal kopyalayın: bir də göstərilmir.
3. **API permissions**: `openid`, `email`, `profile` (Microsoft Graph, delegated) — adətən hazırdır. İstəsəniz **Grant admin consent** verin ki, istifadəçilər razılıq ekranı görməsin.
4. **Overview**-dan **Application (client) ID** və **Directory (tenant) ID**.

**Serverdə** `api.env`:

```
AZURE_CLIENT_ID=<Application (client) ID>
AZURE_CLIENT_SECRET=<client secret>
AZURE_TENANT_ID=44774b4d-c635-4fa6-8746-23738dd53e9c
```

sonra `deploy/universitet-mysql/scripts/03-start.sh`.

**Necə işləyir:**

- Sayt API-yə gedir, API universitetin Microsoft girişinə yönləndirir. Yalnız universitetin kataloqu (tenant), yalnız `@asoiu.edu.az` ünvanları qəbul olunur; qonaq hesablar (`#EXT#`) və başqa domenlər rədd edilir.
- Microsoft-un kodunu API client secret ilə tokenə dəyişir və ID tokeni yoxlayır: tenant, tətbiq (aud), issuer, nonce, müddət.
- Bu ünvanla hesab varsa ona daxil olur (rolu dəyişmir). Yoxdursa, yeni hesab yaradılır: qeydiyyat formasında seçilən səviyyəyə görə tələbə, magistr və ya məzun, profil dərhal aktivdir. Təsdiqlənməmiş başqasının qeydiyyatı varsa, onun şifrəsi ləğv olunur.
- Sayta yalnız brauzerə bağlı birdəfəlik kod qayıdır (PKCE); ünvan sətrində token olmur.
- Client secret-in müddəti bitəndə İT yenisini yaradır, `api.env`-də `AZURE_CLIENT_SECRET` yenilənir və `03-start.sh` işlədilir.

## 9. Google (Gmail) ilə giriş

Şəxsi Gmail ünvanı ilə hesabı olanlar (məsələn, məzunlar) Google ilə şifrəsiz daxil olurlar. Saytda "Google ilə daxil ol" düyməsi həmişə görünür; API-də aşağıdakı iki dəyər dolu olanda aktiv olur.

**Google Cloud-da bir dəfə:**

1. [console.cloud.google.com](https://console.cloud.google.com) → yeni layihə (məs. `ADNSU Karyera`).
2. **APIs & Services** → **OAuth consent screen** (Google Auth Platform): User type **External**, tətbiq adı `ADNSU Karyera`, dəstək e-poçtu `careercenter@asoiu.edu.az`, authorized domain `asoiu.edu.az`. Scope-lar: `openid`, `email`, `profile`. Sonra **Publish app** (In production).
3. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**:
   - Authorized JavaScript origins: `https://career.asoiu.edu.az`
   - Authorized redirect URIs: `https://career.asoiu.edu.az/auth/v1/callback`
4. **Client ID** (`…apps.googleusercontent.com`) və **Client secret**.

**Serverdə** `api.env`:

```
GOOGLE_CLIENT_ID=<…apps.googleusercontent.com>
GOOGLE_CLIENT_SECRET=<client secret>
```

sonra `deploy/universitet-mysql/scripts/03-start.sh`.

**Necə işləyir:**

- Microsoft girişi ilə eyni axın: API Google-a yönləndirir, kodu client secret ilə tokenə dəyişir və ID tokeni yoxlayır (tətbiq/aud, issuer, nonce, müddət, `email_verified`).
- Bu ünvanla hesab varsa ona daxil olur (rolu dəyişmir). Yeni hesab yalnız qeydiyyatda "Məzun" seçiləndə yaranır və admin təsdiqinə düşür; tələbə kimi yeni Gmail hesabı yaranmır.
- `@asoiu.edu.az` ünvanları Google ilə qəbul olunmur: onlar Outlook (universitet kataloqu) ilə daxil olur.
- Sayta yalnız brauzerə bağlı birdəfəlik kod qayıdır (PKCE); ünvan sətrində token olmur.
