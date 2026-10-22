# Admin istifadəçi təlimatı

## Giriş və rollar

Admin panelə yalnız aktiv əməkdaş hesabı daxil ola bilər. Rollar:

- `super_admin`: bütün imkanlar, admin heyəti və sistem sıfırlaması;
- `manager`: gündəlik idarəetmə və təsdiqlər;
- `editor`: məzmunun əlavə/redaktəsi;
- `reviewer`: baxış və təsdiq axınları.

## Şirkət təsdiqi

1. “Şirkətlər” bölməsində `pending` şirkəti açın.
2. korporativ e-poçt, əlaqələndirici şəxs və şirkət məlumatlarını yoxlayın;
3. təsdiq və ya rədd statusunu seçin;
4. lazım olduqda FREE, PRO və BUSINESS paketini manual təyin edin;
5. bütün dəyişikliklərin audit tarixçəsinə yazıldığını yoxlayın.

## Vakansiya təsdiqi

“Təsdiq gözləyənlər” bölməsində şirkət, paket, son tarix, maaş, təsvir, tələblər, bacarıqlar və hədəf ixtisaslar görünür. Əməliyyatlar:

- `approved` və ya `published`: əsas saytda görünür;
- `changes_requested`: şirkətə düzəliş üçün qaytarılır;
- `rejected`: rədd edilir;
- `archived`: ictimai görünüşdən çıxarılır;
- silmə: məlumatı bazadan silir və əsas sayta dərhal təsir edir.

## İstifadəçi idarəetməsi

Tələbə, magistr və məzun profilləri baxıla, redaktə edilə, təsdiqlənə, dayandırıla və silinə bilər. Filtrlər ad, e-poçt, fakültə, ixtisas, kurs, təhsil səviyyəsi və status üçündür. Bakalavr və magistr qeydləri ayrı saxlanılır.

## Paketlər

“Paketlər” bölməsində qiymət və limitlər source code dəyişmədən yenilənir. Vakansiya, paylaşım, media, komanda üzvü, namizəd axtarışı, AI və featured hüquqlarını dəyişərkən təsiri dərhal nəzərə alın.

## Moderasiya

Şikayət olunmuş paylaşımlar admin növbəsinə düşür. Admin baxa, gizlədə, silə, istifadəçiyə xəbərdarlıq edə və hesabı dayandıra bilər. Qərarlar `moderation_logs` cədvəlinə yazılır.

## Admin heyəti

Aktiv admin sayı maksimum 5-dir. Əməkdaşları yalnız Super Admin idarə edir (“Əməkdaşlar və rollar” bölməsi).

1. “Yeni əməkdaş” → ad, e-poçt və rol seçin → “Yadda saxla”.
2. Panel **müvəqqəti şifrə** göstərir (yalnız bir dəfə). Onu əməkdaşa üzbəüz və ya telefonla çatdırın; e-poçt göndərilmir, SMTP lazım deyil.
3. Əməkdaş `https://asoiu-career-admin.vercel.app/login` ünvanında müvəqqəti şifrə ilə daxil olur və dərhal öz şifrəsini qurmalıdır.
4. Şifrə unudulubsa: əməkdaşı açın → “Şifrəni sıfırla” → yeni müvəqqəti şifrə.
5. Girişi bağlamaq üçün statusu “Dayandırılıb” edin. Öz rolunuzu, statusunuzu dəyişmək və öz hesabınızı silmək mümkün deyil.

Rollar paneldə belə işləyir: Super Admin — hər şey; Menecer — bütün məzmun, istifadəçilər, ödənişlər və silmə; Redaktor — məzmun əlavə/redaktə və moderasiya, silmə yoxdur; Yoxlayıcı — hər şeyə baxış, yalnız müraciət, şikayət və paylaşım moderasiyası. Hər əməkdaş yalnız icazəsi olan düymələri görür. “Şifrəni dəyiş” və “Çıxış” profil menyusundadır.

## Sistem sıfırlaması

Yalnız Super Admin üçün nəzərdə tutulub. İki mərhələli təsdiq və dəqiq `SIFIRLA` mətni tələb olunur. Əməliyyat əsas məzmunu təmizləyir, admin hesablarını, paketləri və fakültə/ixtisas arayışlarını saxlayır. Geri qaytarılması avtomatik deyil; production-da yalnız backup yoxlandıqdan sonra istifadə edilməlidir.
