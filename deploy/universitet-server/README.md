# ASOIU Karyera — universitet serverinə köçürmə dəsti

> **Qeyd (2026-11-06):** İT MySQL tələb etdiyi üçün universitet serverinə köçürmə indi [`deploy/universitet-mysql/`](../universitet-mysql/README.md) dəsti ilə edilir (MySQL 8.4 + Node.js API). Aşağıdakı self-hosted Supabase təlimatı yalnız arxiv üçün saxlanılır.

Bu dəst platformanın backend-ini (baza, giriş sistemi, fayllar, Edge Functions, planlı işlər) Supabase buludundan universitetin öz serverinə köçürür. Server rəsmi **self-hosted Supabase**-dir (Docker), ona görə saytların və admin panelin kodu dəyişmir. Keçid günü yalnız ünvan və açar yenilənir.

| | Bulud (indi) | Universitet serveri (sonra) |
|---|---|---|
| Baza | Supabase Cloud, Postgres 17.6 (`ttfsbgbhyomfheglefkn`) | Eyni Postgres imici (`supabase/postgres:17.6.1.166`) |
| Giriş, fayllar, realtime, funksiyalar | Supabase Cloud | Eyni servislər, Docker konteynerlərində |
| HTTPS | Supabase | Caddy, Let's Encrypt sertifikatını avtomatik alır |
| Əsas sayt və admin panel | Vercel | Vercel-də qalır (istəsəniz sonra köçürülə bilər) |

Köçən data: bütün cədvəllər, 9 istifadəçi hesabı (şifrə hash-ları ilə, istifadəçilər eyni şifrə ilə daxil olur), 3 storage bucket-dəki fayllar və 3 planlı iş.

---

## 1. İT-dən tələblər

- [ ] **Server:** Ubuntu 22.04/24.04 (və ya Debian/RHEL), ən azı **4 CPU, 8 GB RAM, 50 GB SSD**, root/sudo girişi.
- [ ] **Docker Engine + Compose plugin.** Rəsmi `setup.sh` quraşdıra bilir.
- [ ] **Domen:** məsələn `api.career.asoiu.edu.az`, DNS A qeydi bu serverə yönəlmiş.
- [ ] **Firewall:** internetdən yalnız **80 və 443** açıq. 5432, 6543, 8000 portları kənardan bağlı olmalıdır.
- [ ] **Çıxış internet (outbound HTTPS):**
  - Google Gemini API, Let's Encrypt;
  - Docker Hub, npm/jsr (funksiya asılılıqları);
  - köçürmə günü `*.supabase.co`.
- [ ] **SMTP:** host, port, istifadəçi, şifrə, göndərən ünvan. Qeydiyyat təsdiqi, şifrə bərpası və admin dəvətləri üçün lazımdır.
- [ ] **AI açarı:** `GEMINI_API_KEY`, istəsəniz `GROQ_API_KEY`.
- [ ] **Backup yeri:** gündəlik baza və fayl nüsxələri üçün (bax: §7).
- [ ] **Köçürmə günü buluddan:**
  - Supabase Dashboard → **Connect → Session pooler** bağlantı sətri (`CLOUD_DB_URL`);
  - **Project Settings → API Keys** → service_role və ya secret açar (`CLOUD_SERVICE_ROLE_KEY`).

---

## 2. Hazırlıq (bir dəfə)

### 2.1 Self-hosted Supabase

Serverdə:

```bash
sudo mkdir -p /opt/supabase && cd /opt/supabase
curl -fsSL https://raw.githubusercontent.com/supabase/supabase/master/docker/setup.sh -o setup.sh
sudo sh setup.sh --project-dir asoiu-career
```

`setup.sh` Docker-i quraşdırır, rəsmi faylları `/opt/supabase/asoiu-career`-ə köçürür və bütün gizli açarları (Postgres şifrəsi, JWT secret, `ANON_KEY`, `SERVICE_ROLE_KEY`, Studio şifrəsi) yaradıb `.env`-ə yazır. URL soruşanda `https://api.career.asoiu.edu.az` daxil edin.

### 2.2 Bu repo

```bash
sudo git clone https://github.com/Abdulkhaligj/aziukaryera.git /opt/asoiu-career
cd /opt/asoiu-career/deploy/universitet-server
cp kit.env.example kit.env && chmod 600 kit.env
nano kit.env     # SUPABASE_DIR, domen, SMTP, GEMINI_API_KEY
```

### 2.3 Supabase CLI (yalnız buluddan export üçün)

```bash
V=2.122.1
curl -fsSLO https://github.com/supabase/cli/releases/download/v$V/supabase_${V}_linux_amd64.tar.gz
curl -fsSLO https://github.com/supabase/cli/releases/download/v$V/checksums.txt
grep " supabase_${V}_linux_amd64.tar.gz" checksums.txt | sha256sum -c -
tar -xzf supabase_${V}_linux_amd64.tar.gz supabase && sudo install supabase /usr/local/bin/
```

### 2.4 Layihə ayarları

```bash
sudo scripts/00-prepare-server.sh
```

Bu skript:
- HTTPS proxy-ni (Caddy) qoşur;
- giriş ayarlarını buluddakı kimi qurur: yalnız e-poçt ilə giriş, telefon və anonim giriş söndürülmüş;
- SMTP və AI açarlarını, saytların ünvanlarını `.env`-ə yazır;
- moderasiya üçün yeni təsadüfi secret yaradır.

Nümunə açarlarla işləməkdən imtina edir, təkrar işlədilə bilər.

---

## 3. Sınaq köçürməsi (saytlar buludda qalır)

Əvvəlcə tam köçürməni bir dəfə sınaq kimi edin. Saytlar bu müddətdə buludla işləməyə davam edir, istifadəçilər heç nə hiss etmir.

```bash
cd /opt/asoiu-career/deploy/universitet-server
sudo scripts/01-export-cloud.sh      # rollar, sxem, data → dump/ ; buluddakı saylar
sudo scripts/02-import.sh            # boş bazaya tək tranzaksiyada yükləyir, sayları müqayisə edir
sudo scripts/03-copy-storage.sh      # bütün bucket fayllarını eyni yollarla köçürür
sudo scripts/04-deploy-functions.sh  # AIDA, Career AI, moderasiya, admin funksiyaları
sudo scripts/05-configure-db.sh      # moderasiya webhook-u bu serverə, planlı işlər
sudo scripts/06-verify.sh            # HTTPS, API, funksiyalar, imzalı webhook, saylar
```

Hər skript xəta olanda dayanır və səbəbi yazır. `06-verify.sh` sonda `Bütün yoxlamalar keçdi.` yazmalıdır.

**Bazanı sıfırlamaq** (sınaq təkrarlananda, yalnız yeni serverdə):

```bash
cd /opt/supabase/asoiu-career
sudo docker compose down
sudo rm -rf volumes/db/data volumes/storage
```

Sonra `02-import.sh`-dan təkrar başlayın. Rəsmi `reset.sh` də eyni işi görür. O, `.env`-i sıfırlamağı təklif edəndə **"N"** cavab verin, yoxsa açarlar itər.

---

## 4. Keçid günü

Bir-iki saatlıq fasilə planlayın: axşam saatı, istifadəçilərə əvvəlcədən bildiriş.

1. Bazanı sıfırlayın (§3) və `01` … `06` addımlarını yenidən işlədin. Belə ki, ən son data köçsün.
2. Developer kompüterində, repo kökündə saytı yeni serverə yönəldin:
   ```bash
   node deploy/universitet-server/scripts/07-switch-frontend.mjs --url https://api.career.asoiu.edu.az --key <ANON_KEY>
   node --test tests/*.test.mjs
   ```
   `ANON_KEY` serverdəki `.env`-dədir və ictimai açardır. Skript `runtime-config.js`-i və 5 fayldakı CSP-ni yeniləyir.
3. `deploy/universitet-server/sql/moderation-endpoint.sql` faylını tarixli migration kimi `supabase/migrations/`-a əlavə edin, sonra commit və push edin. Vercel əsas saytı avtomatik deploy edir.
4. Vercel → `asoiu-career-admin` → **Environment Variables (Production)**:
   - `NEXT_PUBLIC_SUPABASE_URL = https://api.career.asoiu.edu.az`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = <ANON_KEY>`

   Sonra admin layihəsini **Redeploy** edin.
5. §5-dəki əl ilə yoxlamaları edin.
6. Bulud layihəsini ən azı 2 həftə ehtiyat kimi saxlayın, sonra Supabase Dashboard-dan **Pause** edin.

Qeyd: yeni serverdə JWT açarı fərqlidir. Hər kəs **bir dəfə yenidən daxil olmalıdır**, şifrələr eynidir.

---

## 5. Əl ilə yoxlama (keçiddən sonra)

- [ ] Əsas sayt açılır, ana səhifədə vakansiya və şirkətlər görünür.
- [ ] Tələbə hesabı ilə giriş; kabinet, müraciətlər, bildirişlər yüklənir.
- [ ] Profil şəkli yüklənir, bir dəqiqə ərzində təsdiqlənir və şəbəkədə görünür.
- [ ] Şəbəkədə post paylaşılır və moderasiyadan sonra görünür.
- [ ] AIDA sualı cavablandırır.
- [ ] Şirkət hesabı: vakansiya yaratma, namizədlər, müraciətlər.
- [ ] Admin panel: giriş, bölmələr, təsdiqlər.
- [ ] Şifrə bərpası e-poçtu gəlir (SMTP).

---

## 6. Geri qayıtma

Keçiddən sonra problem olarsa:
1. `07` addımından əvvəlki commit-ə qayıdın (`git revert`) və push edin. Əsas sayt yenidən bulud ünvanına yönəlir.
2. Admin panelin Vercel env dəyərlərini köhnə bulud dəyərlərinə qaytarıb redeploy edin.

Diqqət: keçiddən sonra yeni serverə yazılmış data (yeni qeydiyyatlar, postlar) buludda olmayacaq.

---

## 7. Backup

```bash
sudo crontab -e
30 2 * * *  /opt/asoiu-career/deploy/universitet-server/scripts/backup.sh >> /var/log/asoiu-backup.log 2>&1
```

Hər gecə bazanın tam nüsxəsi (`pg_dump -Fc`, istifadəçi hesabları daxil) və storage faylları `BACKUP_DIR`-ə (standart `/var/backups/asoiu-career`) yazılır. Son 14 gün saxlanılır. Nüsxələri başqa bir maşına da kopyalayın.

Bərpa (yeni boş bazaya):

```bash
docker exec -i supabase-db pg_restore -U postgres -d postgres --clean --if-exists < db-YYYY-MM-DD-HHMM.dump
```

---

## 8. Təhlükəsizlik

- `kit.env`, `dump/` və serverdəki `.env` gizli məlumat saxlayır. Onlar Git-ə düşmür (`.gitignore`), icazələri `600`/`700` olmalıdır. Keçiddən sonra `kit.env`-dən `CLOUD_DB_URL` və `CLOUD_SERVICE_ROLE_KEY`-i silin, `dump/` qovluğunu təhlükəsiz silin.
- **Supabase Studio** (idarəetmə paneli) Caddy arxasında `DASHBOARD_USERNAME/PASSWORD` ilə qorunur. Mümkünsə yalnız universitet şəbəkəsindən açıq saxlayın.
- `SERVICE_ROLE_KEY` bütün RLS qaydalarını keçir. Onu heç vaxt sayta və ya admin panelin `NEXT_PUBLIC_*` dəyərlərinə yazmayın.
- Self-hosted-də JWT yoxlaması bütün funksiyalar üçün ümumidir (`FUNCTIONS_VERIFY_JWT=false`). Bu, buludla eynidir: `admin-users` girişi özü yoxlayır, digər funksiyalar ictimaidir və öz yoxlamalarını edir.

---

## 9. Bilməli olduğunuz məhdudiyyətlər

- Dəst yazılarkən skriptlərin hissələri ayrıca sınaqdan keçirilib:
  - `00` rəsmi `.env` və açar generatoru ilə;
  - `07` repo nüsxəsində, sonra 78/78 test keçib;
  - fayl köçürmə iki saxta Storage serveri arasında.

  Tam zəncir (`01`–`06`) real serverdə və Docker-də hələ işlədilməyib. Buna görə §3-dəki sınaq köçürməsi məcburidir.
- Buludda Supabase avtomatik yenilənir, self-hosted-də isə yeniləmələri İT edir. Rəsmi `update.sh` istifadə olunur, əvvəlcə backup alınmalıdır.
- E-poçt təsdiqi buludda söndürülüb, yeni serverdə də söndürülmüş başlayır (`ENABLE_EMAIL_AUTOCONFIRM=true`). SMTP işlədikdən sonra `false` edin, `00-prepare-server.sh`-ı yenidən işlədin və `docker compose up -d` edin.
