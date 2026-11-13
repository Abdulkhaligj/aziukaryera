# ASOIU Karyera — universitet serveri üçün MySQL dəsti

İT-nin tələbi ilə platformanın backend-i universitetin öz serverində, **MySQL 8.4** bazasında işləyir. Serverdə üç Docker konteyneri işləyir:

| Konteyner | Nə edir |
|---|---|
| `mysql` | MySQL 8.4: bütün data, istifadəçilər, fayl qeydləri |
| `api` | Node.js API (`server/`): giriş, data, RPC, fayllar, Edge Functions (AIDA, Career AI, admin assistent, admin-users, moderasiya), planlı işlər |
| `caddy` | HTTPS: Let's Encrypt sertifikatını avtomatik alır və yeniləyir |

API saytların artıq istifadə etdiyi HTTP protokolunu verir. Ona görə əsas sayt və admin panel **Vercel-də qalır**, kodları dəyişmir. Keçid günü yalnız ünvan və açar yenilənir. Kənardan yalnız 80/443 portları açıqdır, MySQL və API daxili şəbəkədədir.

> **Köhnə baza 12.11.2026 bağlanıb.** Bütün data (istifadəçilər şifrə hash-ləri ilə, elanlar, müraciətlər) və fayllar həmin gün ehtiyat nüsxəyə alınıb və nüsxə yoxlanılıb: 92 cədvəlin sətir sayları eynidir, MySQL-ə sınaq köçürməsi uğurludur. Köçürmə bu nüsxədən edilir. Server hazır olana qədər hər iki sayt "texniki işlər" səhifəsini göstərir.

---

## 1. İT-dən tələblər

- [ ] **Server:** Ubuntu 22.04/24.04 (və ya Debian/RHEL), ən azı **2 CPU, 4 GB RAM, 40 GB SSD**, sudo girişi.
- [ ] **Docker Engine + Compose plugin** (`docker compose version` işləməlidir).
- [ ] **Domen:** məsələn `api.career.asoiu.edu.az`, DNS A qeydi bu serverə yönəlmiş.
- [ ] **Firewall:** internetdən yalnız **80 və 443**.
- [ ] **Çıxış internet (HTTPS):** Google Gemini API, Let's Encrypt, Docker Hub, npm.
- [ ] **SMTP (məcburi):** host, port, istifadəçi, şifrə, göndərən ünvan (qeydiyyat təsdiqi, şifrə bərpası, admin dəvətləri). E-poçt təsdiqi standart olaraq aktivdir (`ENABLE_EMAIL_AUTOCONFIRM=false`); SMTP olmadan `03-start.sh` dayanır.
- [ ] **AI açarı:** `GEMINI_API_KEY`, istəsəniz `GROQ_API_KEY`.
- [ ] **Backup yeri** gündəlik nüsxələr üçün, serverdən kənarda bir maşın da daxil olmaqla.

## 2. Quraşdırma

Repo serverə klonlanır, sonra repo kökündə:

```bash
git clone https://github.com/Abdulkhaligj/aziukaryera.git && cd aziukaryera
deploy/universitet-mysql/scripts/01-init.sh api.career.asoiu.edu.az
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
deploy/universitet-mysql/scripts/04-verify.sh    # HTTPS üzərindən 8 yoxlama
```

## 5. Keçid günü (saytların yeni serverə yönəldilməsi)

Saytlar hazırda "texniki işlər" səhifəsini göstərir, yazı artıq dayanıb.

1. `02-import.sh`, sonra `03-start.sh` və `04-verify.sh` (yuxarıda).
2. **Admin panel** (Vercel → `asoiu-career-admin` → Settings → Environment Variables, Production), növbəti addımdakı push-dan **əvvəl**:
   - `NEXT_PUBLIC_API_URL` = `https://api.career.asoiu.edu.az`
   - `NEXT_PUBLIC_API_KEY` = `ANON_KEY`

   Dəyişənlərin adları köhnədir, dəyərlər yeni MySQL API-nin ünvanı və açarıdır.
3. **Saytlar:** repo kökündə, `api.env`-dəki `ANON_KEY` ilə:
   ```bash
   node deploy/universitet-mysql/scripts/05-switch-frontend.mjs --url https://api.career.asoiu.edu.az --key <ANON_KEY>
   ```
   Skript əsas saytın `runtime-config.js`-ini və CSP-ni yeni ünvana yönəldir və hər iki saytda texniki işlər səhifəsini söndürür. Sonra testlər, commit və `main`-ə push. Vercel hər iki saytı avtomatik deploy edir. Bildirişlər realtime əvəzinə 30 saniyədən bir yenilənir (avtomatikdir).
4. Yoxlama: giriş, qeydiyyat, profil şəkli, şəbəkə paylaşımı, vakansiya, admin panel.
5. Problem olarsa 3-cü addımın commit-i geri qaytarılır (`git revert`), saytlar yenidən texniki işlər səhifəsini göstərir.

## 6. Gündəlik iş

| Əməliyyat | Əmr |
|---|---|
| Vəziyyət | `docker compose -f deploy/universitet-mysql/docker-compose.yml --env-file deploy/universitet-mysql/kit.env ps` |
| Loglar | `… logs -f api` |
| Yeniləmə | `git pull && deploy/universitet-mysql/scripts/03-start.sh` (yeni migration-ları root ilə tətbiq edir, `asoiu` hesabının hüquqlarını yeniləyir, sonra API-ni yenidən qurur; migration-lar təkrar işlədilə bilər) |
| Backup | `deploy/universitet-mysql/scripts/backup.sh /srv/backups/asoiu`, cron ilə gündəlik: `30 3 * * *` |
| Bərpa | `gunzip -c db-….sql.gz \| docker compose … exec -T mysql mysql -uroot -p asoiu_career` və `storage-….tar.gz` faylının `storage` volume-una açılması. Nüsxələr həmişə şifrələnir; əvvəlcə: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:deploy/universitet-mysql/backup.key -in db-….sql.gz.enc \| gunzip -c \| …` |

Planlı işlər API-nin içində işləyir, ayrıca cron lazım deyil: moderasiya təkrarları (hər dəqiqə), paket müddətləri və bitmiş vakansiyaların bağlanması (hər saat), köhnə sessiya, link, AI rezervasiyası və bildirişlərin silinməsi (hər gün 23:30 UTC).

## 7. Təhlükəsizlik

- `kit.env` və `api.env` serverdə qalır, heç vaxt git-ə və ya çata yazılmır. `SERVICE_ROLE_KEY` serverdən çıxmır: admin panel istifadəçi idarəsini `admin-users` funksiyası ilə edir.
- MySQL və API portları kənara açılmır, yalnız Caddy (80/443).
- Backup fayllarında şəxsi data və şifrə hash-ləri var: həmişə AES-256 ilə şifrələnir (`BACKUP_KEY_FILE` boş olsa, `backup.sh` dayanır). `BACKUP_REMOTE` ilə serverdən kənar nüsxəni də doldurun. Açar faylının nüsxəsini serverdən kənarda saxlayın.
- API-nin MySQL hesabı yalnız sətirləri oxuyub-yazır və funksiyaları çağırır; sxem dəyişiklikləri root ilə edilir.
- Caddy HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options` başlıqlarını əlavə edir və 60 MB-dan böyük sorğuları qəbul etmir.
- Docker imicləri digest ilə sabitlənib; hər servisin yaddaş, CPU və proses limiti var. Paketlər quraşdırma skriptləri işlədilmədən (`--ignore-scripts`) qurulur.
