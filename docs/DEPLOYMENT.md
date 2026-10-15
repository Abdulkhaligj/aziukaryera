# Yerləşdirmə təlimatı

## Hədəf layihələr

- `asoiu-career`: root directory `student-web`
- `asoiu-career-admin`: repozitoriyanın kök qovluğu

Başqa Vercel layihəsinə deploy edilməməlidir.

## GitHub

Repozitoriya private saxlanmalıdır. Push-dan əvvəl:

```bash
git status
git diff --check
pnpm typecheck
pnpm build
```

Heç bir API açarı, parol, Service Role açarı, OAuth secret-i, ödəniş secret-i və private key commit edilməməlidir.

## Vercel - əsas portal

1. Mövcud `asoiu-career` layihəsini private GitHub repozitoriyasına bağlayın.
2. Root Directory olaraq `student-web` seçin.
3. Framework Preset `Other`, build output isə statik kök qovluğu olsun.
4. Production domain `asoiu-career.vercel.app` olaraq qalmalıdır.

## Vercel - admin panel

1. Mövcud `asoiu-career-admin` layihəsini eyni repozitoriyaya bağlayın.
2. Root Directory repo kökü olsun.
3. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` və `NEXT_PUBLIC_APP_URL` production environment-ə əlavə edilsin.
4. Production domain `asoiu-career-admin.vercel.app` olaraq qalmalıdır.

## Supabase

Miqrasiyalar tətbiq kodundan əvvəl yerləşdirilməlidir. Edge Functions yerləşdirildikdən sonra RLS, vakansiya limiti, anonim görünürlük və admin rol sınaqları icra olunmalıdır.

## Buraxılışdan sonra

- tələbə və şirkət qeydiyyatını yoxlayın;
- FREE paketdə ikinci aktiv vakansiyanın bloklandığını yoxlayın;
- admin təsdiqindən əvvəl vakansiyanın saytda görünmədiyini yoxlayın;
- təsdiqdən sonra vakansiyanın avtomatik göründüyünü yoxlayın;
- admin paneldən dəyişiklik və silmənin əsas sayta təsirini yoxlayın;
- desktop və mobile görüntünü yoxlayın.
