# Təhlükəsizlik hadisəsinə cavab proseduru — işçi layihə
Bu plan ADNSU-nun səlahiyyətli IT və hüquq bölməsi tərəfindən təsdiqlənməlidir.

## 0. Hadisələr
Qeyri-qanuni CV yüklənməsi/oxunması, admin hesabının komprometasiya olunması, məlumatın üçüncü tərəfə sızması, icazə yoxlamasının yan keçilməsi, saxta vakansiya və dələduzluq, məlumat bazasının əlçatmazlığı.

## 1. İlk reaksiya
- Hadisəni vaxt möhürü və minimal faktlarla daxili hadisə jurnalına qeyd edin.
- Məsul təhlükəsizlik əməkdaşı və hüquq şöbəsini əlaqələndirin.
- Sızmanın genişlənməsini dayandırın: təsirlənmiş tokeni/sessiyanı ləğv edin, icazəni bağlayın, şübhəli paylaşımı dayandırın; sübutları məhv etməyin.
- Məxfi məlumatı GitHub issue-larına, açıq ekran görüntülərinə və ya qeyri-rəsmi çatlara göndərməyin.

## 2. Qiymətləndirmə
Hansı şəxslərin hansı məlumatı təsirlənib, ilk təsir vaxtı, sistem/subpodratçı, hansı icazə mexanizmi işləməyib və biznes riski müəyyənləşdirilməlidir.

## 3. Mərhələli bərpa
Sınaq mühitində düzəliş → məhdud təhlükəsizlik testi → məsul şəxsin təsdiqi → production; əsas sayt dizaynı və əvvəlki deployment saxlanılır.

## 4. Bildiriş
İstifadəçilərə və müvafiq qurumlara məlumat verilməsinin hüquqi əsası, məzmunu və vaxtı hüquq şöbəsi tərəfindən müəyyənləşdirilməlidir. Hüquqi yoxlanmadan avtomatik ümumi bildiriş göndərməyin.

## 5. Post-mortem
Kök səbəb, düzəliş, test sübutu, sahiblər, təkrarlanma riskinin azaldılması, bağlanma tarixi.
