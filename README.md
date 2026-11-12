# ADNSU Career Center

ADNSU Career Center tələbə, magistr, məzun, şirkət və Karyera Mərkəzi əməkdaşlarını eyni backend üzərindən birləşdirən karyera platformasıdır.

## Vəziyyət (12 noyabr 2026)

Backend universitetin serverində **MySQL 8.4 + Node.js API** üzərində işləyir (`server/`, quraşdırma: [`deploy/universitet-mysql/`](deploy/universitet-mysql/README.md)). Köhnə baza 12.11.2026 bağlanıb, bütün data və fayllar yoxlanılmış ehtiyat nüsxədədir və serverə oradan köçürülür. Server işə düşənə qədər hər iki sayt "texniki işlər" səhifəsini göstərir.

Yoxlama: `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run build`; API üçün `cd server && npm test` (MySQL 8.4 lazımdır, `MYSQL_TEST_URL`).

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

- Giriş serverin auth xidmətindədir (bcrypt); parollar tətbiq cədvəllərində və `localStorage`-da saxlanmır.
- Serverin icazə qatı tələbə, şirkət və admin məlumatlarını rol üzrə qoruyur.
- Şirkət paket limitləri yalnız interfeysdə deyil, verilənlər bazasında da yoxlanılır.
- Admin əməliyyatları audit tarixçəsinə yazılır.
- Service Role açarı heç vaxt brauzerə və repozitoriyaya daxil edilmir.
- Admin heyəti maksimum 5 aktiv istifadəçi ilə məhdudlaşdırılıb.

## Sənədlər

- [Arxitektura](docs/ARCHITECTURE.md)
- [İT təhvil sənədi](docs/IT-HANDOVER.md)
- [Server quraşdırması](deploy/universitet-mysql/README.md)
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
