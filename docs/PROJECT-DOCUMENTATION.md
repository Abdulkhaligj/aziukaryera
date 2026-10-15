# ADNSU Career Center - Layihə sənədi

## Layihənin məqsədi

ADNSU Career Center tələbə, magistr, məzun, şirkət və universitetin Karyera Mərkəzini bir təhlükəsiz ekosistemdə birləşdirir. Tələbə uyğun karyera imkanını tapır və müraciət edir; şirkət paket seçərək elan və namizəd axınını idarə edir; admin bütün kritik yayımları təsdiqləyir.

## Sistem arxitekturası

Mövcud tələbə/şirkət portalı və Next.js admin paneli eyni Supabase Auth və PostgreSQL bazasına qoşulur. RLS, trigger-lər və Edge Functions rolları, sahiblik münasibətlərini, paket hüquqlarını və admin əməliyyatlarını qoruyur.

## Tələbə axını

Tələbə ayrıca qeydiyyat seçimindən daxil olur. Bachelor, Master və Graduate/Alumni təhsil səviyyələri dəstəklənir. Magistr məlumatı ayrıca education qeydi kimi saxlanılır. Tələbə təsdiqlənmiş vakansiya və paylaşımları görür, filtrləyir, yadda saxlayır, müraciət edir, CV və müsahibə alətlərindən istifadə edir.

## Şirkət axını

Şirkət korporativ və əlaqə məlumatlarını doldurur, FREE, PRO və ya BUSINESS paketini seçir və admin təsdiqini gözləyir. Təsdiqdən sonra vakansiya yaradır, ancaq elan admin təsdiqinə qədər ictimai olmur. Şirkət öz müraciətlərini pipeline üzrə idarə edir.

## Paketlər

- FREE: 0 AZN/ay, 1 aktiv vakansiya, əsas profil, müraciət siyahısı və mətn paylaşımı.
- PRO: 24.99 AZN/ay, 10 aktiv vakansiya, 2 featured elan, namizəd axtarışı, AI sıralama, media və inkişaf etmiş analitika.
- BUSINESS: 49.99 AZN/ay, limitsiz aktiv vakansiya, 10 featured elan, prioritet görünürlük, geniş komanda, bulk kommunikasiya və premium imkanlar.

Limitlər admin paneldən konfiqurasiya edilir və verilənlər bazasında tətbiq olunur.

## Admin axını

Admin şirkətləri və vakansiyaları yoxlayır; təsdiqləyir, redaktə edir, rədd edir, düzəliş üçün qaytarır, arxivləşdirir və ya silir. Tələbə, şirkət, paket, abunəlik, paylaşım, moderasiya, AI istifadəsi və audit məlumatları bir paneldə idarə olunur.

## Vakansiya təsdiqi

Yeni elan `pending_approval` statusu ilə yaranır. Yalnız `approved` və `published` statusları əsas saytda görünür. `changes_requested`, `rejected`, `expired` və `archived` ictimai siyahıdan gizlidir. Qərar şirkətə bildiriş yaradır.

## Verilənlər bazası

Əsas cədvəllər profiles, education, companies, company_members, plans, plan_features, subscriptions, subscription_usage, jobs, applications, application_status_history, posts, post_media, notifications, reports, moderation_logs, cv_documents, interview_sessions, ai_usage, payments və audit_logs-dur. Əlaqələr foreign key-lərlə qorunur, dəyişikliklər migrations vasitəsilə idarə olunur.

## Təhlükəsizlik

İstehsal parolları Supabase Auth-da saxlanılır. RLS tələbənin yalnız öz şəxsi məlumatlarını, şirkətin yalnız öz elan və müraciətlərini, adminin isə səlahiyyətinə uyğun məlumatı idarə etməsinə imkan verir. Service Role açarı serverdən kənara çıxmır. Mühüm admin əməliyyatları audit olunur.

## AI

CV təhlili və müsahibə sualları server tərəfli Edge Function-dan Gemini və ya Groq-a göndərilir. Cavablar strukturlaşdırılmışdır, AI istifadə statistikası saxlanılır və secret olmadıqda saxta nəticə qaytarılmır.

## Yerləşdirmə

Əsas portal yalnız `asoiu-career` Vercel layihəsinə `student-web` root-u ilə, admin panel isə yalnız `asoiu-career-admin` layihəsinə repo kökündən yerləşdirilir. Hər iki tətbiq eyni Supabase layihəsini istifadə edir. GitHub repozitoriyası private olmalıdır.

## Texniki xidmət

Hər buraxılışdan əvvəl migrations, typecheck, production build, RLS sınağı, paket limit sınağı və tam tələbə-şirkət-admin smoke testi aparılmalıdır. Backup yoxlanmadan production sıfırlaması edilməməlidir. API secret-ləri periodik rotasiya olunmalı və heç vaxt Git-ə yazılmamalıdır.
