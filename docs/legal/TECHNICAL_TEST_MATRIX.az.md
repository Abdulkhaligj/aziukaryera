# Tələbə–Şirkət–Admin test matrisi və sübut siyahısı
**Test mühiti:** yalnız xüsusi test hesabları və sintetik CV; canlı şəxsi məlumatlardan istifadə etməyin.

| Axın | Müsbət test | Mənfi test | Sübut |
|---|---|---|---|
| Tələbə hesabı | E-poçt qeydiyyatı/təsdiq, login, profil | Başqasının profilinə və tətbiqinə giriş 403/boş | Screenshot + anonim test log |
| CV | CV düzəlişi, çıxarış və paylaşım | Başqasının CV faylına imzasız/açıq linkdən giriş yoxdur | RLS, storage policy, TTL |
| Şirkət | Qeydiyyat, təsdiq, elan göndərmə | Təsdiqsiz şirkət elanı yayımlaya, CV görə bilmir | Audit |
| Vakansiya | Admin təsdiqindən sonra açıq siyahı | Pending/rejected anon görünmür | Status/API |
| Müraciət | Tələbə müraciət edib izləyir | Şirkət rəqibin müraciətini oxuya bilmir | RLS testi |
| Müsahibə | Şirkət görüş yaradır | Yad tətbiq üçün görüş yazmaq mümkün deyil | RLS |
| Admin | Manager təsdiq edə bilir | Reviewer səlahiyyətsiz silə bilmir | Session + API |
| Şirkət müqaviləsi | Hüquqi versiya saxlanır | Qanuni əsas olmadan məxfi məlumat paylaşılmır | Event + audit |
| Privacy sorğusu | İstifadəçi sorğu verir, identifikasiya olunur | İstənilən adam başqası adına silinmə edə bilmir | Audit |
| Ödəniş | Təsdiqli ödəniş paket açır | Saxta webhook paket açmır | İmza + idempotency |
| Admin əsas səhifə | İşlək menyu, mobil ekran | 401/redirect işləyir | E2E |
| Release | Preview keyfiyyət testləri keçir | Main-v3 dizaynını başqa kod əvəz etmir | Deployment/alias ID |

İnfrastruktur və dizayn ayrılığı:
`asoiu-career.vercel.app` Vercel layihəsi `asoiu-career-main-v3` ilə bağlıdır.
GitHub `student-web` onu tam təkrarlamır; ayrıca təsdiq olmadan bu qovluğu əsas domenə deploy etməyin.
