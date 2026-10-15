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

Aktiv admin sayı maksimum 5-dir. Yeni əməkdaş təhlükəsiz Edge Function vasitəsilə dəvət olunur. Öz hesabınızı silmək mümkün deyil.

## Sistem sıfırlaması

Yalnız Super Admin üçün nəzərdə tutulub. İki mərhələli təsdiq və dəqiq `SIFIRLA` mətni tələb olunur. Əməliyyat əsas məzmunu təmizləyir, admin hesablarını, paketləri və fakültə/ixtisas arayışlarını saxlayır. Geri qaytarılması avtomatik deyil; production-da yalnız backup yoxlandıqdan sonra istifadə edilməlidir.
