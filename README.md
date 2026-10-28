# ADNSU Career Center

ADNSU Career Center tələbə, magistr, məzun, şirkət və Karyera Mərkəzi əməkdaşlarını eyni Supabase backend-i üzərindən birləşdirən karyera platformasıdır.

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
supabase/migrations/         verilənlər bazası sxemi və təhlükəsizlik qaydaları
supabase/functions/          admin istifadəçiləri və AI funksiyaları
docs/                        texniki və istifadəçi təlimatları
output/pdf/                  yekun layihə sənədi
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
