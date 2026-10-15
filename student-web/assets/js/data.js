/*!
 * ADNSU Career v2 — data.js
 * Statik demo datası: fakültələr, ixtisaslar, bacarıq taksonomiyası,
 * elanlar, şirkətlər, tələbə hovuzu, tədbirlər.
 *
 * Real quraşdırmada bu fayl backend API ilə əvəz olunur (bax: README.md).
 */

/* ------------------------------------------------------------------ *
 * 1. Fakültə → İxtisas ağacı
 * ------------------------------------------------------------------ */
const FACULTIES = {
  'Rəqəmsal Texnologiyalar Fakültəsi': [
    'Data analitikası',
    'Riyaziyyat',
    'Kompüter elmləri',
    'Kompüter mühəndisliyi',
    'İnformasiya texnologiyaları',
    'İnformasiya təhlükəsizliyi'
  ],
  'Yer Elmləri və Neft Mühəndisliyi Fakültəsi': [
    'Neft-qaz mühəndisliyi',
    'Geologiya və geofizika mühəndisliyi',
    'Mədən mühəndisliyi'
  ],
  'Kimya Texnologiyaları Fakültəsi': [
    'Kimya mühəndisliyi',
    'Qida mühəndisliyi',
    'Ekologiya mühəndisliyi',
    'Həyat fəaliyyətinin təhlükəsizliyi mühəndisliyi',
    'Kimya',
    'Biotexnologiya'
  ],
  'Sənaye Mühəndisliyi Fakültəsi': [
    'Radiotexnika və telekommunikasiya mühəndisliyi',
    'Proseslərin avtomatlaşdırılması mühəndisliyi',
    'Cihaz mühəndisliyi',
    'Mexatronika və robototexnika mühəndisliyi',
    'Materiallar mühəndisliyi',
    'Maşın mühəndisliyi',
    'Mexanika mühəndisliyi',
    'Sənaye mühəndisliyi'
  ],
  'Energetika Fakültəsi': [
    'Elektrik və elektronika mühəndisliyi',
    'Energetika mühəndisliyi',
    'Fizika'
  ],
  'Biznes və İdarəetmə Fakültəsi': [
    'Beynəlxalq ticarət və logistika',
    'Biznesin idarə edilməsi',
    'İqtisadiyyat',
    'Menecment',
    'Marketinq',
    'Logistika və nəqliyyat texnologiyaları mühəndisliyi'
  ]
};

/* İxtisas → sahə açarı. Müsahibə bankı və yol xəritəsi bunu istifadə edir. */
const MAJOR_FIELD = {
  'Data analitikası': 'it',
  'Riyaziyyat': 'it',
  'Kompüter elmləri': 'it',
  'Kompüter mühəndisliyi': 'it',
  'İnformasiya texnologiyaları': 'it',
  'İnformasiya təhlükəsizliyi': 'it',

  'Neft-qaz mühəndisliyi': 'geologiya',
  'Geologiya və geofizika mühəndisliyi': 'geologiya',
  'Mədən mühəndisliyi': 'geologiya',

  'Kimya mühəndisliyi': 'kimya',
  'Qida mühəndisliyi': 'kimya',
  'Ekologiya mühəndisliyi': 'kimya',
  'Həyat fəaliyyətinin təhlükəsizliyi mühəndisliyi': 'kimya',
  'Kimya': 'kimya',
  'Biotexnologiya': 'kimya',

  'Radiotexnika və telekommunikasiya mühəndisliyi': 'it',
  'Proseslərin avtomatlaşdırılması mühəndisliyi': 'it',
  'Cihaz mühəndisliyi': 'mexanika',
  'Mexatronika və robototexnika mühəndisliyi': 'mexanika',
  'Materiallar mühəndisliyi': 'mexanika',
  'Maşın mühəndisliyi': 'mexanika',
  'Mexanika mühəndisliyi': 'mexanika',
  'Sənaye mühəndisliyi': 'mexanika',

  'Elektrik və elektronika mühəndisliyi': 'energetika',
  'Energetika mühəndisliyi': 'energetika',
  'Fizika': 'energetika',

  'Beynəlxalq ticarət və logistika': 'iqtisadiyyat',
  'Biznesin idarə edilməsi': 'iqtisadiyyat',
  'İqtisadiyyat': 'iqtisadiyyat',
  'Menecment': 'iqtisadiyyat',
  'Marketinq': 'iqtisadiyyat',
  'Logistika və nəqliyyat texnologiyaları mühəndisliyi': 'iqtisadiyyat'
};

/* İxtisasa görə tövsiyə olunan bacarıqlar — profil doldurularkən təklif edilir. */
const SKILL_SUGGESTIONS = {
  mexanika: ['SolidWorks', 'AutoCAD', 'Mechanical Design', 'ANSYS', 'Maintenance', 'Welding', 'Quality Control', 'Reliability', 'Project Management', 'MATLAB'],
  kimya: ['Aspen HYSYS', 'Process Simulation', 'HAZOP', 'AutoCAD', 'Lab Analysis', 'Heat Exchangers', 'Instrumentation', 'Excel', 'Python'],
  geologiya: ['Petrel', 'Seismic Interpretation', 'Well Logging', 'Eclipse', 'Reservoir Simulation', 'ArcGIS', 'Geology', 'Drilling'],
  energetika: ['ETAP', 'Power Systems', 'SCADA', 'MATLAB', 'Renewable Energy', 'PLC', 'Electrical Design', 'Energy Audit'],
  it: ['Python', 'SQL', 'Linux', 'Networking', 'Power BI', 'JavaScript', 'PLC', 'SCADA', 'Network Security', 'SIEM', 'Git', 'Statistics'],
  iqtisadiyyat: ['Excel', 'IFRS', 'Financial Analysis', 'Power BI', 'SQL', 'Tax', 'CRM', 'Digital Marketing', 'Statistics']
};

const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Ana dili'];

/* ------------------------------------------------------------------ *
 * 2. Şirkətlər
 * ------------------------------------------------------------------ */
const COMPANIES = [
  { id: 'socar', name: 'SOCAR', sector: 'Neft və qaz', size: '50 000+', city: 'Bakı', about: 'Azərbaycan Respublikasının Dövlət Neft Şirkəti — hasilat, emal və kimya sənayesi.' },
  { id: 'bp', name: 'bp Azerbaijan', sector: 'Enerji', size: '2 500+', city: 'Bakı', about: 'Xəzər regionunda ACG və Şahdəniz layihələrinin operatoru.' },
  { id: 'halliburton', name: 'Halliburton', sector: 'Neft servisi', size: '1 000+', city: 'Bakı', about: 'Quyu servisi, qazma və hasilat texnologiyaları.' },
  { id: 'slb', name: 'SLB', sector: 'Neft servisi', size: '900+', city: 'Bakı', about: 'Rezervuar, qazma və hasilat üzrə texnologiya həlləri.' },
  { id: 'azerenerji', name: 'Azərenerji', sector: 'Energetika', size: '10 000+', city: 'Bakı', about: 'Elektrik enerjisinin istehsalı və ötürülməsi.' },
  { id: 'azerishiq', name: 'Azərişıq', sector: 'Energetika', size: '8 000+', city: 'Bakı', about: 'Elektrik enerjisinin paylanması və smart grid layihələri.' },
  { id: 'pasha-tech', name: 'PASHA Technology', sector: 'Texnologiya', size: '400+', city: 'Bakı', about: 'Maliyyə və korporativ sektor üçün rəqəmsal məhsullar.' },
  { id: 'azerconnect', name: 'Azerconnect Group', sector: 'Telekom', size: '1 200+', city: 'Bakı', about: 'Telekommunikasiya infrastrukturu və BPO xidmətləri.' },
  { id: 'kapital', name: 'Kapital Bank', sector: 'Bank', size: '5 000+', city: 'Bakı', about: 'Ölkənin ən böyük pərakəndə bank şəbəkəsi.' },
  { id: 'ey', name: 'EY Azerbaijan', sector: 'Konsaltinq', size: '200+', city: 'Bakı', about: 'Audit, vergi və biznes konsaltinqi xidmətləri.' },
  { id: 'pwc', name: 'PwC Azerbaijan', sector: 'Konsaltinq', size: '180+', city: 'Bakı', about: 'Audit, vergi-hüquq və əməliyyat konsaltinqi.' },
  { id: 'bosshelf', name: 'BOS Shelf', sector: 'Tikinti', size: '1 500+', city: 'Bakı', about: 'Dəniz platformalarının tikintisi və fabrikasiyası.' },
  { id: 'azercosmos', name: 'Azercosmos', sector: 'Kosmik sənaye', size: '250+', city: 'Bakı', about: 'Peyk rabitəsi və yer stansiyaları operatoru.' },
  { id: 'socar-polymer', name: 'SOCAR Polymer', sector: 'Kimya sənayesi', size: '600+', city: 'Sumqayıt', about: 'Polipropilen və yüksək sıxlıqlı polietilen istehsalı.' },
  { id: 'baku-steel', name: 'Baku Steel Company', sector: 'Metallurgiya', size: '2 000+', city: 'Bakı', about: 'Polad məmulatlarının istehsalı.' },
  { id: 'totalenergies', name: 'TotalEnergies', sector: 'Enerji', size: '500+', city: 'Bakı', about: 'Abşeron qaz layihəsi və bərpa olunan enerji investisiyaları.' },
  { id: 'bakcell', name: 'Bakcell', sector: 'Telekom', size: '1 000+', city: 'Bakı', about: 'Mobil rabitə operatoru.' },
  { id: 'abb', name: 'ABB Bank', sector: 'Bank', size: '3 000+', city: 'Bakı', about: 'Azərbaycan Beynəlxalq Bankı.' },
  { id: 'adnsu-cc', name: 'ADNSU Karyera Mərkəzi', sector: 'Universitet', size: '—', city: 'Bakı', about: 'Tələbə karyera dəstəyi, tədbirlər və könüllülük proqramları.' }
];

/* ------------------------------------------------------------------ *
 * 3. Elanlar
 *    faculties[] və majors[] — matching üçün hədəf auditoriya
 *    skills[]                — tələb olunan bacarıqlar (match-in 20 balı)
 *    status                  — 'approved' | 'pending' (Karyera Mərkəzi təsdiqi)
 * ------------------------------------------------------------------ */
const OPPORTUNITIES = [
  {
    id: 1, companyId: 'socar', title: 'Mechanical Engineering Intern', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-09-28', duration: '3 ay', pay: '600 AZN/ay',
    faculties: ['Sənaye Mühəndisliyi Fakültəsi'],
    majors: ['Mexanika mühəndisliyi', 'Neft-qaz mühəndisliyi'],
    skills: ['SolidWorks', 'AutoCAD', 'Mechanical Design'],
    minCourse: 3, minGPA: 71, status: 'approved', postedAt: '2026-09-01',
    summary: 'Hasilat avadanlıqlarının dizayn və etibarlılıq komandasında 3 aylıq təcrübə proqramı.',
    duties: ['Nasos və kompressorların texniki sənədləşməsi', 'SolidWorks-də hissə və yığım modelləri', 'Sahə ölçmələrində komandaya dəstək'],
    requirements: ['III–IV kurs tələbəsi', 'Texniki ingilis dili', 'Həftədə minimum 24 saat']
  },
  {
    id: 2, companyId: 'socar', title: 'Process Engineering Intern', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-10-02', duration: '3 ay', pay: '600 AZN/ay',
    faculties: ['Kimya Texnologiyaları Fakültəsi'],
    majors: ['Kimya mühəndisliyi', 'Kimya'],
    skills: ['Aspen HYSYS', 'Process Simulation', 'HAZOP'],
    minCourse: 3, minGPA: 71, status: 'approved', postedAt: '2026-09-02',
    summary: 'Emal zavodunda proses optimallaşdırma və material balansı üzrə təcrübə.',
    duties: ['Proses axın diaqramlarının yenilənməsi', 'HYSYS-də simulyasiya ssenariləri', 'HAZOP sessiyalarının protokollaşdırılması'],
    requirements: ['III–IV kurs tələbəsi', 'Proses simulyasiyası ilə tanışlıq', 'Texniki ingilis dili']
  },
  {
    id: 3, companyId: 'bp', title: 'Mechanical Engineering Graduate Programme', type: 'Graduate',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-10-05', duration: '24 ay', pay: 'Rəqabətli',
    faculties: ['Sənaye Mühəndisliyi Fakültəsi'],
    majors: ['Mexanika mühəndisliyi', 'Neft-qaz mühəndisliyi', 'Maşın mühəndisliyi'],
    skills: ['Mechanical Design', 'Project Management', 'English'],
    minCourse: 4, minGPA: 81, status: 'approved', postedAt: '2026-08-28',
    summary: 'Son kurs və məzunlar üçün 2 illik rotasiyalı mühəndis inkişaf proqramı.',
    duties: ['3 fərqli əməliyyat komandasında rotasiya', 'Beynəlxalq mentor proqramı', 'Texniki səlahiyyət portfelinin qurulması'],
    requirements: ['Məzun və ya son kurs', 'IELTS 6.5 və ya ekvivalent', 'GPA 81+']
  },
  {
    id: 4, companyId: 'bp', title: 'Subsurface Graduate Programme', type: 'Graduate',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-10-12', duration: '24 ay', pay: 'Rəqabətli',
    faculties: ['Yer Elmləri və Neft Mühəndisliyi Fakültəsi'],
    majors: ['Geologiya və geofizika mühəndisliyi', 'Mədən mühəndisliyi'],
    skills: ['Petrel', 'Seismic Interpretation', 'Geology'],
    minCourse: 4, minGPA: 81, status: 'approved', postedAt: '2026-08-30',
    summary: 'Rezervuar və geologiya komandalarında məzun inkişaf proqramı.',
    duties: ['Seysmik məlumatların interpretasiyası', 'Statik model qurulmasına dəstək', 'Quyu məlumatlarının analizi'],
    requirements: ['Məzun və ya son kurs', 'Petrel və ya ekvivalent proqram təcrübəsi', 'İngilis dili B2+']
  },
  {
    id: 5, companyId: 'halliburton', title: 'Field Engineer Intern', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı / Səngəçal', deadline: '2026-10-18', duration: '4 ay', pay: '750 AZN/ay',
    faculties: ['Sənaye Mühəndisliyi Fakültəsi', 'Yer Elmləri və Neft Mühəndisliyi Fakültəsi'],
    majors: ['Neft-qaz mühəndisliyi', 'Mexanika mühəndisliyi', 'Geologiya və geofizika mühəndisliyi'],
    skills: ['Drilling', 'Well Logging', 'Field Operations'],
    minCourse: 3, minGPA: 71, status: 'approved', postedAt: '2026-09-05',
    summary: 'Quyu servisi əməliyyatlarında sahə mühəndisi təcrübəsi.',
    duties: ['Quyu servisi əməliyyatlarının müşayiəti', 'Avadanlıq hazırlığı və kalibrləmə', 'Əməliyyat hesabatlarının hazırlanması'],
    requirements: ['Sahə şəraitində işləmə hazırlığı', 'HSE qaydalarına ciddi riayət', 'Sürücülük vəsiqəsi üstünlükdür']
  },
  {
    id: 6, companyId: 'slb', title: 'Reservoir Engineering Intern', type: 'Təcrübə',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-10-20', duration: '3 ay', pay: '800 AZN/ay',
    faculties: ['Yer Elmləri və Neft Mühəndisliyi Fakültəsi', 'Sənaye Mühəndisliyi Fakültəsi'],
    majors: ['Geologiya və geofizika mühəndisliyi', 'Neft-qaz mühəndisliyi'],
    skills: ['Eclipse', 'Reservoir Simulation', 'Petrel'],
    minCourse: 3, minGPA: 76, status: 'approved', postedAt: '2026-09-06',
    summary: 'Rezervuar modelləşdirmə komandasında simulyasiya təcrübəsi.',
    duties: ['Dinamik model ssenarilərinin işlədilməsi', 'Hasilat tarixçəsinin uyğunlaşdırılması', 'Nəticələrin vizuallaşdırılması'],
    requirements: ['Rezervuar mühəndisliyi fənləri', 'Eclipse və ya CMG ilə tanışlıq', 'İngilis dili B2+']
  },
  {
    id: 7, companyId: 'azerenerji', title: 'Elektrik şəbəkələri mühəndisi', type: 'İş',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-10-08', duration: 'Daimi', pay: '1 400–1 800 AZN',
    faculties: ['Energetika Fakültəsi'],
    majors: ['Elektrik və elektronika mühəndisliyi', 'Fizika'],
    skills: ['ETAP', 'Power Systems', 'SCADA'],
    minCourse: 4, minGPA: 71, status: 'approved', postedAt: '2026-09-03',
    summary: '110/35 kV yarımstansiyaların istismarı və rejim hesablamaları.',
    duties: ['Qısaqapanma və yük axını hesablamaları', 'Rele mühafizəsi parametrlərinin yoxlanması', 'Dispetçer qrupu ilə koordinasiya'],
    requirements: ['Elektroenergetika üzrə bakalavr', 'ETAP və ya DIgSILENT bilikləri', 'Növbəli iş rejiminə hazırlıq']
  },
  {
    id: 8, companyId: 'azerishiq', title: 'Smart Grid Intern', type: 'Təcrübə',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-11-02', duration: '3 ay', pay: '500 AZN/ay',
    faculties: ['Energetika Fakültəsi'],
    majors: ['Elektrik və elektronika mühəndisliyi', 'Energetika mühəndisliyi'],
    skills: ['SCADA', 'Power Systems', 'Data Analysis'],
    minCourse: 2, minGPA: 66, status: 'approved', postedAt: '2026-09-08',
    summary: 'Ağıllı sayğac və paylayıcı şəbəkə analitikası layihəsində təcrübə.',
    duties: ['Sayğac telemetriyasının analizi', 'İtki hesablamaları üçün hesabat panelləri', 'Sahə qruplarına texniki dəstək'],
    requirements: ['II kursdan yuxarı', 'Excel və ya Python ilə data analizi', 'Öyrənməyə həvəs']
  },
  {
    id: 9, companyId: 'pasha-tech', title: 'Junior Data Analyst', type: 'İş',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-09-30', duration: 'Daimi', pay: '1 200–1 600 AZN',
    faculties: ['Rəqəmsal Texnologiyalar Fakültəsi', 'Biznes və İdarəetmə Fakültəsi'],
    majors: ['Data analitikası', 'Kompüter mühəndisliyi', 'İqtisadiyyat'],
    skills: ['SQL', 'Python', 'Power BI'],
    minCourse: 4, minGPA: 71, status: 'approved', postedAt: '2026-08-29',
    summary: 'Maliyyə məhsulları üzrə hesabat və analitika komandası.',
    duties: ['SQL sorğuları ilə məlumat hazırlığı', 'Power BI panellərinin qurulması', 'Biznes komandaları üçün ad-hoc analizlər'],
    requirements: ['SQL üzrə praktik bilik', 'Python (pandas) üstünlükdür', 'Analitik düşüncə']
  },
  {
    id: 10, companyId: 'azerconnect', title: 'IT Internship Program', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-10-12', duration: '6 ay', pay: '450 AZN/ay',
    faculties: ['Rəqəmsal Texnologiyalar Fakültəsi'],
    majors: ['Kompüter mühəndisliyi', 'İnformasiya təhlükəsizliyi'],
    skills: ['Python', 'Linux', 'Networking'],
    minCourse: 2, minGPA: 66, status: 'approved', postedAt: '2026-09-04',
    summary: 'İnfrastruktur, DevOps və dəstək komandalarında rotasiyalı təcrübə.',
    duties: ['Linux serverlərin monitorinqi', 'Avtomatlaşdırma skriptləri', 'Şəbəkə konfiqurasiyalarının sənədləşdirilməsi'],
    requirements: ['II kursdan yuxarı', 'Linux əsasları', 'Komanda işi']
  },
  {
    id: 11, companyId: 'kapital', title: 'Cybersecurity Intern', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-10-25', duration: '4 ay', pay: '550 AZN/ay',
    faculties: ['Rəqəmsal Texnologiyalar Fakültəsi'],
    majors: ['İnformasiya təhlükəsizliyi', 'Kompüter mühəndisliyi'],
    skills: ['Network Security', 'SIEM', 'Linux'],
    minCourse: 3, minGPA: 71, status: 'approved', postedAt: '2026-09-07',
    summary: 'SOC komandasında hadisə monitorinqi və analiz təcrübəsi.',
    duties: ['SIEM hadisələrinin ilkin təhlili', 'Zəiflik skanlarının hesabatı', 'Təhlükəsizlik siyasətlərinin sənədləşməsi'],
    requirements: ['Şəbəkə protokolları biliyi', 'Linux komanda sətri', 'Məxfilik öhdəliyi']
  },
  {
    id: 12, companyId: 'ey', title: 'Assurance Intern', type: 'Təcrübə',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-10-20', duration: '3 ay', pay: '500 AZN/ay',
    faculties: ['Biznes və İdarəetmə Fakültəsi'],
    majors: ['Biznesin idarə edilməsi', 'İqtisadiyyat'],
    skills: ['Excel', 'IFRS', 'Financial Analysis'],
    minCourse: 3, minGPA: 76, status: 'approved', postedAt: '2026-09-01',
    summary: 'Audit komandasında maliyyə hesabatlarının yoxlanmasına dəstək.',
    duties: ['Audit sənədlərinin hazırlanması', 'Balans maddələrinin test edilməsi', 'Müştəri ilə ünsiyyətdə komandaya dəstək'],
    requirements: ['Mühasibat uçotu fənləri', 'Excel üzrə yaxşı bilik', 'İngilis dili B2+']
  },
  {
    id: 13, companyId: 'pwc', title: 'Tax & Legal Graduate Programme', type: 'Graduate',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-11-10', duration: '12 ay', pay: 'Rəqabətli',
    faculties: ['Biznes və İdarəetmə Fakültəsi'],
    majors: ['İqtisadiyyat', 'Biznesin idarə edilməsi', 'Menecment'],
    skills: ['Excel', 'Tax', 'English'],
    minCourse: 4, minGPA: 81, status: 'approved', postedAt: '2026-09-09',
    summary: 'Vergi və hüquq departamentində struktur məzun proqramı.',
    duties: ['Vergi hesabatlarının hazırlanmasına dəstək', 'Qanunvericilik dəyişikliklərinin izlənməsi', 'Müştəri memorandumlarının tərtibi'],
    requirements: ['Məzun və ya son kurs', 'Analitik yazı bacarığı', 'İngilis dili C1']
  },
  {
    id: 14, companyId: 'bosshelf', title: 'Welding & Fabrication Intern', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı (Bibiheybət)', deadline: '2026-10-15', duration: '3 ay', pay: '550 AZN/ay',
    faculties: ['Sənaye Mühəndisliyi Fakültəsi'],
    majors: ['Maşın mühəndisliyi', 'Mexanika mühəndisliyi'],
    skills: ['Welding', 'AutoCAD', 'Quality Control'],
    minCourse: 3, minGPA: 66, status: 'approved', postedAt: '2026-09-05',
    summary: 'Dəniz platforma bloklarının fabrikasiya sahəsində təcrübə.',
    duties: ['Qaynaq prosedurlarının izlənməsi', 'NDT nəticələrinin sənədləşməsi', 'Montaj çertyojlarının yoxlanması'],
    requirements: ['Materialşünaslıq bilikləri', 'Sahədə iş hazırlığı', 'HSE mədəniyyəti']
  },
  {
    id: 15, companyId: 'azercosmos', title: 'Ground Systems Engineer', type: 'İş',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-11-05', duration: 'Daimi', pay: '1 500–2 000 AZN',
    faculties: ['Rəqəmsal Texnologiyalar Fakültəsi', 'Energetika Fakültəsi'],
    majors: ['Kompüter mühəndisliyi', 'Proseslərin avtomatlaşdırılması mühəndisliyi', 'Elektrik və elektronika mühəndisliyi'],
    skills: ['Linux', 'Networking', 'Python'],
    minCourse: 4, minGPA: 76, status: 'approved', postedAt: '2026-09-10',
    summary: 'Yer stansiyalarının istismarı və monitorinq sistemləri.',
    duties: ['Yer seqmenti avadanlığının monitorinqi', 'Avtomatlaşdırma skriptlərinin yazılması', 'Növbəli dəstək'],
    requirements: ['Linux administrasiyası', 'Şəbəkə bilikləri', 'Növbəli iş rejimi']
  },
  {
    id: 16, companyId: 'socar-polymer', title: 'Process Automation Intern', type: 'Təcrübə',
    mode: 'Əyani', location: 'Sumqayıt', deadline: '2026-10-30', duration: '3 ay', pay: '600 AZN/ay',
    faculties: ['Rəqəmsal Texnologiyalar Fakültəsi', 'Kimya Texnologiyaları Fakültəsi'],
    majors: ['Proseslərin avtomatlaşdırılması mühəndisliyi', 'Kimya mühəndisliyi'],
    skills: ['PLC', 'SCADA', 'Instrumentation'],
    minCourse: 3, minGPA: 71, status: 'approved', postedAt: '2026-09-11',
    summary: 'Polimer istehsalı xəttində avtomatlaşdırma və ölçmə sistemləri.',
    duties: ['PLC proqramlarının test edilməsi', 'Sahə cihazlarının kalibrləməsi', 'Alarm siyahılarının optimallaşdırılması'],
    requirements: ['PLC/SCADA əsasları', 'Sumqayıta gediş imkanı', 'Texniki ingilis dili']
  },
  {
    id: 17, companyId: 'baku-steel', title: 'Mechanical Maintenance Engineer', type: 'İş',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-10-22', duration: 'Daimi', pay: '1 300–1 700 AZN',
    faculties: ['Sənaye Mühəndisliyi Fakültəsi'],
    majors: ['Mexanika mühəndisliyi', 'Maşın mühəndisliyi', 'Sənaye mühəndisliyi'],
    skills: ['Maintenance', 'SolidWorks', 'Reliability'],
    minCourse: 4, minGPA: 66, status: 'approved', postedAt: '2026-09-02',
    summary: 'Prokat sexində planlı və qəza təmirlərinin idarə olunması.',
    duties: ['Profilaktik təmir qrafikinin hazırlanması', 'Nasazlıq kök səbəb analizi', 'Ehtiyat hissə planlaması'],
    requirements: ['Mexanika üzrə bakalavr', 'CMMS sistemləri ilə tanışlıq', 'Növbəli iş']
  },
  {
    id: 18, companyId: 'totalenergies', title: 'Renewables Graduate Programme', type: 'Graduate',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-11-15', duration: '18 ay', pay: 'Rəqabətli',
    faculties: ['Energetika Fakültəsi'],
    majors: ['Energetika mühəndisliyi', 'Elektrik və elektronika mühəndisliyi'],
    skills: ['Renewable Energy', 'Project Management', 'English'],
    minCourse: 4, minGPA: 81, status: 'approved', postedAt: '2026-09-12',
    summary: 'Külək və günəş layihələri üzrə məzun inkişaf proqramı.',
    duties: ['Layihə fizibilite hesablamaları', 'Enerji istehsalı proqnozları', 'Podratçı koordinasiyası'],
    requirements: ['Məzun və ya son kurs', 'İngilis dili C1', 'Layihə idarəetməsinə maraq']
  },
  {
    id: 19, companyId: 'abb', title: 'Risk Analytics Intern', type: 'Təcrübə',
    mode: 'Hibrid', location: 'Bakı', deadline: '2026-10-28', duration: '4 ay', pay: '500 AZN/ay',
    faculties: ['Biznes və İdarəetmə Fakültəsi', 'Rəqəmsal Texnologiyalar Fakültəsi'],
    majors: ['İqtisadiyyat', 'Data analitikası'],
    skills: ['SQL', 'Excel', 'Statistics'],
    minCourse: 3, minGPA: 71, status: 'approved', postedAt: '2026-09-08',
    summary: 'Kredit riski modelləri və portfel hesabatları komandası.',
    duties: ['Portfel keyfiyyət hesabatları', 'Skorinq modellərinin validasiyası', 'Data keyfiyyət yoxlamaları'],
    requirements: ['Statistika bilikləri', 'SQL və ya Excel üzrə praktika', 'Dəqiqlik']
  },
  {
    id: 20, companyId: 'bakcell', title: 'Network Engineering Intern', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-11-08', duration: '3 ay', pay: '450 AZN/ay',
    faculties: ['Rəqəmsal Texnologiyalar Fakültəsi'],
    majors: ['Kompüter mühəndisliyi', 'İnformasiya təhlükəsizliyi'],
    skills: ['Networking', 'Linux', 'Python'],
    minCourse: 2, minGPA: 66, status: 'approved', postedAt: '2026-09-13',
    summary: 'Radio və nüvə şəbəkəsi komandalarında texniki təcrübə.',
    duties: ['Şəbəkə performans göstəricilərinin analizi', 'Baza stansiyalarının monitorinqi', 'Hesabat avtomatlaşdırması'],
    requirements: ['Şəbəkə əsasları', 'Python ilə skript yazma', 'Komanda işi']
  },
  {
    id: 21, companyId: 'adnsu-cc', title: 'Career Fair Volunteer', type: 'Könüllülük',
    mode: 'Əyani', location: 'ADNSU əsas korpus', deadline: '2026-10-10', duration: '2 həftə', pay: 'Sertifikat',
    faculties: Object.keys(FACULTIES),
    majors: [],
    skills: ['Communication', 'Event Management', 'Teamwork'],
    minCourse: 1, minGPA: 0, status: 'approved', postedAt: '2026-09-01',
    summary: 'Career & Innovation Fair 2026 tədbirində şirkət stendlərinin koordinasiyası.',
    duties: ['Şirkət nümayəndələrinin qarşılanması', 'Tələbə axınının idarə olunması', 'Tədbir sonrası geri bildirim toplanması'],
    requirements: ['Bütün kurslar', 'Ünsiyyət bacarığı', 'Tədbir günlərində sərbəst vaxt']
  },
  {
    id: 22, companyId: 'adnsu-cc', title: 'Tələbə Elmi Cəmiyyəti — Araşdırma Köməkçisi', type: 'Könüllülük',
    mode: 'Hibrid', location: 'ADNSU', deadline: '2026-10-05', duration: '1 semestr', pay: 'Sertifikat',
    faculties: Object.keys(FACULTIES),
    majors: [],
    skills: ['Research', 'Data Analysis', 'Academic Writing'],
    minCourse: 2, minGPA: 71, status: 'approved', postedAt: '2026-09-03',
    summary: 'Kafedra layihələrində ədəbiyyat icmalı və məlumat emalı.',
    duties: ['Elmi məqalələrin icmalı', 'Eksperiment məlumatlarının emalı', 'Konfrans tezislərinin hazırlanması'],
    requirements: ['Akademik maraq', 'Excel və ya Python', 'İngilis dilində oxu bacarığı']
  },
  /* Karyera Mərkəzinin təsdiqini gözləyən elanlar (admin demo) */
  {
    id: 23, companyId: 'halliburton', title: 'HSE Coordinator Trainee', type: 'Təcrübə',
    mode: 'Əyani', location: 'Bakı', deadline: '2026-11-20', duration: '6 ay', pay: '700 AZN/ay',
    faculties: ['Kimya Texnologiyaları Fakültəsi', 'Sənaye Mühəndisliyi Fakültəsi'],
    majors: ['Ekologiya mühəndisliyi', 'Sənaye mühəndisliyi'],
    skills: ['HSE', 'Risk Assessment', 'Reporting'],
    minCourse: 3, minGPA: 71, status: 'pending', postedAt: '2026-09-14',
    summary: 'Əməyin təhlükəsizliyi və ətraf mühit komandasında trainee vəzifəsi.',
    duties: ['Risk qiymətləndirmə sənədləri', 'Sahə auditlərində iştirak', 'Təlim materiallarının hazırlanması'],
    requirements: ['Ekologiya və ya sənaye mühəndisliyi', 'NEBOSH üstünlükdür', 'İngilis dili B2']
  },
  {
    id: 24, companyId: 'pasha-tech', title: 'Frontend Developer (Junior)', type: 'İş',
    mode: 'Uzaqdan', location: 'Bakı', deadline: '2026-11-25', duration: 'Daimi', pay: '1 100–1 500 AZN',
    faculties: ['Rəqəmsal Texnologiyalar Fakültəsi'],
    majors: ['Kompüter mühəndisliyi', 'Data analitikası'],
    skills: ['JavaScript', 'React', 'Git'],
    minCourse: 3, minGPA: 66, status: 'pending', postedAt: '2026-09-14',
    summary: 'Daxili məhsul komandasında interfeys inkişafı.',
    duties: ['React komponentlərinin hazırlanması', 'Dizayn sistemi ilə işləmə', 'Kod nəzərdən keçirmə'],
    requirements: ['JavaScript üzrə praktik bilik', 'Git iş axını', 'Portfel və ya GitHub']
  }
];

/* ------------------------------------------------------------------ *
 * 4. Tələbə hovuzu — şirkət kabinetindəki namizəd axtarışı üçün
 * ------------------------------------------------------------------ */
const STUDENT_POOL = [
  { id: 's1', name: 'Aylin Məmmədova', faculty: 'Kimya Texnologiyaları Fakültəsi', major: 'Kimya mühəndisliyi', course: 3, gpa: 88, skills: ['Aspen HYSYS', 'Process Simulation', 'AutoCAD', 'Excel', 'Python'], languages: 'Azərbaycan (Ana dili), İngilis (B2), Rus (B1)' },
  { id: 's2', name: 'Rəşad Quliyev', faculty: 'Sənaye Mühəndisliyi Fakültəsi', major: 'Mexanika mühəndisliyi', course: 4, gpa: 84, skills: ['SolidWorks', 'AutoCAD', 'Mechanical Design', 'ANSYS'], languages: 'Azərbaycan (Ana dili), İngilis (B2)' },
  { id: 's3', name: 'Nigar Həsənli', faculty: 'Rəqəmsal Texnologiyalar Fakültəsi', major: 'Data analitikası', course: 4, gpa: 92, skills: ['Python', 'SQL', 'Power BI', 'Statistics', 'Git'], languages: 'Azərbaycan (Ana dili), İngilis (C1)' },
  { id: 's4', name: 'Elvin Bağırov', faculty: 'Yer Elmləri və Neft Mühəndisliyi Fakültəsi', major: 'Geologiya və geofizika mühəndisliyi', course: 4, gpa: 79, skills: ['Petrel', 'Seismic Interpretation', 'Geology', 'Well Logging'], languages: 'Azərbaycan (Ana dili), İngilis (B2), Rus (B2)' },
  { id: 's5', name: 'Günel Səfərova', faculty: 'Energetika Fakültəsi', major: 'Elektrik və elektronika mühəndisliyi', course: 3, gpa: 86, skills: ['ETAP', 'Power Systems', 'MATLAB', 'SCADA'], languages: 'Azərbaycan (Ana dili), İngilis (B2)' },
  { id: 's6', name: 'Tural Abbasov', faculty: 'Biznes və İdarəetmə Fakültəsi', major: 'İqtisadiyyat', course: 4, gpa: 81, skills: ['Excel', 'Financial Analysis', 'SQL', 'IFRS'], languages: 'Azərbaycan (Ana dili), İngilis (C1)' },
  { id: 's7', name: 'Leyla Əliyeva', faculty: 'Rəqəmsal Texnologiyalar Fakültəsi', major: 'İnformasiya təhlükəsizliyi', course: 3, gpa: 90, skills: ['Linux', 'Network Security', 'Python', 'SIEM'], languages: 'Azərbaycan (Ana dili), İngilis (B2)' },
  { id: 's8', name: 'Kamran İsmayılov', faculty: 'Sənaye Mühəndisliyi Fakültəsi', major: 'Neft-qaz mühəndisliyi', course: 4, gpa: 77, skills: ['Drilling', 'Well Logging', 'AutoCAD', 'Field Operations'], languages: 'Azərbaycan (Ana dili), İngilis (B1)' },
  { id: 's9', name: 'Səbinə Rzayeva', faculty: 'Kimya Texnologiyaları Fakültəsi', major: 'Ekologiya mühəndisliyi', course: 3, gpa: 83, skills: ['HSE', 'Risk Assessment', 'Lab Analysis', 'Excel'], languages: 'Azərbaycan (Ana dili), İngilis (B2)' },
  { id: 's10', name: 'Orxan Nəbiyev', faculty: 'Rəqəmsal Texnologiyalar Fakültəsi', major: 'Proseslərin avtomatlaşdırılması mühəndisliyi', course: 4, gpa: 85, skills: ['PLC', 'SCADA', 'Instrumentation', 'Python'], languages: 'Azərbaycan (Ana dili), İngilis (B2)' },
  { id: 's11', name: 'Fidan Cəfərova', faculty: 'Biznes və İdarəetmə Fakültəsi', major: 'Marketinq', course: 2, gpa: 76, skills: ['Digital Marketing', 'Excel', 'CRM', 'Communication'], languages: 'Azərbaycan (Ana dili), İngilis (B2), Türk (C1)' },
  { id: 's12', name: 'Cavid Məhərrəmov', faculty: 'Energetika Fakültəsi', major: 'Energetika mühəndisliyi', course: 4, gpa: 89, skills: ['Renewable Energy', 'MATLAB', 'Power Systems', 'Project Management'], languages: 'Azərbaycan (Ana dili), İngilis (C1)' }
];

/* ------------------------------------------------------------------ *
 * 5. Tədbirlər
 * ------------------------------------------------------------------ */
const EVENTS = [
  { id: 'e1', title: 'ADNSU Career & Innovation Fair 2026', date: '2026-10-24', time: '10:00–16:00', place: 'ADNSU əsas korpus', type: 'Karyera yarmarkası', seats: 800, registered: 512 },
  { id: 'e2', title: 'SOCAR İnfosessiya: Təcrübə proqramına necə düşmək olar', date: '2026-09-26', time: '14:00–16:00', place: 'Akt zalı', type: 'İnfosessiya', seats: 200, registered: 178 },
  { id: 'e3', title: 'Mock Interview Marathon — Mühəndislik', date: '2026-10-03', time: '10:00–17:00', place: 'Karyera Mərkəzi', type: 'Mock interview', seats: 60, registered: 60 },
  { id: 'e4', title: 'CV və LinkedIn emalatxanası', date: '2026-10-09', time: '15:00–17:00', place: 'Onlayn', type: 'Emalatxana', seats: 300, registered: 141 },
  { id: 'e5', title: 'bp Graduate Programme — Assessment Centre təlimi', date: '2026-11-07', time: '11:00–15:00', place: 'Karyera Mərkəzi', type: 'Təlim', seats: 80, registered: 34 }
];

/* ------------------------------------------------------------------ *
 * 6. Müsahibə sual bankı
 * ------------------------------------------------------------------ */
const INTERVIEW_BANK = {
  hr: [
    { q: 'Özünüz haqqında danışın.', hint: 'Təhsil → əsas layihə → bu vəzifəyə niyə uyğunsunuz. 90 saniyə.' },
    { q: 'Niyə məhz bu şirkətdə işləmək istəyirsiniz?', hint: 'Şirkətin konkret layihəsini və öz ixtisasınızla əlaqəni adlandırın.' },
    { q: 'Növbəti 3 ildə özünüzü harada görürsünüz?', hint: 'Texniki səlahiyyət → məsuliyyət artımı. Vəzifə adı yox, bacarıq adlandırın.' },
    { q: 'Güclü və zəif tərəfləriniz nələrdir?', hint: 'Zəif tərəf üçün konkret düzəliş addımı deyin.' },
    { q: 'Təhsil dövründə ən çətin fənn hansı oldu və necə öhdəsindən gəldiniz?', hint: 'Problem → metod → nəticə.' },
    { q: 'Əmək haqqı gözləntiniz nədir?', hint: 'Bazar aralığı adlandırın, təcrübə səviyyənizi əsas gətirin.' }
  ],
  behavioral: [
    { q: 'Komandada konflikt yaşamısınızsa, necə həll etmisiniz?', hint: 'STAR: Situasiya → Tapşırıq → Addım → Nəticə.' },
    { q: 'Son anda dəyişən tələblə üzləşdiyiniz layihəni danışın.', hint: 'Prioritetləri necə yenidən sıraladığınızı göstərin.' },
    { q: 'Səhv etdiyiniz və onu düzəltdiyiniz bir hadisəni danışın.', hint: 'Məsuliyyəti öz üzərinizə götürün, nəticəni rəqəmlə deyin.' },
    { q: 'Eyni anda bir neçə tapşırığı necə prioritetləşdirirsiniz?', hint: 'Konkret metod adlandırın (təsir/təcililik, deadline zənciri).' },
    { q: 'Komanda yoldaşınızı hansı halda inandıra bilmisiniz?', hint: 'Arqumentin məlumatla necə dəstəkləndiyini göstərin.' }
  ],
  english: [
    { q: 'Introduce yourself in English.', hint: 'Keep it under 90 seconds: education, one project, one strength.' },
    { q: 'Describe a technical problem you solved, in English.', hint: 'Use simple, precise sentences. Name the tool and the result.' },
    { q: 'Why should we choose you for this programme?', hint: 'Connect one concrete skill to one concrete company need.' }
  ],
  mexanika: [
    { q: 'Sentrifuqal nasos necə işləyir? Əsas hissələrini sadalayın.', hint: 'İşçi çarx, korpus, val, sızdırmazlıq. Enerji çevrilməsini izah edin.' },
    { q: 'Kavitasiya nədir və necə qarşısı alınır?', hint: 'NPSH available > NPSH required. Səbəb və nəticələr.' },
    { q: 'Əks klapan hansı məqsədlə istifadə olunur?', hint: 'Geri axının qarşısının alınması, nasos mühafizəsi, su zərbəsi.' },
    { q: 'Gərginlik konsentrasiyası nədir? Dizaynda necə azaldılır?', hint: 'Kəskin künclər, radius, yumşaq keçidlər.' },
    { q: 'Bearing nasazlığının erkən əlamətləri hansılardır?', hint: 'Vibrasiya spektri, temperatur artımı, səs.' },
    { q: 'Planlı təmir (PM) ilə etibarlılığa əsaslanan təmirin (RCM) fərqi nədir?', hint: 'Vaxta görə vs. kritiklik və nasazlıq rejiminə görə.' }
  ],
  kimya: [
    { q: 'Distillə kolonunda flooding nədir və nədən yaranır?', hint: 'Buxar sürəti, maye yükü, nimçə dizaynı.' },
    { q: 'HAZOP nədir? Guide word nümunələri verin.', hint: 'No, More, Less, Reverse, Part of — sapma analizi.' },
    { q: 'İstilik dəyişdiricisində fouling nəyə səbəb olur?', hint: 'İstilik ötürmə əmsalının düşməsi, təzyiq itkisi.' },
    { q: 'Material balansı ilə enerji balansının fərqi nədir?', hint: 'Kütlə saxlanması vs. entalpiya axını.' },
    { q: 'Təhlükəsizlik klapanı hansı prinsiplə seçilir?', hint: 'Set təzyiq, relieving ssenarisi, API 520.' }
  ],
  geologiya: [
    { q: 'Rezervuarın məsaməliliyi və keçiriciliyi arasında fərq nədir?', hint: 'Saxlama həcmi vs. axın qabiliyyəti.' },
    { q: 'Seysmik interpretasiyada horizon picking necə aparılır?', hint: 'Reflektor davamlılığı, quyu ilə bağlama (well tie).' },
    { q: 'Well logging-də gamma ray karotajı nə göstərir?', hint: 'Gil tərkibi, litologiya ayrımı.' },
    { q: 'Hasilatın tarixçə uyğunlaşdırılması (history matching) nədir?', hint: 'Model parametrlərinin real hasilat datasına kalibrlənməsi.' },
    { q: 'Tələ (trap) növlərini sadalayın.', hint: 'Struktur, stratiqrafik, qarışıq.' }
  ],
  energetika: [
    { q: 'Yük axını (load flow) hesablamasının məqsədi nədir?', hint: 'Gərginlik profili, itkilər, yüklənmə.' },
    { q: 'Rele mühafizəsində selektivlik nə deməkdir?', hint: 'Yalnız zədə nöqtəsinə ən yaxın açarın işləməsi.' },
    { q: 'Güc əmsalının (cos φ) aşağı olması nəyə səbəb olur?', hint: 'Reaktiv yük, itkilər, cərimə tarifləri.' },
    { q: 'SCADA sistemi hansı təbəqələrdən ibarətdir?', hint: 'Sahə cihazları, RTU/PLC, rabitə, HMI/server.' },
    { q: 'Külək turbinində capacity factor nədir?', hint: 'Faktiki istehsal / nominal gücdə mümkün istehsal.' }
  ],
  it: [
    { q: 'SQL-də INNER JOIN ilə LEFT JOIN arasında fərq nədir?', hint: 'Uyğunsuz sətirlərin taleyi. Nümunə ilə izah edin.' },
    { q: 'İndeks sorğunu necə sürətləndirir? Nə vaxt zərərlidir?', hint: 'Axtarış vs. yazma xərci, selektivlik.' },
    { q: 'TCP ilə UDP-nin fərqi nədir?', hint: 'Bağlantı, sıra, təkrar göndərmə, sürət.' },
    { q: 'PLC-də scan cycle necə işləyir?', hint: 'Giriş oxu → proqram icrası → çıxış yazma.' },
    { q: 'Simmetrik və asimmetrik şifrələmə arasındakı fərq nədir?', hint: 'Açar paylaşımı problemi, sürət fərqi.' },
    { q: 'Git-də merge ilə rebase arasında nə fərq var?', hint: 'Tarixçənin forması, konflikt idarəsi.' }
  ],
  iqtisadiyyat: [
    { q: 'Mənfəət və pul axını arasındakı fərq nədir?', hint: 'Hesablama metodu vs. faktiki nağd hərəkət.' },
    { q: 'IFRS 15 gəlirin tanınmasını necə tənzimləyir?', hint: 'Beş addımlı model.' },
    { q: 'NPV və IRR göstəricilərini müqayisə edin.', hint: 'Diskont dərəcəsi, layihə müqayisəsi məhdudiyyətləri.' },
    { q: 'Working capital dövriyyəsi niyə vacibdir?', hint: 'Likvidlik, əməliyyat dövrü.' },
    { q: 'Audit riski nədir və komponentləri hansılardır?', hint: 'Xas risk, nəzarət riski, aşkarlama riski.' }
  ]
};

/* ------------------------------------------------------------------ *
 * 7. Karyera yol xəritəsi şablonları
 * ------------------------------------------------------------------ */
const ROADMAP_TEMPLATES = {
  mexanika: {
    goal: 'Sahə/dizayn mühəndisi → Senior mühəndis',
    stages: [
      { term: 'I–II kurs', focus: 'Baza', skills: ['AutoCAD', 'Texniki rəsm', 'MATLAB əsasları'], actions: ['Tələbə Elmi Cəmiyyətinə qoşul', 'Zavod ekskursiyalarında iştirak et'], certs: ['AutoCAD sertifikatı'] },
      { term: 'III kurs', focus: 'İxtisaslaşma', skills: ['SolidWorks', 'Mechanical Design', 'Materialşünaslıq'], actions: ['Yay təcrübəsinə müraciət et', 'Kurs layihəsini portfelə çevir'], certs: ['SolidWorks CSWA'] },
      { term: 'IV kurs', focus: 'Sənaye təcrübəsi', skills: ['ANSYS', 'Maintenance', 'HSE'], actions: ['Graduate proqramlarına erkən müraciət', 'Diplom işini real sənaye problemi üzərində qur'], certs: ['NEBOSH IGC (opsional)'] },
      { term: 'Məzuniyyətdən sonra', focus: 'Karyera girişi', skills: ['Reliability', 'Project Management', 'Technical English'], actions: ['Graduate proqramı və ya sahə mühəndisliyi', 'Peşəkar assosiasiyaya üzvlük (ASME)'], certs: ['PMP yolu (3+ il sonra)'] }
    ]
  },
  kimya: {
    goal: 'Proses mühəndisi → Proses lideri',
    stages: [
      { term: 'I–II kurs', focus: 'Baza', skills: ['Kimya texnologiyası', 'Excel', 'Laboratoriya təcrübəsi'], actions: ['Laboratoriya işlərini sənədləşdir', 'Kimya olimpiadalarında iştirak'], certs: [] },
      { term: 'III kurs', focus: 'Simulyasiya', skills: ['Aspen HYSYS', 'Process Simulation', 'Heat Exchangers'], actions: ['Emal zavodunda yay təcrübəsi', 'HYSYS üzrə onlayn kurs'], certs: ['AspenTech Process Simulation'] },
      { term: 'IV kurs', focus: 'Təhlükəsizlik və optimallaşdırma', skills: ['HAZOP', 'Instrumentation', 'Six Sigma əsasları'], actions: ['Diplom işini enerji optimallaşdırması üzərində qur', 'Graduate proqramlarına müraciət'], certs: ['Six Sigma Yellow Belt'] },
      { term: 'Məzuniyyətdən sonra', focus: 'Sənaye', skills: ['Plant Operations', 'Root Cause Analysis', 'Technical English'], actions: ['Proses mühəndisi vəzifəsi', 'Sənaye konfranslarında məruzə'], certs: ['NEBOSH / IChemE yolu'] }
    ]
  },
  geologiya: {
    goal: 'Geoloq / Rezervuar mühəndisi',
    stages: [
      { term: 'I–II kurs', focus: 'Baza', skills: ['Ümumi geologiya', 'ArcGIS', 'Sahə praktikası'], actions: ['Yay sahə praktikasını ciddi qeydlə', 'Nümunə kolleksiyası qur'], certs: [] },
      { term: 'III kurs', focus: 'Rəqəmsal alətlər', skills: ['Petrel', 'Well Logging', 'Seismic Interpretation'], actions: ['Servis şirkətlərində təcrübə', 'SPE tələbə bölməsinə qoşul'], certs: ['Petrel Fundamentals'] },
      { term: 'IV kurs', focus: 'Modelləşdirmə', skills: ['Eclipse', 'Reservoir Simulation', 'Data Analysis'], actions: ['Subsurface graduate proqramlarına müraciət', 'Diplom işində real quyu datası istifadə et'], certs: ['SPE üzvlüyü'] },
      { term: 'Məzuniyyətdən sonra', focus: 'Sahə/ofis', skills: ['Integrated Modelling', 'Technical English', 'Uncertainty Analysis'], actions: ['Graduate proqramı', 'Magistratura (opsional)'], certs: [] }
    ]
  },
  energetika: {
    goal: 'Elektrik mühəndisi → Şəbəkə/layihə mühəndisi',
    stages: [
      { term: 'I–II kurs', focus: 'Baza', skills: ['Elektrotexnika', 'MATLAB', 'AutoCAD Electrical'], actions: ['Yarımstansiya ekskursiyaları', 'Robototexnika klubuna qoşul'], certs: [] },
      { term: 'III kurs', focus: 'Sistem analizi', skills: ['ETAP', 'Power Systems', 'Rele mühafizəsi'], actions: ['Azərenerji/Azərişıqda təcrübə', 'Kurs layihəsində real şəbəkə modeli'], certs: ['ETAP təlimi'] },
      { term: 'IV kurs', focus: 'Avtomatlaşdırma', skills: ['SCADA', 'PLC', 'Energy Audit'], actions: ['Diplom işini enerji səmərəliliyi üzərində qur', 'Graduate proqramlarına müraciət'], certs: ['Certified Energy Manager yolu'] },
      { term: 'Məzuniyyətdən sonra', focus: 'Peşəkarlıq', skills: ['Renewable Energy', 'Project Management', 'Technical English'], actions: ['Şəbəkə və ya bərpa olunan enerji layihələri', 'IEEE üzvlüyü'], certs: ['PMP yolu'] }
    ]
  },
  it: {
    goal: 'Junior mütəxəssis → Senior mühəndis',
    stages: [
      { term: 'I–II kurs', focus: 'Baza', skills: ['Python', 'Git', 'Linux'], actions: ['GitHub profili yarat', 'Hər semestr 1 pet-layihə'], certs: [] },
      { term: 'III kurs', focus: 'İxtisaslaşma', skills: ['SQL', 'Networking', 'JavaScript'], actions: ['IT təcrübə proqramlarına müraciət', 'Hackathonlarda iştirak'], certs: ['CCNA / AZ-900 / Google Data Analytics'] },
      { term: 'IV kurs', focus: 'Peşəkar portfel', skills: ['Power BI', 'Network Security', 'Statistics'], actions: ['Komanda layihəsinə töhfə', 'Diplom işini işlək məhsula çevir'], certs: ['CompTIA Security+ / Power BI PL-300'] },
      { term: 'Məzuniyyətdən sonra', focus: 'Karyera girişi', skills: ['System Design', 'Code Review', 'Technical English'], actions: ['Junior vəzifə + mentor', 'Texniki bloq və ya məruzə'], certs: [] }
    ]
  },
  iqtisadiyyat: {
    goal: 'Analitik → Maliyyə/biznes mütəxəssisi',
    stages: [
      { term: 'I–II kurs', focus: 'Baza', skills: ['Excel', 'Mühasibat əsasları', 'Statistika'], actions: ['Tələbə biznes klubuna qoşul', 'Case yarışlarında iştirak'], certs: [] },
      { term: 'III kurs', focus: 'Analitika', skills: ['SQL', 'Financial Analysis', 'Power BI'], actions: ['Bank və ya audit təcrübəsinə müraciət', 'Şəxsi maliyyə modeli qur'], certs: ['ACCA F-səviyyə başlanğıcı'] },
      { term: 'IV kurs', focus: 'Peşəkarlaşma', skills: ['IFRS', 'Tax', 'Valuation'], actions: ['Graduate proqramlarına müraciət', 'Diplom işini real şirkət datası ilə yaz'], certs: ['ACCA / CFA Level I yolu'] },
      { term: 'Məzuniyyətdən sonra', focus: 'Karyera girişi', skills: ['Modelling', 'Stakeholder Communication', 'Business English'], actions: ['Audit/maliyyə analitikası vəzifəsi', 'Peşəkar sertifikatı tamamla'], certs: ['ACCA / CFA'] }
    ]
  }
};

/* Rahat axtarış üçün köməkçi indekslər */
const COMPANY_BY_ID = COMPANIES.reduce((acc, c) => (acc[c.id] = c, acc), {});
const ALL_MAJORS = Object.values(FACULTIES).flat();
const ALL_SKILLS = [...new Set(OPPORTUNITIES.flatMap(o => o.skills).concat(Object.values(SKILL_SUGGESTIONS).flat()))].sort();
