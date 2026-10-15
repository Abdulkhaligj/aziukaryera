# Quraşdırma təlimatı

## Tələblər

- Node.js 22 və ya daha yeni;
- pnpm;
- Supabase layihəsi;
- Vercel hesabı;
- yalnız AI funksiyaları üçün Gemini və ya Groq açarı.

## Admin panel

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

`.env.local` daxilində yalnız Supabase URL, publishable key və tətbiq URL-i yazılmalıdır. Service Role açarı frontend dəyişəni deyil.

## Əsas portal

`student-web/` statik tətbiqdir. Supabase URL və publishable key `student-web/assets/js/config.js` daxilində brauzer üçün açıq konfiqurasiya kimi saxlanılır. RLS aktiv olmadan istehsala yerləşdirməyin.

## Verilənlər bazası

Miqrasiyaları tarix sırası ilə tətbiq edin:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy career-ai
supabase functions deploy admin-users
```

## AI secret-ləri

Provayderlərdən ən azı biri kifayətdir:

```bash
supabase secrets set GEMINI_API_KEY=...
# və ya
supabase secrets set GROQ_API_KEY=...
```

Secret olmadıqda sistem süni nəticə uydurmur və istifadəçiyə konfiqurasiya xətası göstərir.

## İlk admin

1. Supabase Auth-da korporativ e-poçtla istifadəçi yaradın.
2. `profiles.role` dəyərini `admin`, statusu `active`, `admin_role` dəyərini `super_admin` edin.
3. Sonrakı adminləri paneldəki “Admin istifadəçiləri” bölməsindən dəvət edin.
4. Maksimum 5 aktiv admin hesabı saxlanılır.

## Yoxlama

```bash
pnpm typecheck
pnpm build
```

Əsas portal JavaScript faylları üçün sintaksis yoxlaması və mobil/desktop brauzer sınaqları ayrıca aparılmalıdır.
