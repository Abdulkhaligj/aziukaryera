# ADNSU Karyera Platforması — İT şöbəsi üçün təhvil sənədi

Tarix: 28 oktyabr 2026

## 1. Platforma nədən ibarətdir

| Hissə | Canlı ünvan | Mənbə (bu paketdə) | Texnologiya |
|---|---|---|---|
| Əsas sayt (tələbə, magistr, məzun, şirkət, Karyera Mərkəzi) | https://asoiu-career.vercel.app | `student-web/` | Statik HTML/CSS/JS (framework yoxdur), Supabase JS SDK |
| Admin panel (Karyera Mərkəzi əməkdaşları) | https://asoiu-career-admin.vercel.app | repo kökü: `app/`, `components/`, `lib/` | Next.js 16 (App Router), React 19, TypeScript |
| Backend | Supabase layihəsi `ttfsbgbhyomfheglefkn` (EU Central) | `supabase/migrations`, `supabase/functions` | PostgreSQL + RLS, Supabase Auth, Storage, Edge Functions (Deno), pg_cron, pg_net |
| AI | Google Gemini (açar yalnız Edge Function secret-dədir) | `supabase/functions/*` | gemini-3.8-flash → 3.6-flash → 3.5-flash-lite (avtomatik ehtiyat) |

Hosting: Vercel (`inspire5` komandası). Hər iki Vercel layihəsi GitHub `Abdulkhaligj/aziukaryera` reposunun `main` budağına bağlıdır:
- `asoiu-career-main-v3` → Root Directory `student-web`
- `asoiu-career-admin` → repo kökü (Next.js)

`main`-ə push hər iki saytı avtomatik yenidən yerləşdirir.

## 2. Paketdəki ZIP faylları

1. `1-esas-sayt-student-web.zip` — əsas saytın tam mənbəyi (Vercel-ə olduğu kimi yüklənir).
2. `2-admin-panel.zip` — Next.js admin paneli (`npm ci && npm run build`).
3. `3-supabase-backend.zip` — verilənlər bazası miqrasiyaları (tarix sırası ilə), Edge Functions, bu sənəd.
4. `4-tam-repo.zip` — hamısı bir yerdə (GitHub reposunun surəti, `.git` olmadan).

Heç bir ZIP-də gizli açar yoxdur: `.env.local`, service role açarı, Gemini açarı daxil edilməyib. Brauzerdə olan `SUPABASE_PUBLISHABLE_KEY` ictimai açardır, RLS ilə qorunur.

## 3. Əsas funksiyalar

**Tələbə / magistr / məzun:** qeydiyyat (universitet e-poçtu + e-poçt kodu), uyğunluq faizi ilə vakansiyalar, müraciət (son tarixdən sonra bağlanır), müraciətlərim, müsahibə sorğuları, tədbirlər, peşəkar şəbəkə (AI moderasiya), tələbə güzəştləri, profil, **profil şəkli yükləmə**, CV Mərkəzi (qurucu, şablon, ATS analizi, AI ilə CV mətni), müsahibə simulyatoru (AI), karyera yol xəritəsi, **Mentor dəstəyi**, AIDA köməkçi.

**Profil şəkli:** Profil səhifəsində "Şəkil seç və yüklə". Şəkil brauzerdə WebP-yə çevrilir, şəxsi `avatars` bucket-inə yüklənir, `avatar_submit` RPC ilə AI yoxlamasına (`content-moderation` funksiyası) göndərilir. Təsdiqlənənə qədər yalnız sahibi görür ("Yoxlanılır"); uyğun olmayan şəkil rədd edilir və səbəbi göstərilir. Başqaları yalnız təsdiqlənmiş şəkli qısa müddətli imzalı link ilə görür (şirkət namizəd siyahısında, admin paneldə).

**Mentor dəstəyi:** Tələbə menyuda "Mentor dəstəyi" → istiqamət seçir (7 istiqamət), mövzu, ətraflı ehtiyac, görüş formatı və uyğun vaxt yazıb müraciət göndərir (`mentor_requests` cədvəli). Müraciətlərin statusunu, təyin olunan mentoru və Karyera Mərkəzinin qeydini öz kabinetində izləyir. Eyni səhifədə **AI mentor** dərhal məsləhət verir (AIDA backend-i, tələbənin fakültə/ixtisas/bacarıqlarına əsaslanır) və cavabı bir kliklə insan mentora müraciətə köçürmək olur. Ana səhifədə və tələbə kabinetində "Mentora müraciət et" düyməsi; e-poçt (career@asoiu.edu.az) ehtiyat yol kimi qalır.
Admin paneldə **"Mentor müraciətləri"** bölməsi: siyahı (tələbənin şəkli ilə), status (Yeni / Baxılır / Mentor təyin edilib / Tamamlanıb / Bağlanıb), mentorun adı, tələbəyə qeyd. "Mentor təyin edilib" statusu üçün mentorun adı məcburidir. Yeni müraciətlər idarə panelində sayılır.

**Şirkət:** qeydiyyat (Karyera Mərkəzinin təsdiqi ilə), vakansiya yaratma (təsdiq növbəsi), müraciətlər, Talent Pool, namizəd müqayisəsi, müsahibə təqvimi və sorğuları, işə qəbul analitikası, universitetlə əməkdaşlıq.

**Admin panel:** icmal, təsdiq növbəsi (qeydlərlə), vakansiyalar, şirkətlər, tədbirlər, güzəştlər, Awards, reklamlar, sayt məzmunu, müraciətlər, tələbələr/magistrlər/məzunlar, mentor müraciətləri, şəbəkə moderasiyası, şikayətlər, abunəliklər, ödənişlər, analitika, əməkdaşlar və rollar (maks. 5 aktiv admin), audit tarixçəsi, AI köməkçi (mətn/səs/şəkil ilə qaralama), telefonda "Ana ekrana əlavə et" (PWA).

Admin rolları: Super Admin, Menecer, Redaktor, Yoxlayıcı (`lib/permissions.ts`). Verilənlər bazası `is_admin()` ilə admin olmağı yoxlayır (JWT `app_metadata.admin_role` + aktiv admin profili).

## 4. Quraşdırma (yeni mühitə köçürmə lazım olarsa)

### 4.1 Supabase
1. Yeni layihə yaradın (və ya mövcuddan istifadə edin).
2. Extensions: `pg_cron`, `pg_net`.
3. `supabase/migrations/` fayllarını **ad (tarix) sırası ilə** tətbiq edin: `supabase db push` və ya SQL redaktorunda bir-bir.
   - `20261019130000_network_content_moderation.sql` daxilində `content-moderation` funksiyasının URL-i layihə ünvanı ilə yazılıb — yeni layihədə ünvanı dəyişin.
4. Edge Functions (hamısı `verify_jwt = false`, çünki zəng edəni funksiyanın özü yoxlayır; `admin-users` istisnadır — `verify_jwt = true`):
   `supabase functions deploy aida-chat --no-verify-jwt` (eyni qayda ilə `career-ai`, `admin-assistant`, `content-moderation`), `supabase functions deploy admin-users`.
5. Secrets (`supabase secrets set ...`): `GEMINI_API_KEY` (məcburi). İstəyə bağlı: `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_AIDA_MODEL`, `GEMINI_ASSISTANT_MODEL`, `GEMINI_MODERATION_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `PUBLIC_SITE_URL`. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` avtomatik verilir.
6. Storage bucket-lər miqrasiyalarla yaranır: `avatars` (şəxsi), `public-media` (ictimai, admin yazır), `assistant-audio` (şəxsi).

### 4.2 Əsas sayt (`student-web/`)
- `assets/js/config.js` → `SUPABASE_URL` və `SUPABASE_PUBLISHABLE_KEY` (ictimai açar).
- Vercel: Root Directory `student-web`, framework "Other", build yoxdur. `vercel.json` təhlükəsizlik başlıqlarını və təmiz URL-ləri verir.
- Lokal: `cd student-web && python3 -m http.server 8080`.
- Diqqət: `assets/js/auth.js` daxilindəki 3 nümunə hesab (`aylin.mammadova@…`, `careers@socar.az`, `career@asoiu.edu.az`) **yalnız Supabase olmayan offline demo rejimindədir**, real hesab deyil.

### 4.3 Admin panel
- `.env.example` → `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`.
- `npm ci && npm run build && npm start` (Node 20+). Vercel-də eyni env dəyişənləri.
- Testlər: `node --test tests/` (19 test).

### 4.4 Supabase Auth parametrləri (İT-nin etməli olduğu)
- **SMTP + e-poçt təsdiqi:** Hazırda `mailer_autoconfirm = true`-dur, yəni istənilən şəxs başqasının @asoiu.edu.az ünvanı ilə qeydiyyat edə bilər. Düzəliş: Authentication → SMTP Settings (universitet poçt serveri və ya SendGrid/SES), e-poçt şablonlarına `{{ .Token }}` əlavə edin, "Confirm email"-i aktiv edin. Sayt artıq təsdiq kodu axınını dəstəkləyir.
- **Microsoft (Outlook) ilə giriş:** Kod hazırdır; provayder aktiv deyil. Entra ID-də tətbiq qeydiyyatı (single-tenant, ADNSU tenant `44774b4d-c635-4fa6-8746-23738dd53e9c`), redirect `https://ttfsbgbhyomfheglefkn.supabase.co/auth/v1/callback`, optional claims `xms_edov` + `email`; Supabase → Auth → Providers → Azure: Client ID, Secret, Tenant URL `https://login.microsoftonline.com/44774b4d-c635-4fa6-8746-23738dd53e9c`. Aktiv edildikdən sonra giriş səhifəsində düymə avtomatik görünür.
- Site URL: `https://asoiu-career.vercel.app`, Redirect URLs-də eyni ünvan.

## 5. Təhlükəsizlik xülasəsi
- Bütün cədvəllərdə RLS; tələbə yalnız öz məlumatını, şirkət yalnız öz elanlarına müraciət edənləri (Pro funksiyası ilə Talent Pool), admin hamısını görür.
- Profil şəkilləri şəxsi bucket-də, AI yoxlamasından sonra imzalı link ilə.
- Şəbəkə paylaşımları və şərhlər: söz siyahısı + AI moderasiya (fail-closed).
- Şirkət müraciətdə yalnız mərhələni, öz qeydini və etiketləri dəyişə bilər (trigger ilə qorunur).
- AI çağırışları gündəlik limitlidir (`ai_usage`); AIDA qonaqlar üçün IP-nin gündəlik duzlu hash-i ilə məhdudlaşır, IP saxlanmır.
- Admin API-ləri hər sorğuda rolu yoxlayır, əməliyyatlar audit jurnalına yazılır.
- Məlum məhdudiyyət: Pro paketli şirkət API vasitəsilə Talent Pool-dakı tələbələrin e-poçt/telefonunu oxuya bilər (ekranda gizlədilir). Tam həll üçün sütun səviyyəli RPC tövsiyə olunur.

## 6. Test nəticələri (28.10.2026)
- Avtomatlaşdırılmış: `node --test tests/` → 19/19 keçdi; admin `tsc` və `next build` uğurlu.
- Brauzer testi (demo rejimi, nümunə məlumatla): tələbə 12, şirkət 13, admin 11 görünüş — JS xətası yoxdur; Mentor dəstəyi səhifəsi, AI mentor, profil şəkli kartı, admin "Mentor müraciətləri" bölməsi, status/mentor/qeyd forması.
- Canlı yoxlama: hər iki saytda HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy; `.env`, `.vercel`, `package.json` 404; admin API-ləri sessiyasız 401; Edge Functions icazəsiz zəngləri rədd edir; AIDA canlı cavab verir.
- Real hesabla (tələbə/şirkət/admin) giriş edərək son yoxlama İT tərəfindən aparılmalıdır — test hesabları canlı bazada yaradılmayıb.

## 7. Əlaqə və məsul şəxslər
- Platforma sahibi: ADNSU Karyera Mərkəzi (career@asoiu.edu.az)
- Hosting/backend hesabları: Vercel `inspire5`, Supabase layihəsi `ttfsbgbhyomfheglefkn`, GitHub `Abdulkhaligj/aziukaryera` — girişləri sahibi ayrıca təhvil verir.
