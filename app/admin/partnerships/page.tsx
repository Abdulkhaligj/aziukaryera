import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/admin-data';
import { reviewPartnership } from './actions';
import styles from './partnerships.module.css';

type Partnership = {
  id:string; company_id:string; category:string; title:string; details:string;
  preferred_date:string|null; contact_email:string; status:string; admin_note:string;
  created_at:string;
};
type CompanyName = { id:string; name:string };

const categories:Record<string,string> = {
  career_day:'Karyera günü',workshop:'Workshop / təlim',
  campus_visit:'Müəssisə ziyarəti',internship:'Təcrübə proqramı',
  capstone:'Diplom və real layihə',guest_lecture:'Qonaq mühazirə',other:'Digər'
};
const statuses:Record<string,string> = {
  submitted:'Göndərilib',reviewing:'Baxılır',approved:'Təsdiqlənib',
  rejected:'İmtina',completed:'Tamamlanıb'
};

export default async function PartnershipAdminPage({
  searchParams
}:{
  searchParams:Promise<{result?:string}>
}) {
  const context = await getAdminContext();
  if (!context) redirect('/login');
  if (context.mustChangePassword) redirect('/account/password');
  const [{data:requests,error},{data:companies},params] = await Promise.all([
    context.supabase.from('company_partnership_requests').select('*')
      .order('created_at',{ascending:false}).limit(500),
    context.supabase.from('companies').select('id,name'),
    searchParams
  ]);
  const rows=(requests||[]) as Partnership[];
  const companyNames=new Map(((companies||[]) as CompanyName[]).map(company=>[company.id,company.name]));
  const canReview=context.role==='super_admin'||context.role==='manager';
  const result=params.result||'';
  const notice:Record<string,string>={
    saved:'Əməkdaşlıq müraciətinin statusu uğurla yeniləndi.',
    denied:'Bu qərarı yalnız şöbə müdiri və ya Super Admin dəyişə bilər.',
    invalid:'Forma məlumatlarını yenidən yoxlayın.',
    error:'Məlumatları saxlamaq mümkün olmadı.'
  };
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>ADNSU Karyera Mərkəzi · Şirkət əməkdaşlığı</div>
            <h1>Əməkdaşlıq müraciətləri</h1>
            <p>Şirkətlərin karyera günü, təcrübə, workshop və real layihə təkliflərinin idarə olunması.</p>
          </div>
          <Link href="/admin" className={styles.back}>← Admin panelinə qayıt</Link>
        </header>
        {notice[result] && <div className={styles.notice} role="status">{notice[result]}</div>}
        {error && <div className={styles.notice} role="alert">Müraciətlər yüklənmədi: {error.message}</div>}
        <p className={styles.count}>{rows.length} müraciət · {canReview?'Qərar vermək aktivdir':'Yalnız baxış rejimi'}</p>
        <section className={styles.items}>
          {rows.length===0 && !error && <div className={styles.empty}>Hələ şirkətlərdən əməkdaşlıq müraciəti daxil olmayıb.</div>}
          {rows.map(row=>(
            <article className={styles.card} key={row.id}>
              <div className={styles.titleRow}>
                <div>
                  <div className={styles.eyebrow}>{companyNames.get(row.company_id)||'Şirkət'} · {categories[row.category]||row.category}</div>
                  <h2>{row.title}</h2>
                  <div className={styles.meta}>
                    {row.contact_email} · {new Date(row.created_at).toLocaleString('az-AZ',{timeZone:'Asia/Baku'})}
                    {row.preferred_date && ' · Təklif olunan tarix: '+row.preferred_date}
                  </div>
                </div>
                <span className={styles.status}>{statuses[row.status]||row.status}</span>
              </div>
              <p className={styles.details}>{row.details}</p>
              {canReview ? (
                <form action={reviewPartnership} className={styles.form}>
                  <input type="hidden" name="id" value={row.id}/>
                  <label>Status
                    <select name="status" defaultValue={row.status}>
                      {Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>Karyera Mərkəzinin qeydi
                    <textarea name="admin_note" maxLength={2000} defaultValue={row.admin_note||''} rows={2}/>
                  </label>
                  <button type="submit">Qərarı saxla</button>
                </form>
              ) : row.admin_note ? <div className={styles.notice}>Qeyd: {row.admin_note}</div> : null}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
