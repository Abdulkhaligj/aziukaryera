# Sistem arxitekturası

## Ümumi baxış

ADNSU Career Center iki ayrıca interfeysdən və bir ortaq backend-dən ibarətdir:

```text
Tələbə / Şirkət portalı ─┐
                         ├─ Supabase Auth + PostgreSQL + RLS + Edge Functions
Admin paneli ────────────┘
```

Əsas portal `student-web/` qovluğundakı mövcud ADNSU kabinet dizaynını saxlayır. Admin panel Next.js üzərində işləyir. Hər iki tətbiq eyni Supabase layihəsinə qoşulur; ayrıca mock verilənlər bazası istifadə olunmur.

## Domen modelləri

- `profiles`: bütün istifadəçilərin ümumi profili və rolu;
- `education`: bakalavr və magistr məlumatlarının ayrıca, çoxsətirli strukturu;
- `companies`, `company_members`: şirkət və recruiter heyəti;
- `plans`, `plan_features`, `subscriptions`, `subscription_usage`: paket və limit sistemi;
- `jobs`, `job_skills`: vakansiya məlumatları;
- `applications`, `application_status_history`: müraciət və pipeline tarixçəsi;
- `posts`, `post_media`, `comments`, `likes`, `follows`, `saved_items`: şəbəkə;
- `events`, `notifications`, `reports`, `moderation_logs`: tədbir və moderasiya;
- `cv_documents`, `interview_sessions`, `ai_usage`: karyera alətləri;
- `payments`, `audit_logs`: ödəniş arxitekturası və inzibati tarixçə.

## Əsas biznes axını

```text
Şirkət qeydiyyatı
  → paket seçimi
  → şirkət statusu: pending
  → admin təsdiqi
  → vakansiya yaradılması
  → status: pending_approval
  → admin təsdiqi / dəyişiklik tələbi / rədd
  → approved və ya published
  → əsas saytda görünmə
  → tələbə müraciəti
  → şirkət pipeline idarəetməsi
```

## Paket limitlərinin icrası

Limitlər UI-da göstərilir, lakin əsas nəzarət PostgreSQL trigger və RLS səviyyəsindədir. `plan_features` cədvəlindəki dəyərlər admin paneldən dəyişdirilə bilər. Aktiv vakansiya, aylıq paylaşım, media, namizəd axtarışı və komanda üzvü hüquqları backend-də yoxlanılır.

## Təhlükəsizlik sərhədləri

- Supabase Auth sessiyanı və parolu idarə edir.
- RLS hər sorğunu istifadəçi rolu və sahiblik münasibətinə görə süzgəcdən keçirir.
- `anon` rolu yalnız təsdiqlənmiş/yayımlanmış vakansiyaları görə bilir.
- FREE şirkət yalnız öz vakansiyalarına müraciət etmiş namizədləri görə bilər.
- PRO/BUSINESS namizəd axtarışı paket xüsusiyyəti ilə açılır.
- Müraciət statusunu tələbə dəyişə bilməz.
- Xüsusi admin istifadəçisi əməliyyatları Edge Function üzərindən yoxlanılır.
- Sıfırlama yalnız Super Admin və dəqiq iki mərhələli təsdiqlə mümkündür.

## AI arxitekturası

`career-ai` Edge Function CV təhlili, CV mətni təkmilləşdirməsi, uyğunluq izahı, ixtisasa uyğun müsahibə sualları və cavab rəyi verir. Provayder seçimi server secret-ləri ilə aparılır. İlk seçim Gemini, ehtiyat seçim Groq-dur. Giriş ölçüsü məhdudlaşdırılır, cavab strukturlaşdırılmış JSON olur və istifadə statistikası `ai_usage` cədvəlinə yazılır.

## Ödəniş arxitekturası

Paketlər və abunəliklər provayderdən asılı olmayan cədvəllərdə saxlanır. Hazırda admin tərəfindən manual paket təyin və uzatma axını işləyir. Sonradan ödəniş provayderi qoşulduqda checkout və webhook adapteri `payments` və `subscriptions` cədvəllərini yeniləməlidir; açarlar yalnız server environment dəyişənlərində saxlanmalıdır.
