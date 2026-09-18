import type { AdminRow, ResourceKey } from './types';

export const demoData: Record<ResourceKey, AdminRow[]> = {
  jobs: [
    {id:'j1',title:'Mechanical Engineering Intern',subtitle:'SOCAR · Təcrübə',status:'Aktiv',meta:'Son tarix: 28 Sen 2026',updatedAt:'18 Sen, 14:32'},
    {id:'j2',title:'Junior Data Analyst',subtitle:'PASHA Technology · İş',status:'Aktiv',meta:'64 müraciət',updatedAt:'18 Sen, 12:05'},
    {id:'j3',title:'Career Fair Volunteer',subtitle:'ADNSU Karyera Mərkəzi',status:'Qaralama',meta:'Yayımlanmayıb',updatedAt:'17 Sen, 17:48'}
  ],
  companies: [
    {id:'c1',title:'SOCAR',subtitle:'Enerji · Təsdiqlənmiş tərəfdaş',status:'Aktiv',meta:'4 aktiv elan',updatedAt:'18 Sen, 10:14'},
    {id:'c2',title:'bp Azerbaijan',subtitle:'Enerji · Təsdiqlənmiş tərəfdaş',status:'Aktiv',meta:'2 aktiv elan',updatedAt:'16 Sen, 16:20'},
    {id:'c3',title:'Azerconnect Group',subtitle:'Telekom',status:'Yoxlamada',meta:'Profil təsdiqi gözləyir',updatedAt:'15 Sen, 11:02'}
  ],
  events: [
    {id:'e1',title:'SOCAR İnfosessiya',subtitle:'26 Sen 2026 · Akt zalı',status:'Aktiv',meta:'184 qeydiyyat',updatedAt:'18 Sen, 09:41'},
    {id:'e2',title:'Mock Interview Marathon',subtitle:'3 Okt 2026 · Karyera Mərkəzi',status:'Aktiv',meta:'42/60 yer',updatedAt:'17 Sen, 15:18'},
    {id:'e3',title:'CV və LinkedIn emalatxanası',subtitle:'9 Okt 2026 · Onlayn',status:'Qaralama',meta:'Qeydiyyat bağlıdır',updatedAt:'17 Sen, 12:11'}
  ],
  benefits: [
    {id:'b1',title:'Tamaşalara tələbə bileti',subtitle:'Milli Dram Teatrı · 50%',status:'Aktiv',meta:'312 istifadə',updatedAt:'18 Sen, 13:20'},
    {id:'b2',title:'Tələbə seansı',subtitle:'CinemaPlus · 30%',status:'Aktiv',meta:'QR ilə istifadə',updatedAt:'16 Sen, 10:00'},
    {id:'b3',title:'Kitab alışına endirim',subtitle:'Libraff · 15%',status:'Yoxlamada',meta:'Müqavilə gözləyir',updatedAt:'14 Sen, 17:39'}
  ],
  applications: [
    {id:'a1',title:'Tələbə 001',subtitle:'Mechanical Engineering Intern',status:'Yoxlamada',meta:'CV əlavə edilib',updatedAt:'18 Sen, 15:44'},
    {id:'a2',title:'Tələbə 002',subtitle:'Process Engineering Intern',status:'Aktiv',meta:'Müsahibəyə dəvət',updatedAt:'18 Sen, 11:37'}
  ],
  students: [
    {id:'s1',title:'Tələbə 001',subtitle:'Mexanika mühəndisliyi · IV kurs',status:'Aktiv',meta:'Profil 75%',updatedAt:'18 Sen, 15:44'},
    {id:'s2',title:'Tələbə 002',subtitle:'Kimya mühəndisliyi · III kurs',status:'Aktiv',meta:'Profil 92%',updatedAt:'18 Sen, 11:37'}
  ],
  content: [
    {id:'p1',title:'Ana səhifə elanı',subtitle:'Career & Innovation Fair 2026',status:'Aktiv',meta:'24 Okt 2026',updatedAt:'18 Sen, 08:22'},
    {id:'p2',title:'Tez-tez verilən suallar',subtitle:'5 sual və cavab',status:'Aktiv',meta:'Saytın alt hissəsi',updatedAt:'15 Sen, 10:30'}
  ],
  admins: [
    {id:'u1',title:'Karyera Mərkəzi rəhbəri',subtitle:'Super Admin',status:'Aktiv',meta:'Bütün səlahiyyətlər',updatedAt:'18 Sen, 09:00'},
    {id:'u2',title:'Tədbirlər üzrə mütəxəssis',subtitle:'Redaktor',status:'Aktiv',meta:'Tədbirlər və məzmun',updatedAt:'17 Sen, 18:12'}
  ],
  audit_logs: [
    {id:'l1',title:'Vakansiya yeniləndi',subtitle:'Mechanical Engineering Intern',status:'Aktiv',meta:'Karyera Mərkəzi rəhbəri',updatedAt:'18 Sen, 14:32'},
    {id:'l2',title:'Güzəşt qaralamaya keçirildi',subtitle:'Kitab alışına endirim',status:'Qaralama',meta:'Tədbirlər üzrə mütəxəssis',updatedAt:'18 Sen, 11:10'}
  ]
};
