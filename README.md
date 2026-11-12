# ADNSU Career Center

ADNSU Career Center tələbə, magistr, məzun, şirkət və Karyera Mərkəzi əməkdaşlarını eyni Supabase backend-i üzərindən birləşdirən karyera platformasıdır.

## 2 noyabr 2026 təhlükəsizlik yeniləməsi

Bu paketdəki yeni təhlükəsizlik migration-ları mövcud, tam sxem üçün **upgrade**-dir. Təhvil verilmiş köhnə migration-lar sıfırdan qurulmaq üçün natamamdır: ikinci migration `public.is_admin()` tərifini və digər baza obyektlərini gözləyir. Tam schema-only baseline olmadan boş Supabase layihəsinə bütün faylları ardıcıl tətbiq etməyin. Bu məhdudiyyət yerli sintetik testlərlə aradan qalxmış sayılmır.

Əvvəlki production ünvanları aşağıda tarixi məlumatdır. Düzəldilmiş portal üçün öz Supabase konfiqurasiyası tələb olunur; əvvəlki layihəyə avtomatik qoşulmur. Admin və portal dəyişiklikləri ilə birlikdə `20261102190000_security_boundaries.sql`, `20261102200000_business_integrity.sql`, `20261102210000_ai_reservations.sql`, `20261102220000_atomic_company_quotas.sql` və `20261102230000_complete_moderation_input.sql` tarix sırası ilə tətbiq edilməlidir. Mövcud üst-üstə düşən müsahibələr migration-u dayandırır; onları məsul şəxs ayrıca uyğunlaşdırmalıdır.

Moderasiya öz layihəniz üçün qurulan `private.moderation_webhook_config` və eyni `MODERATION_WEBHOOK_SECRET` Edge secret-i ilə işləyir. Konfiqurasiya edilməyən sistem xaricə çağırış göndərmir və məzmunu pending saxlayır. Service Role və webhook secret brauzer konfiqurasiyasına yazılmamalıdır.

Moderasiya upgrade-i zamanı öz layihənizdə sender-i müvəqqəti deaktiv edin (`private.moderation_webhook_config.enabled=false`), migration-ları və yeni `content-moderation` funksiyasını tətbiq edin, sonra sender-i yenidən aktiv edin. Yeni verdict kontraktı `p_content_version=2` tələb edir; köhnə handler yeni mətni təsdiqləyə bilmir. Mətn, keçid və göstərilən teqlər separatorlarla birlikdə ən çox 6000 Unicode code point ola bilər. Köhnə həddən uzun məzmun, köhnə UTF-16 kəsilməsinə düşən Unicode mətnləri, həmçinin köhnə kontraktda keçid/teqlərinin yoxlandığı sübut edilməyən görünən paylaşımlar silinmədən gizlədilir. Admin onları nəzərdən keçirib `pending` ilə yeni yoxlamaya göndərməlidir; upgrade kütləvi AI çağırışı yaratmır. Mətn və keçid/teq dəyişməsi yenidən moderasiyaya gedir.

Kvotalar transaction daxilində atomik sayğaclarla yoxlanır. Əvvəlki saydan artıq qeydlər migration zamanı silinmir; yeni artırıcı yazılar limitə uyğun olmalıdır. Vakansiya/komanda aktiv sayı və aylıq paylaşım sayı silinmə/deaktivləşmə zamanı əvvəlki qaydaya uyğun azalır. Aylıq paylaşım UTC ayı ilə hesablanır; adi istifadəçi paylaşımın sahibini və yaradılma vaxtını dəyişə bilmir.

Yeni mühitdə email confirmation və SMTP, admin MFA, backup/restore, bildiriş və açar rotasiyası ayrıca təsdiqlənməlidir. Yerli yoxlamalar həmin hesab sazlamalarını dəyişmir. Yeni DB qaydalarında ödənişli planların vaxtı sorğu zamanı bitir; gizli grace period tətbiq edilmir.

Yoxlama: `npm ci --ignore-scripts`, `npm test`, `npm audit --audit-level=moderate`, `npm run typecheck`, `npm run build`. Tam repo nüsxəsində Docker ilə `python supabase/tests/test_security_migrations.py`, `python supabase/tests/test_atomic_company_quotas.py`, `python supabase/tests/test_moderation_boundary.py` və `python tests/ai-database-security.py` də işlədin. Bunlar real Supabase gateway/Storage və tam baseline replay sınağını əvəz etmir.

## İstehsal ünvanları

- Əsas platforma: https://asoiu-career.vercel.app/
- Admin panel: https://asoiu-career-admin.vercel.app/

## Əsas axın

1. Tələbə və ya şirkət ayrıca qeydiyyatdan keçir.
2. Şirkət `FREE`, `PRO` və ya `BUSINESS` paketini seçir.
3. Şirkət təsdiqləndikdən sonra vakansiya yaradır.
4. Yeni vakansiya `pending_approval` statusu ilə admin növbəsinə düşür.
5. Admin vakansiyanı təsdiqlədikdə elan əsas saytda görünür.
6. Tələbə müraciət edir, şirkət müraciəti seçim mərhələləri üzrə idarə edir.

## Repozitoriya quruluşu

```text
student-web/                 əsas tələbə və şirkət portalı
app/, components/, lib/     Next.js admin paneli
server/                      backend: MySQL sxemi və Node.js API (giriş, data, icazələr, fayllar)
supabase/functions/          AI və admin funksiyaları (API-nin içində işləyir; qovluq adı tarixidir)
deploy/universitet-mysql/    universitet serveri üçün quraşdırma dəsti (Docker)
docs/                        texniki və istifadəçi təlimatları
```

## Lokal işə salma

Admin panel:

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Əsas portal statik saytdır və `student-web/` qovluğundan lokal HTTP server ilə açıla bilər.

## Təhlükəsizlik

- İstehsal autentifikasiyası Supabase Auth-dur; parollar tətbiq cədvəllərində və `localStorage`-da saxlanmır.
- RLS siyasətləri tələbə, şirkət və admin məlumatlarını rol üzrə qoruyur.
- Şirkət paket limitləri yalnız interfeysdə deyil, verilənlər bazasında da yoxlanılır.
- Admin əməliyyatları audit tarixçəsinə yazılır.
- Service Role açarı heç vaxt brauzerə və repozitoriyaya daxil edilmir.
- Admin heyəti maksimum 5 aktiv istifadəçi ilə məhdudlaşdırılıb.

## Sənədlər

- [Arxitektura](docs/ARCHITECTURE.md)
- [Quraşdırma](docs/SETUP.md)
- [Yerləşdirmə](docs/DEPLOYMENT.md)
- [Admin təlimatı](docs/ADMIN_GUIDE.md)
- [Şirkət təlimatı](docs/COMPANY_GUIDE.md)
- [Tələbə təlimatı](docs/STUDENT_GUIDE.md)
- [Funksiyalar](docs/FEATURES.md)
- [Test siyahısı](docs/TEST_CHECKLIST.md)
- [İT şöbəsi üçün təhvil sənədi](docs/IT-HANDOVER.md)

## Keyfiyyət yoxlaması

```bash
pnpm typecheck
pnpm build
```

AI CV və müsahibə imkanları `career-ai` Edge Function vasitəsilə işləyir. Provayder açarı olmadıqda saxta cavab göstərilmir; təhlükəsiz xəta qaytarılır. Dəstəklənən provayderlər Gemini və Groq-dur.
