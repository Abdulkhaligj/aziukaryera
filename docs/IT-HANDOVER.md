# ADNSU Karyera Platforması — İT şöbəsi üçün təhvil sənədi

Tarix: 12 noyabr 2026

> **Vəziyyət:**
> - **Backend:** İT-nin tələbi ilə platformanın backend-i universitetin serverində **MySQL 8.4 + Node.js API** üzərində işləyəcək.
> - **Köhnə baza:** 12.11.2026 bağlanıb. Bütün data və fayllar ehtiyat nüsxədədir, nüsxə yoxlanılıb.
> - **Saytlar:** server qurulana qədər hər iki sayt "texniki işlər" səhifəsini göstərir.
>
> Quraşdırma və köçürmə: [`deploy/universitet-mysql/README.md`](../deploy/universitet-mysql/README.md).

## 1. Platforma nədən ibarətdir

| Hissə | Ünvan | Mənbə | Texnologiya |
|---|---|---|---|
| Əsas sayt (tələbə, magistr, məzun, şirkət, Karyera Mərkəzi) | https://asoiu-career.vercel.app | `student-web/` | Statik HTML/CSS/JS (framework yoxdur) |
| Admin panel (Karyera Mərkəzi əməkdaşları) | https://asoiu-career-admin.vercel.app | repo kökü: `app/`, `components/`, `lib/` | Next.js 16 (App Router), React 19, TypeScript |
| Backend | universitet serveri (məs. `api.career.asoiu.edu.az`) | `server/`, `deploy/universitet-mysql/` | MySQL 8.4, Node.js/TypeScript API (Fastify), Docker, Caddy (HTTPS) |
| AI funksiyaları | backend-in içində | `server/functions/*` | Google Gemini, istəyə bağlı Groq |

Saytlar Vercel-dədir (`inspire5` komandası). Hər ikisi GitHub `Abdulkhaligj/aziukaryera` reposunun `main` budağına bağlıdır:
- `asoiu-career-main-v3`: Root Directory `student-web`.
- `asoiu-career-admin`: repo kökü (Next.js).

`main`-ə push hər iki saytı avtomatik yenidən yerləşdirir. API saytların istifadə etdiyi HTTP protokolunu verir, ona görə saytların kodu backend dəyişəndə dəyişmir.

## 2. Əsas funksiyalar

**Tələbə / magistr / məzun:**
- Hesab: qeydiyyat (universitet e-poçtu + e-poçt kodu), profil, **profil şəkli yükləmə**.
- İş axtarışı: uyğunluq faizi ilə vakansiyalar, müraciət (son tarixdən sonra bağlanır), müraciətlərim, müsahibə sorğuları.
- Karyera alətləri: CV Mərkəzi (qurucu, şablon, ATS analizi, AI ilə CV mətni), müsahibə simulyatoru (AI), karyera yol xəritəsi, **Mentor dəstəyi**, AIDA köməkçi.
- Digər: tədbirlər, peşəkar şəbəkə (AI moderasiya), tələbə güzəştləri.

**Profil şəkli:**
1. Şəkil brauzerdə WebP-yə çevrilir, şəxsi `avatars` bucket-inə yüklənir və AI yoxlamasına göndərilir (`content-moderation`).
2. Təsdiqlənənə qədər şəkli yalnız sahibi görür.
3. Uyğun olmayan şəkil rədd edilir və səbəbi göstərilir.
4. Başqaları yalnız təsdiqlənmiş şəkli, qısa müddətli imzalı link ilə görür.

**Mentor dəstəyi:**
- Tələbə istiqamət, mövzu, ehtiyac, görüş formatı və uyğun vaxtı yazıb müraciət göndərir, sonra müraciətin statusunu öz kabinetində izləyir.
- **AI mentor** dərhal məsləhət verir; cavabı bir kliklə insan mentora müraciətə köçürmək olur.
- Admin paneldə "Mentor müraciətləri" bölməsi var: status, mentorun adı və tələbəyə qeyd.

**Şirkət:**
- Hesab: qeydiyyat (Karyera Mərkəzinin təsdiqi ilə).
- Vakansiyalar: yaratma (təsdiq növbəsi ilə), müraciətlər.
- Namizədlər: Talent Pool, namizəd müqayisəsi, müsahibə təqvimi və sorğuları.
- Digər: işə qəbul analitikası, universitetlə əməkdaşlıq.

**Admin panel:**
- Əsas iş: icmal, təsdiq növbəsi, müraciətlər, mentor müraciətləri.
- Kataloq: vakansiyalar, şirkətlər, tədbirlər, güzəştlər, Awards, reklamlar, sayt məzmunu.
- İstifadəçilər: tələbələr, magistrlər və məzunlar; əməkdaşlar və rollar (maks. 5 aktiv admin).
- Nəzarət: şəbəkə moderasiyası, şikayətlər, audit tarixçəsi.
- Ödənişlər: abunəliklər, ödənişlər, analitika.
- Alətlər: AI köməkçi (mətn, səs və ya şəkil ilə qaralama), PWA.

Admin rolları: Super Admin, Menecer, Redaktor, Yoxlayıcı (`lib/permissions.ts`).

## 3. Quraşdırma

### 3.1 Backend (MySQL, universitet serveri)
Addım-addım təlimat: [`deploy/universitet-mysql/README.md`](../deploy/universitet-mysql/README.md).
1. **Serveri hazırlamaq:** `01-init.sh`.
2. **Ehtiyat nüsxədən köçürmə:** `02-import.sh`. Şifrə hash-ları da köçür, istifadəçilər köhnə şifrə ilə daxil olur.
3. **İşə salma və yoxlama:** `03-start.sh` və `04-verify.sh`.
4. **Saytları yeni serverə keçirmə:** `05-switch-frontend.mjs`. Bu skript texniki işlər səhifəsini də söndürür.

### 3.2 Əsas sayt (`student-web/`)
- **Backend ünvanı və ictimai açar:** `assets/js/runtime-config.js` faylındadır. Keçid günü `05-switch-frontend.mjs` bu faylı yeniləyir.
- **Vercel:** Root Directory `student-web`, framework "Other", build yoxdur. `vercel.json` təhlükəsizlik başlıqlarını və təmiz URL-ləri verir. Hazırda texniki işlər yönləndirməsi də buradadır.
- **Lokal işə salma:** `cd student-web && python3 -m http.server 8080`.
- **Nümunə hesablar:** `assets/js/auth.js` daxilindəki 3 nümunə hesab yalnız backend qoşulmayan offline demo rejimindədir. Real hesab deyillər.

### 3.3 Admin panel
- **Env dəyişənləri:** `NEXT_PUBLIC_API_URL` və `NEXT_PUBLIC_API_KEY` (`.env.example`-ə bax). Adlar köhnədir, dəyərlər MySQL API-nin ünvanı və `ANON_KEY` açarıdır. Vercel-də də eyni dəyişənlər.
- **Texniki işlər rejimi:** `next.config.mjs`-dəki `MAINTENANCE` dəyişənidir (standart: açıq; yerli yoxlama üçün build zamanı `ADMIN_MAINTENANCE=false`). Keçid skripti (`05-switch-frontend.mjs`) onu söndürür.
- **Qurma və işə salma:** `npm ci && npm run build && npm start` (Node 20+).
- **Testlər:** `node --test tests/*.test.mjs` (95 test).

### 3.4 E-poçt (SMTP)
- **SMTP məcburidir:** e-poçt təsdiqi standart olaraq aktivdir (`ENABLE_EMAIL_AUTOCONFIRM=false`).
- **Lazım olan məlumatlar:** host, port, istifadəçi, şifrə və göndərən ünvan (`career@asoiu.edu.az`). Bunlar API-nin `api.env` faylına yazılır.
- **SMTP olmadan:** `03-start.sh` dayanır.
- **Microsoft (Outlook) ilə giriş:** yeni backend-də hələ yoxdur.

## 4. Təhlükəsizlik xülasəsi
- **İcazələr:** hər sorğuda API-nin icazə qatı yoxlayır (köhnə bazadakı RLS qaydalarından köçürülüb). Tələbə yalnız öz məlumatını, şirkət yalnız öz elanlarına müraciət edənləri, admin hamısını görür.
- **Profil şəkilləri:** şəxsi bucket-də saxlanılır, AI yoxlamasından sonra imzalı link ilə göstərilir.
- **Şəbəkə paylaşımları və şərhlər:** söz siyahısı və AI moderasiya ilə yoxlanılır (fail-closed). AI-yə göstəriş vermək cəhdi olan mətn dərc olunmur.
- **Şirkətin müraciətlər üzərində icazəsi:** yalnız mərhələni, öz qeydini və etiketləri dəyişə bilir.
- **AI çağırışları:**
  - Gündəlik limitlidir.
  - AIDA qonaqlar üçün IP-nin gündəlik duzlu hash-i ilə məhdudlaşır, IP-nin özü saxlanmır.
  - Qaydalar AI-yə sistem təlimatı kimi gedir, istifadəçi mətni təsadüfi teq içində.
  - Namizəd sıralamasında ad, e-poçt, telefon və profil linkləri gizlədilir.
- **Admin API-ləri:**
  - Hər sorğuda rolu yoxlayır və əməliyyatları audit jurnalına yazır.
  - Yazma sorğularını yalnız eyni saytdan və JSON formatında qəbul edir.
  - Panel CSP, HSTS və `no-store` başlıqları ilə verilir.
- **Admin hesabları:** heç kim öz rolunu aşağı sala və ya özünü bloklaya bilməz. Sonuncu aktiv Super Admin dəyişdirilə və silinə bilməz.
- **Təsdiqlənmiş vakansiya:** məzmunu dəyişdirilərsə, yenidən təsdiq növbəsinə düşür.
- **Linklər:** yalnız `http(s)://` ola bilər.
- **Server:** MySQL və API kənara açılmır, yalnız Caddy (80/443). Backup-lar həmişə AES-256 ilə şifrələnir və serverdən kənara köçürülür. API-nin MySQL hesabı sxemi dəyişə bilmir.
- **13.11.2026 auditi (86 bənd) üzrə əsas əlavələr:**
  - Sessiyalar: çıxış, ban, hesabın silinməsi və şifrə dəyişikliyi köhnə tokenləri dərhal etibarsız edir. Bərpa linki ilə açılan sessiya yalnız yeni şifrə qura bilir.
  - Şifrə dəyişmək üçün cari şifrə serverdə yoxlanılır; Karyera Mərkəzinin verdiyi müvəqqəti şifrə ilk girişdə dəyişdirilməlidir.
  - E-poçt linkləri düymə ilə təsdiqlənir (poçt skanerləri linki yandırmır).
  - API brauzerdən yalnız platformanın öz saytlarına açıqdır (CORS); MySQL xəta mətnləri klientə getmir; loglarda token və açar yoxdur.
  - Dayandırılmış şirkət vakansiyalarını dəyişə bilmir və vakansiyaları görünmür; ödənişləri işçilərdən yalnız Super Admin və Menecer görür; qonaq şirkətin əlaqə məlumatlarını görmür.
  - Yüklənən faylın məzmunu elan olunan növə uyğun olmalıdır; fayllar `nosniff` və `sandbox` ilə verilir; şəkillər yalnız platformanın öz storage-ındandır.
  - AI: CV mətni yalnız tələbənin razılığı ilə göndərilir; namizəd sıralamasında hər namizəd ayrıca blokdadır.
  - Admin panel: HttpOnly cookie, nonce ilə CSP, URL-dən yalnız tanınan mesaj kodları.

## 5. Testlər (13.11.2026)
- **Saytlar və admin panel:** 95/95 test keçir, TypeScript yoxlaması və `next build` uğurludur.
- **MySQL API:** 106/106 inteqrasiya testi keçir (lokal və GitHub CI-da MySQL 8.4 ilə).
- **CI:** `npm audit` (yüksək və kritik zəifliklər build-i dayandırır).
- **Ehtiyat nüsxə:** lokal bazaya bərpa edildi, 92 cədvəlin sətir sayları eynidir. MySQL-ə sınaq köçürməsi uğurlu oldu: 58 cədvəl, 963 sətir, 10 istifadəçi şifrə hash-i ilə. 15 faylın hamısı yerindədir.

## 6. Əlaqə və məsul şəxslər
- **Platforma sahibi:** ADNSU Karyera Mərkəzi (career@asoiu.edu.az).
- **Hesablar:** Vercel `inspire5` və GitHub `Abdulkhaligj/aziukaryera`. Girişləri sahibi ayrıca təhvil verir.
- **Ehtiyat nüsxə** (`db-final-backup-20261112`): layihə rəhbərindədir. Serverə köçürmə üçün ondan alınır.
