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
| 3 | Data API (PostgREST alt-dəsti) + icazə qatı: 235 qaydanın köçürülməsi, trigger məntiqi (moderasiya, kvotalar, bildirişlər) | ✅ data API, 222 icazə qaydası, bütün 77 trigger (32 test) |
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

## Yazma qatı (`src/write/`)

Bütün sətir yazıları buradan keçir: data API, qeydiyyat, admin funksiyaları. Postgres-in 33 cədvəldəki 77 trigger-i (33 funksiya) burada eyni adla işləyir, `src/write/rules/` altında:

| Modul | Nə edir |
|---|---|
| `accounts.ts` | admin limiti (5), avatar qoruması, rol/status/məzun təsdiqi qoruması, təhsil təsdiqi, şirkət statusu yalnız Karyera Mərkəzi tərəfindən, sahibin profil statusunun sinxronu |
| `workflow.ts` | reviewer/editor yalnız moderasiya sahələrini dəyişir, müraciət qoruması və status tarixçəsi, vakansiya statusu qoruması, iş axını bildirişləri |
| `billing.ts` | abunə normallaşdırması, faktura (`KM-İL-NNNNN`), ödənişin paketi bir dəfə aktivləşdirməsi (`payments_apply`), vakansiya/üzv/aylıq paylaşım kvotaları, istifadə sinxronu |
| `content.ts` | tədbir, vakansiya, güzəşt, sayt məzmunu və Karyera Mərkəzi paylaşımları üçün ümumi bildiriş (`broadcast_notifications`), `updated_at` yeniləmələri |
| `interviews.ts` | müsahibə vaxtı yoxlaması və üst-üstə düşməmə qaydası (`EXCLUDE`), müraciətin "interview" mərhələsinə keçməsi, müsahibə sorğusu, əməkdaşlıq müraciətləri |
| `moderation.ts` | post/şərh moderasiyası (`moderation_guard`), söz filtri, moderasiya webhook-u (commit-dən sonra), söz siyahısının normallaşdırılması, paket üzrə media icazəsi |
| `checks.ts` | MySQL-in qəbul etmədiyi CHECK-lər (`follows`, `messages`, `connections`) |

Postgres semantikası saxlanılır: NEW-da bütün sütunlar olur (default-lar BEFORE trigger-lərdən əvvəl doldurulur), eyni hadisənin trigger-ləri ad sırası ilə işləyir (`000_…` birinci), `UPDATE OF sütun` yalnız sütun UPDATE-in SET siyahısında olanda işləyir, iç-içə yazılar çağıranın `auth.uid()`-si ilə gedir. Söz filtri (`src/write/moderation-text.ts`) `private.mod_*` funksiyalarının simvol-simvol köçürməsidir və müqayisə dəqiqdir (MySQL kollasiyası ilə yox). Audit (`admin_audit_logs`) Postgres-dəki kimi 28 cədvəldə var.

## Data API (`/rest/v1`)

- **Sorğular:** `select` (sütunlar, `*`, alias, `rel!fk!inner(...)` birləşdirmə), `eq/neq/gt/gte/lt/lte/like/ilike/is/in/cs/cd`, `not.`, `order` (Postgres NULL sırası), `limit/offset`, `count=exact`, `HEAD`, `single`/`maybeSingle`.
- **Yazma:** `insert` (tək və ya massiv), `upsert` (`on_conflict`, `merge`/`ignore-duplicates`), `update`, `delete`, `return=representation`.
- **İcazələr:** `tools/policies-to-mysql.mjs` 222 RLS qaydasını MySQL fragmentlərinə çevirir (`src/rest/policies.generated.json`). Hamısı MySQL-də kompilyasiya olunaraq yoxlanılıb. Hər sorğudan əvvəl sessiya dəyişənləri qurulur (`@auth_uid`, `@is_admin`, `@admin_role`, …), köməkçi funksiyalar isə migration `0003`-dədir. Semantika Postgres-dəki kimidir: icazəverən qaydalar OR, məhdudlaşdıran qaydalar AND; UPDATE/DELETE üçün SELECT qaydası da tətbiq olunur; `service_role` RLS-i keçir.
- **Xətalar:** PostgREST formatında və Postgres kodları ilə (`42501`, `23505`, `23503`, `23514`, `PGRST116`, …).

### Hələ bağlanmamış boşluqlar

- Xəta ardıcıllığı: Postgres sətirdə əvvəl RLS `WITH CHECK`-i, sonra CHECK/NOT NULL-u yoxlayır, MySQL isə əvvəl öz məhdudiyyətlərini. Sorğu hər ikisini pozanda başqa xəta kodu qayıda bilər; nəticə (rədd) eynidir. Tamamilə icazəsiz cədvəllər üçün RLS xətası əvvəl qaytarılır.
- AFTER trigger-lər hər sətirdən dərhal sonra işləyir, Postgres-də isə ifadənin sonunda. Çox sətirli PATCH-də nəticə eynidir, yalnız xətanın hansı sətirdə çıxdığı fərqlənə bilər.
- Upsert (`on_conflict`) mövcud sətirdə BEFORE INSERT trigger-lərini işə salmır (Postgres salırdı). Sayt və admin panel upsert-i yalnız BEFORE trigger-i olmayan cədvəllərdə (`broadcast_notification_reads`, `plan_features`) istifadə edir.
- Moderasiya webhook-unun ünvanı hələ `*.supabase.co`-dadır (cədvəlin CHECK qaydası). 5-ci mərhələdə yeni API-nin funksiya ünvanına keçəcək.
- `or=`/`and=` filtrləri və birləşdirilmiş cədvəl üzrə filtr dəstəklənmir. Sayt bunları istifadə etmir.

- İstifadəçi silinəndə MySQL xarici açar kaskadları uşaq cədvəllərin yazma qaydalarını (audit, kvota sayğacları) işə salmır, Postgres-də isə trigger-lər işləyirdi. Keçiddən əvvəl istifadəçi silmə yazma qatından keçəcək (6-cı mərhələ).
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
    values.ts               sütun tipinə görə dəyər formatı (sorğu → bazanın qaytardığı forma)
    write/pipeline.ts       yazma qatı; write/rules/ — trigger ekvivalentləri; write/moderation-text.ts — söz filtri
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
