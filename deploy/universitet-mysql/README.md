# ASOIU Karyera — universitet serveri üçün MySQL dəsti

İT-nin tələbi ilə platformanın backend-i Supabase-dən universitetin öz serverinə, **MySQL 8.4** bazasına keçir. Serverdə üç Docker konteyneri işləyir:

| Konteyner | Nə edir |
|---|---|
| `mysql` | MySQL 8.4: bütün data, istifadəçilər, fayl qeydləri |
| `api` | Node.js API (`server/`): giriş, data, RPC, fayllar, Edge Functions (AIDA, Career AI, admin assistent, admin-users, moderasiya), planlı işlər |
| `caddy` | HTTPS: Let's Encrypt sertifikatını avtomatik alır və yeniləyir |

API Supabase ilə eyni HTTP protokolunu verir. Ona görə əsas sayt və admin panel **Vercel-də qalır**, kodları dəyişmir. Keçid günü yalnız ünvan və açar yenilənir. Kənardan yalnız 80/443 portları açıqdır, MySQL və API daxili şəbəkədədir.

> Bu dəst köhnə `deploy/universitet-server/` dəstinin (self-hosted Supabase) yerini tutur. İT MySQL tələb etdiyi üçün o dəst artıq lazım deyil.

---

## 1. İT-dən tələblər

- [ ] **Server:** Ubuntu 22.04/24.04 (və ya Debian/RHEL), ən azı **2 CPU, 4 GB RAM, 40 GB SSD**, sudo girişi.
- [ ] **Docker Engine + Compose plugin** (`docker compose version` işləməlidir).
- [ ] **Domen:** məsələn `api.career.asoiu.edu.az`, DNS A qeydi bu serverə yönəlmiş.
- [ ] **Firewall:** internetdən yalnız **80 və 443**.
- [ ] **Çıxış internet (HTTPS):** Google Gemini API, Let's Encrypt, Docker Hub, npm. Köçürmə günü `*.supabase.co`.
- [ ] **SMTP (məcburi):** host, port, istifadəçi, şifrə, göndərən ünvan (qeydiyyat təsdiqi, şifrə bərpası, admin dəvətləri). E-poçt təsdiqi standart olaraq aktivdir (`ENABLE_EMAIL_AUTOCONFIRM=false`); SMTP olmadan `03-start.sh` dayanır.
- [ ] **AI açarı:** `GEMINI_API_KEY`, istəsəniz `GROQ_API_KEY`.
- [ ] **Backup yeri** gündəlik nüsxələr üçün, serverdən kənarda bir maşın da daxil olmaqla.

## 2. Quraşdırma

Repo serverə klonlanır, sonra repo kökündə:

```bash
git clone https://github.com/Abdulkhaligj/aziukaryera.git && cd aziukaryera
git checkout feat/mysql-backend        # keçiddən sonra: main
deploy/universitet-mysql/scripts/01-init.sh api.career.asoiu.edu.az
```

`01-init.sh` nə edir:
- MySQL şifrələrini, JWT secret-i, `ANON_KEY`/`SERVICE_ROLE_KEY` açarlarını və moderasiya secret-ini yaradır. Hamısı `kit.env` və `api.env` fayllarına yazılır (hər ikisi `chmod 600`, git-ə düşmür).
- API imicini qurur, MySQL-i işə salır, sxemi və migration-ları tətbiq edir.

Sonra `deploy/universitet-mysql/api.env` faylında `SMTP_*` və `GEMINI_API_KEY` dəyərlərini doldurun.

## 3. Datanın köçürülməsi (sınaq və keçid günü)

Supabase Dashboard → **Connect → Session pooler** bağlantı sətri və service key lazımdır. Bunlar fayla yazılmır, yalnız mühitdən oxunur:

```bash
export SOURCE_DB_URL='postgresql://…pooler.supabase.com:5432/postgres'
export SUPABASE_URL='https://ttfsbgbhyomfheglefkn.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='…'
deploy/universitet-mysql/scripts/02-import.sh
```

- Baza boş qurulur, bütün cədvəllər köçürülür, **şifrə hash-ları da** köçür (istifadəçilər eyni şifrə ilə daxil olur). Sətir sayları və bütün xarici açarlar yoxlanılır.
- Fayllar (profil şəkilləri, admin şəkilləri, səs faylları) Supabase Storage-dən diskə köçürülür. Skript təkrar işə salına bilər, artıq köçmüş fayllar atlanır.

## 4. İşə salma və yoxlama

```bash
deploy/universitet-mysql/scripts/03-start.sh     # servislər + moderasiya webhook-u bu serverə
deploy/universitet-mysql/scripts/04-verify.sh    # HTTPS üzərindən 8 yoxlama
```

## 5. Keçid günü (saytların yeni serverə yönəldilməsi)

1. Saytda yazı dayandırılır (qısa texniki fasilə elanı).
2. `02-import.sh` son dəfə işə salınır (ən təzə data), sonra `03-start.sh` və `04-verify.sh`.
3. **Əsas sayt:** repo kökündə, `api.env`-dəki `ANON_KEY` ilə:
   ```bash
   node deploy/universitet-server/scripts/07-switch-frontend.mjs --url https://api.career.asoiu.edu.az --key <ANON_KEY>
   ```
   Skript `runtime-config.js`-i və CSP-ni yeniləyir. Sonra commit və `main`-ə push. Vercel avtomatik deploy edir. Bildirişlər bu ünvanda realtime əvəzinə 30 saniyədən bir yenilənir (bu, avtomatikdir).
4. **Admin panel** (Vercel → `asoiu-career-admin` → Settings → Environment Variables, Production):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://api.career.asoiu.edu.az`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `ANON_KEY`

   Sonra yenidən deploy edin.
5. Yoxlama: giriş, qeydiyyat, profil şəkli, şəbəkə paylaşımı, vakansiya, admin panel.
6. Supabase layihəsi bir müddət (məsələn 2 həftə) **dəyişmədən saxlanılır**. Problem olarsa 3-cü və 4-cü addımlar geri qaytarılır.

## 6. Gündəlik iş

| Əməliyyat | Əmr |
|---|---|
| Vəziyyət | `docker compose -f deploy/universitet-mysql/docker-compose.yml --env-file deploy/universitet-mysql/kit.env ps` |
| Loglar | `… logs -f api` |
| Yeniləmə | `git pull && deploy/universitet-mysql/scripts/03-start.sh` (migration-lar API başlayanda yox, `01-init.sh`/`02-import.sh` ilə tətbiq olunur; yeni migration olanda: `… run --rm api node server/db/setup.mjs`) |
| Backup | `deploy/universitet-mysql/scripts/backup.sh /srv/backups/asoiu`, cron ilə gündəlik: `30 3 * * *` |
| Bərpa | `gunzip -c db-….sql.gz \| docker compose … exec -T mysql mysql -uroot -p asoiu_career` və `storage-….tar.gz` faylının `storage` volume-una açılması. Şifrələnmiş nüsxədə əvvəlcə: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/asoiu-backup.key -in db-….sql.gz.enc \| gunzip -c \| …` |

Planlı işlər (moderasiya təkrarları hər dəqiqə, paket müddətləri hər saat) API-nin içində işləyir, ayrıca cron lazım deyil.

## 7. Təhlükəsizlik

- `kit.env` və `api.env` serverdə qalır, heç vaxt git-ə və ya çata yazılmır. `SERVICE_ROLE_KEY` serverdən çıxmır: admin panel istifadəçi idarəsini `admin-users` funksiyası ilə edir.
- MySQL və API portları kənara açılmır, yalnız Caddy (80/443).
- Backup fayllarında şəxsi data və şifrə hash-ləri var: `kit.env`-də `BACKUP_KEY_FILE` (AES-256 şifrələmə) və `BACKUP_REMOTE` (serverdən kənar nüsxə) doldurun. Açar faylının nüsxəsini serverdən kənarda saxlayın.
