# Portalın təhlükəsiz yerləşdirilməsi

`assets/js/config.js` daxilində yalnız öz layihənizin ictimai Supabase URL və publishable açarını təyin edin. Service-role və secret açar burada saxlanmamalıdır. Əvvəlki sahibin layihəsi standart konfiqurasiyadan çıxarılıb. Əks halda `window.CAREER_CONFIG` obyektini bu fayldan əvvəl ayrıca yerli skriptlə verə bilərsiniz; CSP səbəbindən inline konfiqurasiya əlavə etməyin.

Bağlantı olmadıqda giriş bağlı qalır. İnternetsiz nümayişi qəsdən açmaq üçün `demoMode: true` seçin; bu rejim real autentifikasiya deyil.

Statik faylları istənilən HTTPS hostda yerləşdirin. Nginx üçün `nginx-security-headers.conf` faylını server/location blokuna include edin. Digər hostlarda eyni başlıqları tətbiq edin. `connect-src` daxilindəki Supabase wildcard-ını öz dəqiq Supabase origin-i ilə əvəz edin; custom domain varsa onu da dəqiq göstərin. Bu repo heç bir hosta avtomatik deploy etmir.

CSP HTML meta elementi hostdan asılı olmayaraq script icrasını məhdudlaşdırır; `frame-ancestors` və qalan cavab başlıqları isə hostda tətbiq olunmalıdır. CV qurucunun inline skriptini dəyişdikdən sonra `node scripts/update-security-policy.mjs` işlədin və regression testlərini keçirin. Xarici Supabase/React/QR kitabxanaları dəqiq versiyaya və SHA384 SRI dəyərinə bağlanıb. Yeni kitabxana versiyası üçün SRI-ni ayrıca yeniləmək lazımdır.

DB migration-lar və Edge Functions də eyni düzəliş buraxılışı ilə yerləşdirilməlidir: namizəd siyahısı `candidate_profiles()` RPC-sini, şəbəkə müəllif kartları `profile_cards(uuid[])` RPC-sini istifadə edir. Natamam orijinal baseline tam bərpa edilmədən yalnız bu statik faylların yerləşdirilməsi tam sistemin qəbul sınağı sayılmır.

CV qaralamaları Auth serveri ilə təsdiqlənmiş istifadəçiyə və sessiya versiyasına bağlanır. Çıxış və hesab dəyişməsi açıq redaktorun yaddaşını və əvvəlki sahibin qaralamalarını təmizləyir. Sahibi bilinməyən əvvəlki qlobal qaralamalar avtomatik silinir. Qonaq CV-ni yaddaşda redaktə və export edə bilir; qonağın şəxsi mətni diskdə saxlanmır.

Portalın `session.js` modulu compatibility/startup skriptlərindən sonra və `app.js`-dən əvvəl yüklənməlidir. O, cari təsdiqlənmiş istifadəçini və sessiya generation-ını bütün bootstrap, private sorğu və söhbət nəticələrinə bağlayır. `Backend.init`-i əvəz edən wrapper-lər əsas init-ə delegasiya etməlidir ki, Auth listener-ləri qoşulu qalsın. Logout/hesab dəyişməsi AIDA və mentor DOM/history/pending nəticələrini təmizləyir; köhnə mentor v1 tarixçəsi təhlükəsiz köçürülə bilmədiyi üçün silinir. Sessiya nəticələri başqa istifadəçinin yeni sessiyasına qəbul edilmir; backend Auth/RLS yoxlamaları ayrıca qüvvədədir.
