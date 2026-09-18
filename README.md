# ADNSU Career Admin v1

ADNSU Karyera Mərkəzinin əməkdaşları üçün Next.js + Supabase idarəetmə paneli.

## Modullar

- ümumi statistika və son fəaliyyət;
- vakansiya, şirkət, tədbir və tələbə güzəşti CRUD;
- müraciətlərin mərhələlər üzrə idarəsi;
- tələbə siyahısı və profil statusu;
- ana səhifə/FAQ kimi sayt məzmunu;
- əməkdaş rolları: `super_admin`, `manager`, `editor`, `reviewer`;
- bütün dəyişikliklərin audit tarixçəsi;
- mobil və masaüstü uyğun interfeys;
- Supabase konfiqurasiya edilmədən işləyən demo rejimi.

## İşə salma

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sonra `http://localhost:3000/admin` açın. `.env.local` boş qaldıqda panel demo rejimində işləyir.

## Supabase inteqrasiyası

1. `supabase/migrations/202609180001_admin_panel.sql` faylını Supabase SQL Editor-da işə salın.
2. Project Connect bölməsindən URL və Publishable Key götürüb `.env.local` faylına yazın.
3. Authentication bölməsində əməkdaş hesabını yaradın.
4. İstifadəçinin `app_metadata.role` dəyərini `super_admin`, `manager`, `editor` və ya `reviewer` edin.
5. Eyni istifadəçi ID-si ilə `profiles` cədvəlinə ad, rol və `active` statusu əlavə edin.

Rol icazələri:

| Rol | Baxış | Əlavə/redaktə | Silmə | Rolları idarə etmə |
|---|---:|---:|---:|---:|
| Super Admin | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | — |
| Editor | ✓ | ✓ | — | — |
| Reviewer | ✓ | yalnız müraciət statusu | — | — |

## Mövcud sayta qoşulma

Bu paketdəki `app/admin`, `app/api/admin`, `components/admin-shell.tsx`, `lib/supabase` və `proxy.ts` mövcud Next.js layihəsinə köçürülür. Canlı tələbə saytındakı statik `jobs`, `companies`, `events` və `benefits` massivləri Supabase sorğuları ilə əvəz edilməlidir. Beləliklə admin paneldə yayımlanan dəyişiklik tələbə kabinetində avtomatik görünəcək.

Vacib: frontend-də yalnız Publishable Key saxlanır. Supabase Secret/Service Role açarı brauzerə və `NEXT_PUBLIC_` dəyişənlərinə yazılmamalıdır.
