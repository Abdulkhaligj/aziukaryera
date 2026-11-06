# ASOIU Karyera API (MySQL)

Universitet İT-sinin tələbi ilə Supabase-in yerini tutan backend: **Node.js/TypeScript + MySQL 8.4**, universitet serverində. Əsas sayt və admin panel Vercel-də qalır.

Bu branch (`feat/mysql-backend`) tamamlanana qədər canlı sistem Supabase-də işləməyə davam edir.

## Strategiya

Yeni API saytın və admin panelin **artıq istifadə etdiyi Supabase HTTP protokolunun alt-dəstini** (PostgREST, GoTrue, Storage, Functions) MySQL üzərində təqdim edir. Bunun nəticəsində:

- `supabase-js` və `@supabase/ssr` kitabxanaları dəyişmir. Saytda yalnız `runtime-config.js`-dəki ünvan, admin paneldə isə Vercel env dəyəri dəyişir.
- Mövcud 78 test və saytın bütün axınları olduğu kimi qalır.
- Postgres-in RLS qaydaları (235) API-də hər cədvəl üçün **icazə qatına** köçürülür. Bütün sorğular eyni yerdən keçir, necə ki RLS keçirdi.

Yalnız realtime (WebSocket) əvəzinə bildirişlər üçün qısa interval ilə sorğu istifadə olunacaq. Bu, `backend.js`-də kiçik dəyişiklikdir.

## Mərhələlər

| # | Mərhələ | Vəziyyət |
|---|---|---|
| 1 | MySQL sxemi (55 cədvəl, 81 xarici açar, 84 CHECK), giriş və fayl cədvəlləri, data köçürmə + yoxlama | ✅ hazır, real data ilə sınanıb |
| 2 | Giriş (GoTrue alt-dəsti): şifrə ilə giriş, refresh, çıxış, qeydiyyat, şifrə bərpası, `admin_role` claim-ləri; bcrypt hash-lar köçür | ✅ hazır, 15 test (`supabase-js 2.58.0` ilə) |
| 3 | Data API (PostgREST alt-dəsti) + icazə qatı: 235 qaydanın köçürülməsi, trigger məntiqi (moderasiya, kvotalar, bildirişlər) | — |
| 4 | 15 RPC funksiyası (`career_bootstrap_v1`, `candidate_profiles`, müsahibə axını, güzəştlər, …) | — |
| 5 | Fayllar (diskdə, imzalı linklər), Edge Functions (AIDA, Career AI, admin assistent, admin-users, moderasiya), planlı işlər | — |
| 6 | Sayt və admin panelin keçidi, bildirişlər üçün sorğu, real data ilə tam sınaq, universitet serveri üçün Docker dəsti (MySQL + API + Caddy) | — |
| 7 | Universitet serverində sınaq köçürməsi, sonra keçid günü | — |

## Giriş xidməti (`/auth/v1`)

Saytın, admin panelin və Edge Function-ların çağırdığı GoTrue endpoint-ləri:

| Endpoint | Nə edir |
|---|---|
| `POST /token?grant_type=password` · `refresh_token` | Giriş; refresh token rotasiyası (10 san. təkrar istifadəyə dözümlü, daha gec təkrar → sessiya ləğv olunur) |
| `POST /signup` | `handle_new_user` məntiqi: rol, `@asoiu.edu.az` yoxlaması, profil, təhsil, şirkət + pulsuz abunə + sahib üzvlüyü |
| `POST /logout`, `GET/PUT /user` | Çıxış (global/local/others), istifadəçi məlumatı, şifrə dəyişmə |
| `POST /recover`, `/otp`, `/resend`; `GET/POST /verify` | Şifrə bərpası, şifrəsiz giriş linki, təsdiq; linklər birdəfəlikdir, yönləndirmə yalnız icazəli ünvanlara |
| `GET /settings`, `/health`, `/.well-known/jwks.json` | Saytın provayder yoxlaması və sağlamlıq |
| `/admin/users…`, `POST /invite` | `admin-users` funksiyası üçün (yalnız service key) |

Xəta mətnləri GoTrue-nunkudur (`Invalid login credentials`, `User already registered`, …), çünki saytın `Backend.translate()` funksiyası onlara görə Azərbaycan dilinə çevirir.

Yazma qatı (`src/write/`): bütün sətir yazıları buradan keçir. Postgres trigger-lərinin ekvivalentləri bu qatda işləyir. İndiyə qədər qeydiyyat zəncirininkilər köçürülüb: admin limiti, avatar qoruması, audit, təhsil yoxlaması, abunə normallaşdırması, faktura, kvota və istifadə sinxronizasiyası. Qalan trigger-lər 3-cü mərhələdə gələcək.

### Hələ bağlanmamış boşluqlar

- İstifadəçi silinəndə MySQL xarici açar kaskadları uşaq cədvəllərin yazma qaydalarını (audit, kvota sayğacları) işə salmır, Postgres-də isə trigger-lər işləyirdi. 3-cü mərhələdə silmə yazma qatından keçəcək.
- `payments_apply`-ın "ödənildi" qolu (abunəni uzatma) hələ köçürülməyib. Bu yol yalnız admin əməliyyatlarında var.
- E-poçt dəyişikliyi (`PUT /user` `email`) dəstəklənmir. Sayt bunu istifadə etmir, admin isə `admin/users` ilə dəyişir.
- Google/Microsoft girişi aktiv deyil, buludda da aktiv deyil. `/settings` yalnız e-poçtu göstərir.

## API-ni işə salma

```bash
cd server && npm install
node tools/generate-keys.mjs > .env.local        # JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY
# .env.local-a əlavə edin: MYSQL_URL, API_EXTERNAL_URL, SITE_URL, (istəyə görə) SMTP_*
node --env-file=.env.local src/index.ts           # Node 22.18+ TypeScript-i birbaşa işlədir
npm test                                          # MYSQL_TEST_URL (standart: mysql://root@127.0.0.1:3307) üzərində
```

## Qovluq quruluşu

```
server/
  db/
    source/pg-*.json        Postgres sxeminin ixracı (yalnız struktur, data yox)
    schema.sql              generator nəticəsi — əl ilə dəyişməyin
    schema-followups.md     MySQL-in ifadə edə bilmədiyi, API-nin yoxlamalı olduğu qaydalar
    migrations/*.sql        əl ilə yazılmış əlavələr (auth, storage, …)
    setup.mjs               bazanı qurur: schema.sql + yeni migration-lar
    import-from-supabase.mjs  datanı Supabase-dən köçürür, sayları və xarici açarları yoxlayır
  tools/pg-to-mysql.mjs     Postgres → MySQL sxem çeviricisi
  tools/generate-keys.mjs   JWT secret və anon/service açarları
  src/
    app.ts, index.ts        Fastify tətbiqi və giriş nöqtəsi
    config.ts, db.ts, schema.ts, context.ts, errors.ts
    auth/                   GoTrue-uyğun giriş xidməti
    write/pipeline.ts       yazma qatı; write/rules/ — trigger ekvivalentləri
  test/                     supabase-js ilə inteqrasiya testləri (müvəqqəti MySQL bazası)
```

## Lokal işə salma

```bash
cd server && npm install
MYSQL_URL=mysql://root@127.0.0.1:3307/asoiu_career ALLOW_RESET=1 node db/setup.mjs --reset
# Supabase CLI ilə daxil olmuş developer kompüterində datanı sınaq üçün köçürmək (şifrə hash-ları köçmür):
SUPABASE_PROJECT_REF=ttfsbgbhyomfheglefkn MYSQL_URL=mysql://root@127.0.0.1:3307/asoiu_career \
  node db/import-from-supabase.mjs --source supabase-cli
```

Keçid günü mənbə Postgres bağlantı sətri olur (`SOURCE_DB_URL`). Bu halda şifrə hash-ları da köçür və istifadəçilər eyni şifrə ilə daxil olur.

## Tip uyğunluğu

| Postgres | MySQL |
|---|---|
| `uuid` | `CHAR(36) ascii_bin` (Supabase ID-ləri dəyişmir) |
| `text` | `TEXT`, açar/index-də `VARCHAR(191)` |
| `timestamptz` | `DATETIME(6)`, həmişə UTC |
| `jsonb`, `text[]` | `JSON` |
| `boolean` | `TINYINT(1)` |
| enum | `ENUM(...)` |

Kollasiya `utf8mb4_0900_as_ci`-dir: böyük-kiçik hərf fərqlənmir, Azərbaycan hərfləri isə fərqlənir (`ə` ≠ `e`). Postgres-dəki `lower(name)` unikallığı da belə qorunur.
