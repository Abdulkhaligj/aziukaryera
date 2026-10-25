# Məlumat xəritəsi və saxlanma müddətləri — təsdiqlənməmiş layihə
Tarix: 25.10.2026. Hüquqi təsdiq olmadan bu müddətləri tətbiq etməyin.

| Məlumat kateqoriyası | Məqsəd | Faktiki təhlükəsizlik yoxlaması | Təklif olunan saxlama qaydası |
|---|---|---|---|
| Profil: ad, universitet e-poçtu, telefon | Hesab və əlaqə | `profiles` RLS və auth rolu | Hesab aktiv olduğu müddətdə; çıxış/silinmə qaydası hüquqi təsdiqlə |
| Təhsil, GPA, bacarıqlar, təcrübələr | Uyğun vakansiya | Rol əsasında profil görünürlüyü | Yalnız ehtiyac olduqda və profil sahibinin nəzarətində |
| CV mətni və faylı | Müraciət, CV qurma/analiz | Həqiqi CV upload/storage axını ayrı sınaqdan keçməlidir; bütün versiyalarda eyni deyil | Tam CV saxlanmasına ayrıca əsas və müddət lazımdır |
| Vakansiya müraciətləri | Müraciətin izlənməsi | `applications` student_id və işəgötürənə aid şirkət qaydaları | Müraciətin bağlanması + təsdiqlənmiş zəruri müddət |
| Şirkət və əlaqəli şəxs | Şirkət identifikasiyası | `companies` / şirkət statusu | Müqavilə və hesabatlılıq tələbinə uyğun |
| Müsahibə vaxtları | Görüş təşkilatı | `company_interview_slots` rol icazəsi | Müsahibədən sonra yalnız zəruri müddət |
| Bildiriş və audit | Sistem əməliyyatları, təhlükəsizlik | `notifications`, admin audit | Təsdiqlənmiş təhlükəsizlik/hesabat siyasətinə uyğun |
| AI analizləri və promptlar | Karyera məsləhəti | AI provayderi / saxlanma / transsərhəd risk ayrıca qiymətləndirilməlidir | Mümkün qədər minimallaşdırılmış və qısa müddətli |

## Texniki tələblər
- Tam CV-lərin və CV əlavələrinin açıq/publik storage bucket-ə yerləşdirilməməsi.
- Şirkətin yalnız ona müraciət etmiş namizədlərin məlumatını (və ya ayrıca icazə verilən məhdud kataloq məlumatını) görə bilməsi.
- Fayla giriş üçün qısa müddətli, istifadəçi hüququ təsdiqlənən imzalı link; xidmət rolu açarı yalnız serverdə.
- Silinmə sorğusunda əlaqədar storage fayllarının, DB qeydlərinin və üçüncü tərəf nüsxələrinin xəritələnməsi.
- Ümumi namizəd siyahısından şəxslərin telefon, şəxsi e-poçt və tam CV-sinin kütləvi çıxarılmaması.
- Sınaqlar üçün həqiqi CV və istifadəçi məlumatından istifadə edilməməsi.

## Mütləq qərar
Hər kateqoriya üçün: hüquqi əsas, saxlanma müddəti, cavabdeh şəxs, hansı ölkədə saxlanması və silinmə mexanizmi müəyyənləşdirilməlidir.
