'use client';

import { useMemo, useState } from 'react';
import {
  Building2, BriefcaseBusiness, CalendarDays, Gift, FileCheck2, Users, LayoutDashboard,
  PanelsTopLeft, ShieldCheck, ScrollText, Search, Plus, MoreHorizontal, Bell, ChevronDown,
  TrendingUp, UserCheck, Clock3, X, Save, Trash2, Menu
} from 'lucide-react';
import type { AdminRole, AdminRow, ResourceKey, Status } from '@/lib/types';

type Store = Record<ResourceKey, AdminRow[]>;
type NavItem = { key: 'dashboard' | ResourceKey; label: string; icon: React.ComponentType<{ size?: number }>; group: string };
const nav: NavItem[] = [
  { key: 'dashboard', label: 'İcmal', icon: LayoutDashboard, group: 'İdarəetmə' },
  { key: 'jobs', label: 'Vakansiyalar', icon: BriefcaseBusiness, group: 'Məzmun' },
  { key: 'companies', label: 'Şirkətlər', icon: Building2, group: 'Məzmun' },
  { key: 'events', label: 'Tədbirlər', icon: CalendarDays, group: 'Məzmun' },
  { key: 'benefits', label: 'Tələbə güzəştləri', icon: Gift, group: 'Məzmun' },
  { key: 'applications', label: 'Müraciətlər', icon: FileCheck2, group: 'İnsanlar' },
  { key: 'students', label: 'Tələbələr', icon: Users, group: 'İnsanlar' },
  { key: 'content', label: 'Sayt məzmunu', icon: PanelsTopLeft, group: 'Sistem' },
  { key: 'admins', label: 'Əməkdaşlar və rollar', icon: ShieldCheck, group: 'Sistem' },
  { key: 'audit_logs', label: 'Əməliyyat tarixçəsi', icon: ScrollText, group: 'Sistem' }
];
const titles: Record<ResourceKey, string> = { jobs: 'Vakansiyalar', companies: 'Şirkətlər', events: 'Tədbirlər', benefits: 'Tələbə güzəştləri', applications: 'Müraciətlər', students: 'Tələbələr', content: 'Sayt məzmunu', admins: 'Əməkdaşlar və rollar', audit_logs: 'Əməliyyat tarixçəsi' };
const addable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'content']);
const removable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'content']);
const roleLabels: Record<AdminRole, string> = { super_admin: 'Super Admin', manager: 'Menecer', editor: 'Redaktor', reviewer: 'Yoxlayıcı' };

function Stat({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: React.ComponentType<{ size?: number }>; tone: string }) {
  return <article className="statCard"><div className={`statIcon ${tone}`}><Icon size={20}/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function StatusPill({ status }: { status: Status }) { return <span className={`status status-${status.toLowerCase()}`}>{status}</span>; }

function EditorFields({ resource, row, companies }: { resource: ResourceKey; row?: AdminRow; companies: AdminRow[] }) {
  const f = row?.fields || {};
  if (resource === 'jobs') return <>
    <label>Elanın adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label>Şirkət<select name="company_id" defaultValue={String(f.company_id || companies[0]?.id || '')} required>{companies.map(company => <option key={company.id} value={company.id}>{company.title}</option>)}</select></label><label>Elan növü<select name="type" defaultValue={String(f.type || 'tecrube')}><option value="is">İş</option><option value="tecrube">Təcrübə</option><option value="graduate">Məzun proqramı</option><option value="konullu">Könüllülük</option></select></label></div>
    <div className="formGrid"><label>İş rejimi<input name="mode" defaultValue={String(f.mode || 'Əyani')} required/></label><label>Məkan<input name="location" defaultValue={String(f.location || 'Bakı')} required/></label></div>
    <div className="formGrid"><label>Son müraciət tarixi<input name="deadline" type="date" defaultValue={String(f.deadline || '')} required/></label><label>Status<select name="status" defaultValue={String(f.status || 'draft')}><option value="draft">Qaralama</option><option value="pending">Yoxlamada</option><option value="approved">Aktiv</option><option value="closed">Bitib</option></select></label></div>
    <label>Qısa təsvir<textarea name="summary" defaultValue={String(f.summary || '')}/></label>
  </>;
  if (resource === 'companies') return <>
    <label>Şirkətin adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label>Sektor<input name="sector" defaultValue={row?.subtitle}/></label><label>Status<select name="status" defaultValue={String(f.status || 'pending')}><option value="pending">Yoxlamada</option><option value="active">Aktiv</option><option value="rejected">Bitib</option></select></label></div>
    <div className="formGrid"><label>E-poçt<input name="email" type="email" defaultValue={String(f.email || '')}/></label><label>Vebsayt<input name="website" type="url" defaultValue={String(f.website || '')}/></label></div>
    <label>Şirkət haqqında<textarea name="about" defaultValue={String(f.about || '')}/></label>
  </>;
  if (resource === 'events') return <>
    <label>Tədbirin adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label>Tədbirin növü<input name="kind" defaultValue={String(f.kind || row?.subtitle || '')}/></label><label>Tarix və saat<input name="starts_at" type="datetime-local" defaultValue={String(f.starts_at || '')} required/></label></div>
    <div className="formGrid"><label>Məkan<input name="place" defaultValue={String(f.place || '')}/></label><label>Yer sayı<input name="seats" type="number" min="0" defaultValue={String(f.seats ?? 0)}/></label></div>
  </>;
  if (resource === 'benefits') return <>
    <label>Güzəştin adı<input name="title" defaultValue={row?.title} required/></label>
    <input type="hidden" name="partner_id" value={String(f.partner_id || '')}/>
    <div className="formGrid"><label>Tərəfdaş<input name="partner_name" defaultValue={String(f.partner_name || row?.subtitle || '')} required/></label><label>Endirim<input name="discount_label" placeholder="məsələn, 20%" defaultValue={String(f.discount_label || '')} required/></label></div>
    <div className="formGrid"><label>Başlama tarixi<input name="valid_from" type="date" defaultValue={String(f.valid_from || '')}/></label><label>Bitmə tarixi<input name="valid_to" type="date" defaultValue={String(f.valid_to || '')}/></label></div>
    <label>Status<select name="active" defaultValue={String(f.active ?? true)}><option value="true">Aktiv</option><option value="false">Bitib</option></select></label>
    <label>Açıqlama<textarea name="description" defaultValue={String(f.description || '')}/></label>
  </>;
  if (resource === 'applications') return <>
    <label>Namizəd<input value={row?.title || ''} disabled/></label><label>Vakansiya<input value={row?.subtitle || ''} disabled/></label>
    <label>Mərhələ<select name="status" defaultValue={String(f.status || 'baxilir')}><option value="gonderildi">Göndərilib</option><option value="baxilir">Baxılır</option><option value="musahibe">Müsahibə</option><option value="teklif">Təklif</option><option value="imtina">İmtina</option><option value="geri_goturuldu">Geri götürülüb</option></select></label>
    <label>Daxili qeyd<textarea name="note" defaultValue={String(f.note || '')}/></label>
  </>;
  if (resource === 'content') return <>
    <label>Başlıq<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label>Məzmun açarı<input name="content_key" placeholder="home.hero" defaultValue={String(f.content_key || row?.subtitle || '')} required/></label><label>Status<select name="status" defaultValue={row?.status || 'Qaralama'}><option>Qaralama</option><option>Aktiv</option><option>Bitib</option></select></label></div>
    <label>Qısa məlumat<input name="summary" defaultValue={String(f.summary || '')}/></label><label>Mətn<textarea name="body" defaultValue={String(f.body || '')}/></label>
  </>;
  return <label>Status<select name="status" defaultValue={String(f.status || 'active')}><option value="active">Aktiv</option><option value="pending">Gözləmədə</option><option value="rejected">Dayandırılıb</option></select></label>;
}

export default function AdminShell({ initialData, demoMode, currentUser, currentRole }: { initialData: Store; demoMode: boolean; currentUser: string; currentRole: AdminRole | string }) {
  const [active, setActive] = useState<'dashboard' | ResourceKey>('dashboard');
  const [data, setData] = useState<Store>(initialData);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; row?: AdminRow } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = active === 'dashboard' ? [] : data[active];
  const filtered = useMemo(() => current.filter(row => {
    const matchesQuery = (row.title + ' ' + row.subtitle + ' ' + row.meta).toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (!statusFilter || row.status === statusFilter);
  }), [current, query, statusFilter]);
  const activeJobs = data.jobs.filter(x => x.status === 'Aktiv').length;
  const activeEvents = data.events.filter(x => x.status === 'Aktiv').length;
  const displayRole = currentRole in roleLabels ? roleLabels[currentRole as AdminRole] : String(currentRole);

  async function refreshResource(resource: ResourceKey) {
    const response = await fetch(`/api/admin/${resource}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Məlumat yenilənmədi');
    setData(previous => ({ ...previous, [resource]: result }));
    if (resource !== 'audit_logs') {
      const logsResponse = await fetch('/api/admin/audit_logs', { cache: 'no-store' });
      if (logsResponse.ok) {
        const logs = await logsResponse.json();
        setData(previous => ({ ...previous, audit_logs: logs }));
      }
    }
  }

  async function saveRow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active === 'dashboard') return;
    setBusy(true); setError('');
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload: Record<string, unknown> = { ...raw };
    if ('active' in payload) payload.active = payload.active === 'true';
    const endpoint = modal?.mode === 'edit' && modal.row ? `/api/admin/${active}/${modal.row.id}` : `/api/admin/${active}`;
    try {
      const response = await fetch(endpoint, { method: modal?.mode === 'edit' ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Əməliyyat alınmadı');
      await refreshResource(active);
      setModal(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Əməliyyat alınmadı'); }
    finally { setBusy(false); }
  }

  async function removeRow(row: AdminRow) {
    if (active === 'dashboard') return;
    if (!window.confirm(`“${row.title}” qeydini silmək istəyirsiniz?`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/${active}/${row.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Silmək mümkün olmadı');
      await refreshResource(active);
      setModal(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Silmək mümkün olmadı'); }
    finally { setBusy(false); }
  }

  return <div className="adminApp">
    <aside className={`sidebar ${menuOpen ? 'sidebarOpen' : ''}`}>
      <div className="brand"><span className="brandMark">A</span><div><b>ASOIU</b><span>Karyera Mərkəzi</span><small>ADMIN</small></div><button className="mobileClose" aria-label="Menyunu bağla" onClick={() => setMenuOpen(false)}><X size={20}/></button></div>
      <nav>{['İdarəetmə', 'Məzmun', 'İnsanlar', 'Sistem'].map(group => <div className="navGroup" key={group}><p>{group}</p>{nav.filter(n => n.group === group).map(item => { const Icon = item.icon; return <button className={active === item.key ? 'active' : ''} key={item.key} onClick={() => { setActive(item.key); setQuery(''); setStatusFilter(''); setMenuOpen(false); }}><Icon size={18}/><span>{item.label}</span>{item.key === 'applications' && <em>{data.applications.length}</em>}</button>; })}</div>)}</nav>
      <div className="sidebarFoot"><div className="miniAvatar">{currentUser.split(' ').map(x => x[0]).join('').slice(0, 2)}</div><div><b>{currentUser}</b><span>{displayRole}</span></div><ChevronDown size={16}/></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="pageIdentity"><button className="menuButton" aria-label="Menyunu aç" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><div><h1>{active === 'dashboard' ? 'İdarəetmə paneli' : titles[active]}</h1><p>{active === 'dashboard' ? 'Platformanın real vaxt vəziyyəti' : `${data[active].length} qeyd · idarə et və yayımla`}</p></div></div><div className="topActions">{demoMode && <span className="demoBadge">Demo rejimi</span>}<button className="iconButton" aria-label="Bildirişlər"><Bell size={19}/><i/></button><button className="profileButton" aria-label="Profil menyusu"><span>{currentUser.split(' ').map(x => x[0]).join('').slice(0, 2)}</span><div><b>{currentUser}</b><small>{displayRole}</small></div><ChevronDown size={15}/></button></div></header>
      <section className="content">
        {active === 'dashboard' ? <>
          <div className="welcome"><div><span>Real məlumat bazasına qoşulub</span><h2>Salam, {currentUser}</h2><p>Saytdakı məlumatları, müraciətləri və tərəfdaşları buradan idarə edə bilərsiniz.</p></div><button className="primaryButton" onClick={() => { setActive('jobs'); setModal({ mode: 'create' }); }}><Plus size={18}/>Yeni elan yarat</button></div>
          <div className="statsGrid"><Stat label="Aktiv vakansiyalar" value={String(activeJobs)} note={`${data.jobs.length} ümumi elan`} icon={BriefcaseBusiness} tone="blue"/><Stat label="Müraciətlər" value={String(data.applications.length)} note="Bütün müraciətlər" icon={Clock3} tone="amber"/><Stat label="Aktiv tələbələr" value={String(data.students.filter(x => x.status === 'Aktiv').length)} note={`${data.students.length} ümumi profil`} icon={UserCheck} tone="green"/><Stat label="Yaxın tədbirlər" value={String(activeEvents)} note={`${data.events.length} ümumi tədbir`} icon={CalendarDays} tone="violet"/></div>
          <div className="dashboardGrid"><section className="panel"><div className="panelHead"><div><h3>Son müraciətlər</h3><p>Komandanın cavabını gözləyən namizədlər</p></div><button onClick={() => setActive('applications')}>Hamısına bax</button></div><div className="compactRows">{data.applications.slice(0, 5).map(row => <div className="compactRow" key={row.id}><span className="avatarCircle">{row.title.split(' ').map(x => x[0]).join('').slice(0, 2)}</span><div><b>{row.title}</b><small>{row.subtitle}</small></div><StatusPill status={row.status}/><time>{row.updatedAt}</time></div>)}</div></section><section className="panel"><div className="panelHead"><div><h3>Platforma aktivliyi</h3><p>Real məzmun göstəricisi</p></div><TrendingUp size={20}/></div><div className="chart"><div style={{ height: '34%' }}/><div style={{ height: '48%' }}/><div style={{ height: '43%' }}/><div style={{ height: '70%' }}/><div style={{ height: '62%' }}/><div style={{ height: '82%' }}/><div style={{ height: '92%' }}/></div><div className="chartLegend"><span>Şirkətlər</span><span>Elanlar</span></div><div className="chartTotal"><strong>{data.jobs.length + data.companies.length + data.events.length + data.benefits.length}</strong><span>idarə olunan qeyd</span></div></section></div>
          <section className="panel"><div className="panelHead"><div><h3>Tez idarəetmə</h3><p>Ən çox istifadə olunan bölmələr</p></div></div><div className="quickGrid">{nav.filter(x => ['jobs', 'companies', 'events', 'benefits'].includes(x.key)).map(item => { const Icon = item.icon; return <button key={item.key} onClick={() => setActive(item.key)}><Icon size={22}/><div><b>{item.label}</b><span>{data[item.key as ResourceKey].length} qeyd</span></div><ChevronDown size={16}/></button>; })}</div></section>
        </> : <>
          <div className="tableTools"><div className="searchBox"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={`${titles[active]} üzrə axtar...`}/></div><select aria-label="Status üzrə süzgəc" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Bütün statuslar</option><option>Aktiv</option><option>Qaralama</option><option>Yoxlamada</option><option>Bitib</option></select>{addable.has(active) && <button className="primaryButton" onClick={() => { setError(''); setModal({ mode: 'create' }); }}><Plus size={18}/>Yeni əlavə et</button>}</div>
          <section className="panel tablePanel"><div className="dataTable"><div className="tableHeader"><span>Ad və məlumat</span><span>Status</span><span>Əlavə məlumat</span><span>Yenilənib</span><span/></div>{filtered.map(row => <div className="tableRow" key={row.id}><div className="mainCell"><span className="resourceIcon">{row.title[0]}</span><div><b>{row.title}</b><small>{row.subtitle}</small></div></div><StatusPill status={row.status}/><span className="metaCell">{row.meta}</span><time>{row.updatedAt}</time>{!['students', 'audit_logs'].includes(active) ? <button className="rowMenu" aria-label={`${row.title} qeydini redaktə et`} onClick={() => { setError(''); setModal({ mode: 'edit', row }); }}><MoreHorizontal size={20}/></button> : <span/>}</div>)}{filtered.length === 0 && <div className="emptyState"><Search size={28}/><b>Nəticə tapılmadı</b><span>Axtarış sözünü və ya statusu dəyişin.</span></div>}</div></section>
        </>}
      </section>
    </main>
    {modal && active !== 'dashboard' && <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setModal(null); }}><form className="modal" onSubmit={saveRow}><div className="modalHead"><div><h2>{modal.mode === 'create' ? 'Yeni qeyd əlavə et' : 'Qeydi redaktə et'}</h2><p>{titles[active]} bölməsi</p></div><button type="button" aria-label="Pəncərəni bağla" onClick={() => setModal(null)} disabled={busy}><X size={20}/></button></div><EditorFields resource={active} row={modal.row} companies={data.companies}/>{error && <div className="errorBox">{error}</div>}<div className="modalActions">{modal.mode === 'edit' && removable.has(active) && <button type="button" className="dangerButton" onClick={() => modal.row && removeRow(modal.row)} disabled={busy}><Trash2 size={17}/>Sil</button>}<span/><button type="button" className="secondaryButton" onClick={() => setModal(null)} disabled={busy}>Ləğv et</button><button className="primaryButton" type="submit" disabled={busy}><Save size={17}/>{busy ? 'Yadda saxlanır...' : 'Yadda saxla'}</button></div></form></div>}
  </div>;
}
