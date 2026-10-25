import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/admin-data';
import styles from './compliance.module.css';

const documentation = [
  { label:'Məxfilik siyasəti', path:'PRIVACY_POLICY_DRAFT.az.md' },
  { label:'İstifadə şərtləri', path:'TERMS_OF_USE_DRAFT.az.md' },
  { label:'Şirkətlər üçün müqavilə', path:'COMPANY_AGREEMENT_DRAFT.az.md' },
  { label:'Məlumat hüquqları üzrə prosedur', path:'DATA_RIGHTS_SOP.az.md' },
  { label:'AI məlumatlandırması', path:'AI_NOTICE_DRAFT.az.md' },
  { label:'Release və test qaydası', path:'RELEASE_CHECKLIST.az.md' }
];
const tasks = [
  { heading:'Hüquqi operator və səlahiyyət', detail:'Platforma üzrə mülkiyyətçi, operator, müqavilə tərəfi və rəsmi əlaqə şəxsini hüquq şöbəsi təsdiqləməlidir.' },
  { heading:'Fərdi məlumatların reyestri', detail:'Dövlət qeydiyyatı öhdəliyinin olub-olmaması və mümkün istisna yazılı qaydada qiymətləndirilməlidir.' },
  { heading:'Vasitəçilik statusu', detail:'İşədüzəltmə vasitəçiliyi üzrə fəaliyyət təsnifatı və mümkün reyestr tələbi dəqiqləşdirilməlidir.' },
  { heading:'CV və razılıq', detail:'Hər şirkətlə məlumat paylaşımının hüquqi əsası və tələb edilən razılıq forması təsdiq edilməlidir.' },
  { heading:'Transsərhəd məlumat axını', detail:'Vercel, Supabase və AI xidmətlərinin regionları, üçüncü tərəf emalı və məlumat ötürülməsi qiymətləndirilməlidir.' },
  { heading:'Məlumat hüquqları', detail:'İstifadəçi sorğularının qəbulu, şəxsiyyət təsdiqi, qanuni müddətlər, silinmə və cavab qaydası təsdiqlənməlidir.' },
  { heading:'Şirkət təhlükəsizliyi', detail:'RLS, təsdiqlənmiş şirkət statusu, ayrı-seçkiliyin moderasiyası və CV-yə yalnız səlahiyyətli giriş sınaqdan keçirilməlidir.' },
  { heading:'Paketlər və ödəniş', detail:'Free/Pro/Business müqaviləsi, tariflər, qanuni hesablaşma və geri ödəniş proseduru dəqiqləşdirilməlidir.' },
  { heading:'Buraxılışdan əvvəl QA', detail:'Main saytın mövcud dizaynını qoruyaraq tələbə, şirkət və admin testləri ayrıca sınaq mühitində keçirilməlidir.' }
];

export default async function CompliancePage() {
  const context = await getAdminContext();
  if (!context) redirect('/login');
  if (context.mustChangePassword) redirect('/account/password');
  return <main className={styles.page}>
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>ADNSU Karyera · Hüquq və etibar</div>
          <h1 className={styles.title}>Hüquqi uyğunluq mərkəzi</h1>
          <p className={styles.lead}>Tələbə, şirkət və admin kabinetləri üzrə təhlükəsizlik, məlumatların mühafizəsi və hüquqi təsdiq planı. Bu səhifədə tələbə və namizəd məlumatları göstərilmir.</p>
        </div>
        <Link href="/admin" className={styles.back}>← Admin panelinə qayıt</Link>
      </header>
      <div className={styles.warning} role="status"><strong>Hüquqi təsdiq gözlənilir.</strong> Bu bölmədəki sənədlər layihədir. Hələ qanuni razılıq forması, dövlət qeydiyyatı və ya rəsmi müqavilə kimi qəbul edilməməlidir. Texniki platforma işləsə də, hüquqi baxış tamamlanmayıb.</div>
      <div className={styles.grid}>
        <div className={styles.metric}><b>{tasks.length}</b><span>Hüquq şöbəsi və sistem sahibi ilə təsdiqlənməli bənd</span></div>
        <div className={styles.metric}><b>{documentation.length}</b><span>Hazırlanmış daxili sənəd və prosedur layihəsi</span></div>
        <div className={styles.metric}><b>0</b><span>Bu mərkəzdə rəsmən təsdiqləndiyi qeyd olunan sənəd</span></div>
      </div>
      <section className={styles.section} aria-labelledby="worklist">
        <div className={styles.count}><h2 id="worklist">Təsdiq və yoxlama siyahısı</h2><span className={styles.tag}>Yekun təsdiq tələb olunur</span></div>
        <p className={styles.sub}>Siyahı avtomatik “tamamlandı” göstərmir. Hüquqi qərarlar yalnız sənədləşdirilib səlahiyyətli şəxs tərəfindən təsdiqləndikdən sonra qüvvəyə minir.</p>
        <ol className={styles.tasks}>{tasks.map((item,index)=><li className={styles.task} key={item.heading}><span className={styles.index}>{index+1}</span><div><strong>{item.heading}</strong><p>{item.detail}</p></div></li>)}</ol>
      </section>
      <section className={styles.section} aria-labelledby="doclist">
        <h2 id="doclist">Sənədlər və əməliyyat qaydaları</h2>
        <p className={styles.sub}>Aşağıdakı linklər GitHub-dakı layihə sənədlərinə aparır; təsdiq edilməmiş mətnlər avtomatik olaraq ictimai saytda hüquqi şərt kimi yayımlanmır.</p>
        <div className={styles.linkGrid}>{documentation.map(file=><a className={styles.doc} key={file.path} href={`https://github.com/Abdulkhaligj/aziukaryera/blob/main/docs/legal/${file.path}`} target="_blank" rel="noopener noreferrer"><span>{file.label}<span style={{display:'block',marginTop:6}}>Hüquqi baxış üçün layihə</span></span><span aria-hidden="true">↗</span></a>)}</div>
      </section>
      <section className={styles.section}>
        <h2>Hüquqi mənbələr</h2>
        <p className={styles.sub}>Fərdi məlumatlar və işədüzəltmə vasitəçiliyi üzrə status rəsmi qurumlarla dəqiqləşdirilməlidir.</p>
        <div className={styles.linkGrid}>
          <a className={styles.doc} href="https://e-qanun.az/framework/19675" target="_blank" rel="noopener noreferrer">Fərdi məlumatlar haqqında <span>↗</span></a>
          <a className={styles.doc} href="https://e-qanun.az/framework/39846" target="_blank" rel="noopener noreferrer">Məşğulluq haqqında <span>↗</span></a>
        </div>
      </section>
      <p className={styles.footer}>Daxili uyğunluq planı · 25.10.2026 · Bu səhifə hüquqi rəy və ya rəsmi təsdiq deyil.</p>
    </div>
  </main>;
}