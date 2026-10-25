# ADNSU Karyera — dəyişiklik və buraxılış qapıları
**Hər production buraxılışından əvvəl yoxlanılır.**

## Qorunmalı baza
- Əsas sayt: https://asoiu-career.vercel.app/ · Vercel layihəsi `asoiu-career-main-v3`.
- Admin: https://asoiu-career-admin.vercel.app/ · GitHub layihəsinin ayrıca Next.js build-i.
- Əsas saytın Vercel CLI ilə yüklənmiş mənbəyində GitHub `student-web` ilə eyni olmayan komponentlər var. **Eyni mənbə təsdiqlənmədən GitHub student-web fayllarını əsas domain üzərinə qoymaq olmaz.**
- Production dəyişiklikdən əvvəl əvvəlki deployment ID və ona aid domen aliaslarını qeyd edin.

## Sınaq qapıları
- [ ] Main səhifədə bannerlər, universitet məlumatı, AIDA, profil ikonları, mobil görünüş eyni qalır.
- [ ] Tələbə qeydiyyatı, giriş, öz profilini görmə, CV yükləmə, vakansiyaya müraciət, imtina/geri götürmə.
- [ ] Şirkət qeydiyyatı, admin təsdiqi → sahib profilinin aktivləşməsi, vakansiya yaratma və təsdiq, yalnız öz namizədlərinə baxma.
- [ ] Admin rol icazələri, şirkət və vakansiya təsdiqi, şirkət əməkdaşlığı sorğusu, audit.
- [ ] RLS: tələbə başqa tələbənin CV/müraciətini görmür; şirkət rəqibin namizədlərinə çıxmır; anon şəxs şəxsi məlumatları görə bilmir.
- [ ] AI və məlumat paylaşımı sənədləri hüquq şöbəsində təsdiq olunub.
- [ ] Vercel preview build READY; kritik istifadəçi axınları real test hesabları ilə sınaqdan keçirilib.
- [ ] Supabase migrations və ilkin vəziyyət yoxlanılıb; məlum rollback üsulu hazırdır.
- [ ] Production çıxışından sonra doğru domain, asset-lər, giriş, yeni funksiya yenidən yoxlanılıb.
- [ ] Razılıq formasının hüquqi etibarlılığı ayrıca təsdiq edilib.

## Buraxılış qərarı
Bu siyahıdakı kritik bəndlər tamamlanmayıbsa **“READY” build statusu təkbaşına yayımlama təsdiqi deyil**.
