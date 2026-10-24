# Şirkət istifadəçi təlimatı

## Qeydiyyat

“Qeydiyyat” səhifəsində “Şirkət kimi qeydiyyat” seçin. Şirkət, korporativ e-poçt, əlaqə, veb-sayt, sektor, ölçü, ünvan, loqo, təsvir və əlaqələndirici şəxs məlumatlarını doldurun. FREE, PRO və ya BUSINESS paketini seçdikdən sonra şirkət admin təsdiqinə göndərilir.

## Paketlər

| Paket | Qiymət | Aktiv vakansiya | Featured | Əsas hüquq |
|---|---:|---:|---:|---|
| FREE | 0 AZN/ay | 1 | 0 | əsas profil, müraciət siyahısı və mətn paylaşımı |
| PRO | 24.99 AZN/ay | 10 | 2/ay | namizəd axtarışı, AI sıralama, media və inkişaf etmiş analitika |
| BUSINESS | 49.99 AZN/ay | limitsiz | 10/ay | prioritet yerləşdirmə, geniş komanda, bulk mesaj və premium imkanlar |

Limitlər serverdə tətbiq olunur; interfeysi keçərək əlavə vakansiya və ya qadağan olunmuş funksiya yaratmaq mümkün deyil.

## Vakansiya yaratmaq

“Yeni vakansiya” bölməsində vəzifə, iş növü, şöbə, təsvir, öhdəliklər, tələblər, əsas və üstün bacarıqlar, fakültə/ixtisas, təcrübə, maaş, şəhər, iş rejimi, son tarix, yer sayı və müraciət üsulunu doldurun.

“Vakansiyanı göndər” düyməsindən sonra elan dərhal yayımlanmır. Status `pending_approval` olur. Admin qərarı bildirişlə göndərilir.

## Müraciət pipeline-ı

Mərhələlər:

`Applied → Under Review → Shortlisted → Interview → Offer → Rejected / Hired`

Şirkət yalnız öz vakansiyalarına daxil olan müraciətləri idarə edir. Mərhələ dəyişikliyi tarixçədə saxlanılır və tələbəyə bildiriş yaradır.

## Komanda və namizəd bazası

Recruiter sayı paket limitinə bağlıdır. FREE paket yalnız öz müraciətçilərini görür. PRO və BUSINESS paketləri aktiv `candidate_search` hüququ olduqda geniş namizəd axtarışından istifadə edir.


## HR analitika (yeni)

Şirkət kabinetinin sol menyusundakı **HR Analitika** səhifəsindən bu göstəricilərə baxın:

- bütün müraciətlərin sayı və son 30 gündə gələn müraciətlər;
- müsahibə mərhələsində olan və işə qəbul olunmuş namizədlər;
- müraciətlərin hazırkı mərhələlər üzrə bölgüsü (hər müraciət yalnız bir dəfə sayılır);
- vakansiya üzrə müraciət, müsahibə və işə qəbul sayı;
- şirkət profilinin tamamlanması, yayımlanan və təsdiq gözləyən vakansiyalar;
- Pro və Business planlarında şirkətin **öz vakansiyalarında** tələb etdiyi ən çox təkrarlanan bacarıqlar.

**Məlumat mənbəyi:** hazırkı autentifikasiya sessiyasında şirkətin giriş hüququ olan vakansiyalar və müraciətlər. Bu səhifə heç bir yeni şəxsi məlumat bazası yaratmır və digər şirkətlərin müraciətlərini göstərmir. Rəqəmlər real müraciətlərdən hesablanır; müraciət yoxdursa, sıfır və izahlı boş vəziyyət görünür.

**Vacib:** mərhələlər qrafiki tarixi konversiya funnel-i deyil, müraciətlərin hazırkı statuslarına görə bölgüsüdür. Göstəricilər yalnız hesabınızın məlumatları yükləndiyi an üçün keçərlidir.

Paket hüququna görə namizəd axtarışı yalnız aktiv Pro və Business abunəliklərində açılır. Ödəniş və abunə təsdiqi hələ də mövcud admin/Supabase mexanizmləri tərəfindən həyata keçirilir.


## Geniş Talent Pool

Şirkət kabinetində **Geniş Talent Pool** seçin. Pro və Business paketində aktiv abunəliklə aşağıdakı filtrlər mövcuddur: ad/ixtisas/bacarıq axtarışı, fakültə, ixtisas, kurs, minimum GPA, bacarıq və vakansiyaya görə uyğunluq sıralaması. Yalnız Supabase RLS-in bu şirkət hesabına verdiyi profil məlumatları istifadə edilir. Namizədin tam şəxsi CV sənədi avtomatik göstərilmir.

## CV/profil müqayisəsi

**CV müqayisəsi** səhifəsində şirkətin öz vakansiyalarına müraciət etmiş 2 və ya 3 namizəd seçilir. İxtisas, fakültə, GPA, kurs, bacarıqlar, müraciət statusu və elan üzrə uyğunluq faizi yan-yana müqayisə edilir. Bu, **strukturlaşdırılmış profil müqayisəsidir**, PDF CV fayllarını yükləyib təhlil etmir; seçim qərarını AI vermir.

## Müsahibə təqvimi

**Müsahibə təqvimi** bölməsində yalnız şirkətin öz vakansiyalarına müraciət etmiş namizədlər üçün görüş yaratmaq mümkündür. Bakı vaxtı ilə tarix/saat, görüş müddəti, əyani/onlayn/telefon formatı, məkan və qeyd göstərilir. Tələbəyə avtomatik bildiriş gedir. Görüşü tamamlanmış və ya ləğv edilmiş kimi qeyd etmək olar. Görüşlər serverdə \`company_interview_slots\` cədvəlində saxlanılır və RLS ilə qorunur.

## Universitetlə əməkdaşlıq

**ADNSU əməkdaşlığı** bölməsindən karyera günü, müəssisə ziyarəti, workshop, təcrübə, diplom layihəsi və qonaq mühazirə təklifləri göndərilir. Müraciətin adı, ətraflı təsviri, əlaqə e-poçtu və istəyə bağlı tarix daxil edilir. Göndərilən sorğuların statusu şirkət kabinetində izlənilir. Karyera Mərkəzinin adminlərinə bildiriş gedir; statusun dəyişməsi şirkətə bildirilir.

Karyera Mərkəzi əməkdaşları həm əsas portalın admin hesabındakı **Əməkdaşlıq sorğuları**, həm də ayrıca admin saytındakı **/admin/partnerships** səhifəsindən sorğuları görə bilərlər. Ayrı admin saytda qərar vermə hüququ Super Admin və Manager rollarına məhdudlaşdırılıb.

## Təhlükəsizlik və yayımlama

- Yeni cədvəllərə anonim giriş bloklanıb və sətir səviyyəli RLS aktivdir.
- Şirkət digər şirkətlərin müsahibə və əməkdaşlıq sorğularına çıxış ala bilməz.
- Tələbə yalnız öz müsahibəsinə baxa bilir və görüşü dəyişə bilmir.
- Sorğuların qərar hissəsini yalnız admin yeniləyə bilir.
- Offline demo rejimində yeni formalar brauzerdə saxlanılır; gerçək bildiriş və server sorğusu göndərilmir.
- Frontend kodu GitHub qolundan canlı sayta yayımlanmadıqca yeni menyular istifadəçilərə görünməyəcək.
