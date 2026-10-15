'use client';

import { useMemo, useState } from 'react';
import {
  Building2, BriefcaseBusiness, CalendarDays, Gift, FileCheck2, Users, LayoutDashboard,
  PanelsTopLeft, ShieldCheck, ScrollText, Search, Plus, MoreHorizontal, Bell, ChevronDown,
  TrendingUp, UserCheck, Clock3, X, Save, Trash2, Menu, GraduationCap,
  MessageSquareText, Flag, CreditCard, FileText, MessagesSquare, Sparkles, RotateCcw
} from 'lucide-react';
import type { AdminRole, AdminRow, ResourceKey, Status } from '@/lib/types';

type Store = Record<ResourceKey, AdminRow[]>;
type NavItem = { key: 'dashboard' | ResourceKey; label: string; icon: React.ComponentType<{ size?: number }>; group: string };
const nav: NavItem[] = [
  { key: 'dashboard', label: 'İcmal', icon: LayoutDashboard, group: 'İdarəetmə' },
  { key: 'jobs', label: 'Vakansiyalar', icon: BriefcaseBusiness, group: 'Məzmun' },
  { key: 'pending_jobs', label: 'Təsdiq gözləyənlər', icon: Clock3, group: 'Məzmun' },
  { key: 'companies', label: 'Şirkətlər', icon: Building2, group: 'Məzmun' },
  { key: 'events', label: 'Tədbirlər', icon: CalendarDays, group: 'Məzmun' },
  { key: 'benefits', label: 'Tələbə güzəştləri', icon: Gift, group: 'Məzmun' },
  { key: 'applications', label: 'Müraciətlər', icon: FileCheck2, group: 'İnsanlar' },
  { key: 'students', label: 'Tələbələr', icon: Users, group: 'İnsanlar' },
  { key: 'master_students', label: 'Magistrlər', icon: GraduationCap, group: 'İnsanlar' },
  { key: 'alumni', label: 'Məzunlar', icon: UserCheck, group: 'İnsanlar' },
  { key: 'network', label: 'Şəbəkə paylaşımları', icon: MessageSquareText, group: 'İcma və nəzarət' },
  { key: 'reports', label: 'Şikayətlər', icon: Flag, group: 'İcma və nəzarət' },
  { key: 'moderation_logs', label: 'Moderasiya tarixçəsi', icon: ShieldCheck, group: 'İcma və nəzarət' },
  { key: 'plans', label: 'Paketlər', icon: PanelsTopLeft, group: 'Kommersiya' },
  { key: 'subscriptions', label: 'Abunəliklər', icon: CreditCard, group: 'Kommersiya' },
  { key: 'payments', label: 'Ödənişlər', icon: CreditCard, group: 'Kommersiya' },
  { key: 'cv_analytics', label: 'CV analitikası', icon: FileText, group: 'Analitika' },
  { key: 'interview_analytics', label: 'Müsahibə analitikası', icon: MessagesSquare, group: 'Analitika' },
  { key: 'ai_usage', label: 'AI istifadəsi', icon: Sparkles, group: 'Analitika' },
  { key: 'notifications', label: 'Bildirişlər', icon: Bell, group: 'Sistem' },
  { key: 'content', label: 'Sayt məzmunu', icon: PanelsTopLeft, group: 'Sistem' },
  { key: 'admins', label: 'Əməkdaşlar və rollar', icon: ShieldCheck, group: 'Sistem' },
  { key: 'audit_logs', label: 'Əməliyyat tarixçəsi', icon: ScrollText, group: 'Sistem' }
];
const titles: Record<ResourceKey, string> = { jobs: 'Vakansiyalar', pending_jobs: 'Təsdiq gözləyən vakansiyalar', companies: 'Şirkətlər', events: 'Tədbirlər', benefits: 'Tələbə güzəştləri', applications: 'Müraciətlər', students: 'Tələbələr', master_students: 'Magistrlər', alumni: 'Məzunlar', network: 'Şəbəkə paylaşımları', reports: 'Şikayətlər', moderation_logs: 'Moderasiya tarixçəsi', plans: 'Paketlər və limitlər', subscriptions: 'Abunəliklər', payments: 'Ödənişlər', cv_analytics: 'CV analitikası', interview_analytics: 'Müsahibə analitikası', ai_usage: 'AI istifadəsi', notifications: 'Bildirişlər', content: 'Sayt məzmunu', admins: 'Əməkdaşlar və rollar', audit_logs: 'Əməliyyat tarixçəsi' };
const addable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'content', 'students', 'master_students', 'alumni', 'admins']);
const removable = new Set<ResourceKey>(['jobs', 'pending_jobs', 'companies', 'events', 'benefits', 'content', 'applications', 'students', 'master_students', 'alumni', 'network', 'reports', 'subscriptions', 'payments', 'cv_analytics', 'interview_analytics', 'ai_usage', 'notifications', 'admins']);
const analyticsOnly = new Set<ResourceKey>(['cv_analytics', 'interview_analytics', 'ai_usage', 'moderation_logs', 'notifications']);
const roleLabels: Record<AdminRole, string> = { super_admin: 'Super Admin', manager: 'Menecer', editor: 'Redaktor', reviewer: 'Yoxlayıcı' };

function Stat({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: React.ComponentType<{ size?: number }>; tone: string }) {
  return <article className="statCard"><div className={`statIcon ${tone}`}><Icon size={20}/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function StatusPill({ status }: { status: Status }) { return <span className={`status status-${status.toLowerCase()}`}>{status}</span>; }

function EditorFields({ resource, row, companies }: { resource: ResourceKey; row?: AdminRow; companies: AdminRow[] }) {
  const f = row?.fields || {};
  if (resource === 'jobs' || resource === 'pending_jobs') return <>
    <label>Elanın adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label>Şirkət<select name="company_id" defaultValue={String(f.company_id || companies[0]?.id || '')} required>{companies.map(company => <option key={company.id} value={company.id}>{company.title}</option>)}</select></label><label>Elan növü<select name="type" defaultValue={String(f.type || 'tecrube')}><option value="is">İş</option><option value="tecrube">Təcrübə</option><option value="graduate">Məzun proqramı</option><option value="konullu">Könüllülük</option></select></label></div>
    <div className="formGrid"><label>İş rejimi<input name="mode" defaultValue={String(f.mode || 'Əyani')} required/></label><label>Məkan<input name="location" defaultValue={String(f.location || 'Bakı')} required/></label></div>
    <div className="formGrid"><label>Son müraciət tarixi<input name="deadline" type="date" defaultValue={String(f.deadline || '')} required/></label><label>Status<select name="status" defaultValue={String(f.status || 'draft')}><option value="draft">Qaralama</option><option value="pending_approval">Təsdiq gözləyir</option><option value="changes_requested">Düzəliş tələb olunur</option><option value="approved">Təsdiqlənib</option><option value="published">Dərc olunub</option><option value="rejected">Rədd edilib</option><option value="expired">Müddəti bitib</option><option value="archived">Arxiv</option></select></label></div>
    <div className="formGrid"><label>Departament<input name="department" defaultValue={String(f.department || '')}/></label><label>Təcrübə səviyyəsi<input name="experience_level" defaultValue={String(f.experience_level || '')}/></label></div>
    <div className="formGrid"><label>Minimum maaş<input name="salary_min" type="number" min="0" defaultValue={String(f.salary_min || '')}/></label><label>Maksimum maaş<input name="salary_max" type="number" min="0" defaultValue={String(f.salary_max || '')}/></label></div>
    <div className="formGrid"><label>Valyuta<input name="currency" defaultValue={String(f.currency || 'AZN')}/></label><label>Yer sayı<input name="positions" type="number" min="1" defaultValue={String(f.positions || 1)}/></label></div>
    <label className="checkLine"><input type="checkbox" name="salary_visible" value="true" defaultChecked={Boolean(f.salary_visible)}/> Əmək haqqı tələbəyə görünsün</label>
    <label>Tələb olunan bacarıqlar<input name="skills" defaultValue={String(f.skills || '')}/></label><label>Üstünlük verilən bacarıqlar<input name="preferred_skills" defaultValue={String(f.preferred_skills || '')}/></label>
    <div className="formGrid"><label>Hədəf fakültə kodları<input name="faculty_ids" defaultValue={String(f.faculty_ids || '')}/></label><label>Hədəf ixtisas kodları<input name="major_ids" defaultValue={String(f.major_ids || '')}/></label></div>
    <label>Qısa təsvir<textarea name="summary" defaultValue={String(f.summary || '')}/></label>
    <div className="formGrid"><label>Öhdəliklər<textarea name="duties" defaultValue={String(f.duties || '')}/></label><label>Tələblər<textarea name="requirements" defaultValue={String(f.requirements || '')}/></label></div>
    <div className="formGrid"><label>Müraciət üsulu<input name="application_method" defaultValue={String(f.application_method || 'platform')}/></label><label>Müraciət keçidi<input name="application_url" defaultValue={String(f.application_url || '')}/></label></div>
    <label>Düzəliş tələbi / rədd səbəbi<textarea name="changes_requested" defaultValue={String(f.changes_requested || f.rejection_reason || '')}/></label>
  </>;
  if (resource === 'companies') return <>
    <label>Şirkətin adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label>Sektor<input name="sector" defaultValue={row?.subtitle}/></label><label>Status<select name="status" defaultValue={String(f.status || 'pending')}><option value="pending">Yoxlamada</option><option value="active">Aktiv</option><option value="rejected">Bitib</option></select></label></div>
    <div className="formGrid"><label>E-poçt<input name="email" type="email" defaultValue={String(f.email || '')}/></label><label>Telefon<input name="phone" defaultValue={String(f.phone || '')}/></label></div>
    <div className="formGrid"><label>Vebsayt<input name="website" type="url" defaultValue={String(f.website || '')}/></label><label>Şirkət ölçüsü<input name="company_size" defaultValue={String(f.company_size || '')}/></label></div>
    <div className="formGrid"><label>Ünvan<input name="address" defaultValue={String(f.address || '')}/></label><label>Loqo linki<input name="logo_url" type="url" defaultValue={String(f.logo_url || '')}/></label></div>
    <div className="formGrid"><label>Əlaqəli şəxs<input name="contact" defaultValue={String(f.contact || '')}/></label><label>Vəzifə<input name="contact_position" defaultValue={String(f.contact_position || '')}/></label></div>
    <div className="formGrid"><label>Əlaqə e-poçtu<input name="contact_email" type="email" defaultValue={String(f.contact_email || '')}/></label><label>Əlaqə telefonu<input name="contact_phone" defaultValue={String(f.contact_phone || '')}/></label></div>
    <label className="checkLine"><input type="checkbox" name="verified" value="true" defaultChecked={Boolean(f.verified)}/> Təsdiqlənmiş şirkət nişanı</label>
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
    <label>Mərhələ<select name="status" defaultValue={String(f.status || 'under_review')}><option value="applied">Müraciət edib</option><option value="under_review">Baxılır</option><option value="shortlisted">Qısa siyahı</option><option value="interview">Müsahibə</option><option value="offer">Təklif</option><option value="rejected">İmtina</option><option value="hired">İşə qəbul</option><option value="geri_goturuldu">Geri götürülüb</option></select></label>
    <label>Daxili qeyd<textarea name="note" defaultValue={String(f.note || '')}/></label>
  </>;
  if (['students', 'master_students', 'alumni'].includes(resource)) return <>
    {!row && <div className="noticeBox">Hesab dəvət e-poçtu ilə yaradılacaq. İstifadəçi öz şifrəsini təhlükəsiz şəkildə özü təyin edəcək.</div>}
    <label>Ad və soyad<input name="full_name" defaultValue={String(f.full_name || row?.title || '')} required/></label>
    <div className="formGrid"><label>Giriş e-poçtu<input name="email" type="email" defaultValue={String(f.email || '')} required/></label><label>Şəxsi e-poçt<input name="personal_email" type="email" defaultValue={String(f.personal_email || '')}/></label></div>
    <div className="formGrid"><label>Telefon<input name="phone" defaultValue={String(f.phone || '')}/></label><label>Şəhər<input name="city" defaultValue={String(f.city || 'Bakı, Azərbaycan')}/></label></div>
    <div className="formGrid"><label>Fakültə kodu<input name="faculty_id" defaultValue={String(f.faculty_id || '')}/></label><label>İxtisas kodu<input name="major_id" defaultValue={String(f.major_id || '')}/></label></div>
    <div className="formGrid"><label>Kurs<input name="course" type="number" min="1" max="6" defaultValue={String(f.course || (resource === 'master_students' ? 1 : 1))}/></label><label>ÜOMG / GPA<input name="gpa" type="number" min="0" max="100" step="0.01" defaultValue={String(f.gpa || '')}/></label></div>
    <label>Hesab statusu<select name="status" defaultValue={String(f.status || 'active')}><option value="active">Aktiv</option><option value="pending">Təsdiq gözləyir</option><option value="rejected">Dayandırılıb</option></select></label>
    {resource === 'alumni' && <label className="checkLine"><input type="checkbox" name="alumni_verified" value="true" defaultChecked={Boolean(f.alumni_verified)}/> Təsdiqlənmiş ADNSU məzunu</label>}
  </>;
  if (resource === 'admins') return <>
    {!row && <div className="noticeBox">Yeni əməkdaşa dəvət e-poçtu göndəriləcək. Maksimum 5 aktiv admin hesabı saxlanılır.</div>}
    <label>Ad və soyad<input name="full_name" defaultValue={String(f.full_name || row?.title || '')} required/></label>
    <label>Giriş e-poçtu<input name="email" type="email" defaultValue={String(f.email || row?.subtitle || '')} required/></label>
    <div className="formGrid"><label>Giriş rolu<select name="admin_role" defaultValue={String(f.admin_role || 'reviewer')}><option value="super_admin">Super Admin</option><option value="manager">Menecer</option><option value="editor">Redaktor</option><option value="reviewer">Yoxlayıcı</option></select></label><label>Hesab statusu<select name="status" defaultValue={String(f.status || 'active')}><option value="active">Aktiv</option><option value="pending">Təsdiq gözləyir</option><option value="rejected">Dayandırılıb</option></select></label></div>
  </>;
  if (resource === 'network') return <>
    <label>Moderasiya statusu<select name="moderation_status" defaultValue={String(f.moderation_status || 'visible')}><option value="visible">Görünür</option><option value="reviewing">Yoxlamada</option><option value="hidden">Gizlədilib</option></select></label>
  </>;
  if (resource === 'reports') return <>
    <label>Şikayət statusu<select name="status" defaultValue={String(f.status || 'open')}><option value="open">Açıq</option><option value="reviewing">Yoxlanılır</option><option value="resolved">Həll edildi</option><option value="dismissed">Əsassızdır</option></select></label>
  </>;
  if (resource === 'subscriptions') return <>
    <label>Paket<select name="plan_id" defaultValue={String(f.plan_id || 'free')}><option value="free">Free · 0 AZN</option><option value="pro">Pro · 24.99 AZN/ay</option><option value="business">Business · 49.99 AZN/ay</option></select></label>
    <label>Status<select name="status" defaultValue={String(f.status || 'pending')}><option value="pending">Təsdiq gözləyir</option><option value="active">Aktiv</option><option value="past_due">Ödəniş gecikib</option><option value="cancelled">Ləğv edilib</option></select></label>
  </>;
  if (resource === 'plans') return <>
    <label>Paket adı<input value={row?.title || ''} disabled/></label>
    <div className="formGrid"><label>Aylıq qiymət (AZN)<input name="monthly_price" type="number" min="0" step="0.01" defaultValue={String(f.monthly_price ?? 0)}/></label><label>Aktiv vakansiya limiti<input name="active_vacancies" type="number" min="-1" defaultValue={String(f.active_vacancies ?? '')} placeholder="Limitsiz üçün boş"/></label></div>
    <div className="formGrid"><label>Önə çıxarılan vakansiya<input name="featured_vacancies" type="number" min="0" defaultValue={String(f.featured_vacancies ?? 0)}/></label><label>Aylıq paylaşım limiti<input name="monthly_network_posts" type="number" min="-1" defaultValue={String(f.monthly_network_posts ?? '')} placeholder="Limitsiz üçün boş"/></label></div>
    <label>Təsvir<textarea name="description" defaultValue={String(f.description || '')}/></label>
    <div className="featureChecks">{[['candidate_search','Namizəd axtarışı'],['ai_candidate_matching','AI uyğunluğu'],['ai_cv_ranking','AI CV sıralaması'],['advanced_analytics','Qabaqcıl analitika'],['bulk_messaging','Kütləvi mesajlaşma'],['premium_branding','Premium brend səhifəsi']].map(([key,label]) => <label className="checkLine" key={key}><input type="checkbox" name={key} value="true" defaultChecked={Boolean(f[key])}/>{label}</label>)}</div>
  </>;
  if (resource === 'payments') return <><label>Ödəniş statusu<select name="status" defaultValue={String(f.status || 'pending')}><option value="pending">Gözləyir</option><option value="paid">Ödənilib</option><option value="failed">Uğursuz</option><option value="refunded">Geri qaytarılıb</option><option value="cancelled">Ləğv edilib</option></select></label></>;
  if (resource === 'content') return <>
    <label>Başlıq<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label>Məzmun açarı<input name="content_key" placeholder="home.hero" defaultValue={String(f.content_key || row?.subtitle || '')} required/></label><label>Status<select name="status" defaultValue={row?.status || 'Qaralama'}><option>Qaralama</option><option>Aktiv</option><option>Bitib</option></select></label></div>
    <label>Qısa məlumat<input name="summary" defaultValue={String(f.summary || '')}/></label><label>Mətn<textarea name="body" defaultValue={String(f.body || '')}/></label>
  </>;
  return <label>Status<select name="status" defaultValue={String(f.status || 'active')}><option value="active">Aktiv</option><option value="pending">Gözləmədə</option><option value="rejected">Dayandırılıb</option></select></label>;
}

export default function AdminShell({ initialData, currentUser, currentRole }: { initialData: Store; demoMode?: boolean; currentUser: string; currentRole: AdminRole | string }) {
  const [active, setActive] = useState<'dashboard' | ResourceKey>('dashboard');
  const [data, setData] = useState<Store>(initialData);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; row?: AdminRow } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const current = active === 'dashboard' ? [] : data[active];
  const filtered = useMemo(() => current.filter(row => {
    const matchesQuery = (row.title + ' ' + row.subtitle + ' ' + row.meta).toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (!statusFilter || row.status === statusFilter);
  }), [current, query, statusFilter]);
  const activeJobs = data.jobs.filter(x => x.status === 'Aktiv').length;
  const activeEvents = data.events.filter(x => x.status === 'Aktiv').length;
  const activeSubscriptions = data.subscriptions.filter(x => x.status === 'Aktiv').length;
  const planPrice = new Map(data.plans.map(plan => [plan.id, Number(plan.fields?.monthly_price || 0)]));
  const monthlyRevenue = data.subscriptions.filter(x => x.status === 'Aktiv').reduce((sum, subscription) => sum + (planPrice.get(String(subscription.fields?.plan_id || 'free')) || 0), 0);
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
    setBusy(true); setError(''); setNotice('');
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload: Record<string, unknown> = { ...raw };
    if ('active' in payload) payload.active = payload.active === 'true';
    const endpoint = modal?.mode === 'edit' && modal.row ? `/api/admin/${active}/${modal.row.id}` : `/api/admin/${active}`;
    try {
      const response = await fetch(endpoint, { method: modal?.mode === 'edit' ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Əməliyyat alınmadı');
      await refreshResource(active);
      setNotice(modal?.mode === 'create' && ['students', 'master_students', 'alumni', 'admins'].includes(active) ? 'Dəvət e-poçtu göndərildi.' : 'Məlumat yadda saxlanıldı.');
      setModal(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Əməliyyat alınmadı'); }
    finally { setBusy(false); }
  }

  async function removeRow(row: AdminRow) {
    if (active === 'dashboard') return;
    if (!window.confirm(`“${row.title}” qeydini silmək istəyirsiniz?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/admin/${active}/${row.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Silmək mümkün olmadı');
      await refreshResource(active);
      setNotice('Qeyd silindi.');
      setModal(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Silmək mümkün olmadı'); }
    finally { setBusy(false); }
  }

  async function resetPlatform() {
    if (resetPhrase !== 'SIFIRLA') return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/system/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: resetPhrase }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sıfırlama alınmadı');
      setResetOpen(false); setResetPhrase('');
      window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Sıfırlama alınmadı'); }
    finally { setBusy(false); }
  }

  return <div className="adminApp">
    <aside className={`sidebar ${menuOpen ? 'sidebarOpen' : ''}`}>
      <div className="brand"><span className="brandMark">A</span><div><b>ASOIU</b><span>Karyera Mərkəzi</span><small>ADMIN</small></div><button className="mobileClose" aria-label="Menyunu bağla" onClick={() => setMenuOpen(false)}><X size={20}/></button></div>
      <nav>{['İdarəetmə', 'Məzmun', 'İnsanlar', 'İcma və nəzarət', 'Kommersiya', 'Analitika', 'Sistem'].map(group => <div className="navGroup" key={group}><p>{group}</p>{nav.filter(n => n.group === group).map(item => { const Icon = item.icon; return <button className={active === item.key ? 'active' : ''} key={item.key} onClick={() => { setActive(item.key); setQuery(''); setStatusFilter(''); setMenuOpen(false); }}><Icon size={18}/><span>{item.label}</span>{item.key === 'applications' && <em>{data.applications.length}</em>}</button>; })}</div>)}</nav>
      <div className="sidebarFoot"><div className="miniAvatar">{currentUser.split(' ').map(x => x[0]).join('').slice(0, 2)}</div><div><b>{currentUser}</b><span>{displayRole}</span></div><ChevronDown size={16}/></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="pageIdentity"><button className="menuButton" aria-label="Menyunu aç" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><div><h1>{active === 'dashboard' ? 'İdarəetmə paneli' : titles[active]}</h1><p>{active === 'dashboard' ? 'Platformanın real vaxt vəziyyəti' : active === 'admins' ? `${data.admins.filter(row => row.status === 'Aktiv').length}/5 aktiv admin girişi` : `${data[active].length} qeyd · idarə et və yayımla`}</p></div></div><div className="topActions"><button className="iconButton" aria-label="Bildirişlər"><Bell size={19}/><i/></button><button className="profileButton" aria-label="Profil menyusu"><span>{currentUser.split(' ').map(x => x[0]).join('').slice(0, 2)}</span><div><b>{currentUser}</b><small>{displayRole}</small></div><ChevronDown size={15}/></button></div></header>
      <section className="content">
        {notice && <div className="successBox">{notice}</div>}
        {active === 'dashboard' ? <>
          <div className="welcome"><div><span>Real məlumat bazasına qoşulub</span><h2>Salam, {currentUser}</h2><p>Saytdakı məlumatları, müraciətləri və tərəfdaşları buradan idarə edə bilərsiniz.</p></div><button className="primaryButton" onClick={() => { setActive('jobs'); setModal({ mode: 'create' }); }}><Plus size={18}/>Yeni elan yarat</button></div>
          <div className="statsGrid"><Stat label="Aktiv vakansiyalar" value={String(activeJobs)} note={`${data.pending_jobs.length} təsdiq gözləyir`} icon={BriefcaseBusiness} tone="blue"/><Stat label="Müraciətlər" value={String(data.applications.length)} note="Bütün müraciətlər" icon={Clock3} tone="amber"/><Stat label="Aktiv tələbələr" value={String(data.students.filter(x => x.status === 'Aktiv').length)} note={`${data.students.length} ümumi profil`} icon={UserCheck} tone="green"/><Stat label="Magistrlər" value={String(data.master_students.length)} note={`${data.alumni.length} məzun`} icon={GraduationCap} tone="violet"/><Stat label="Şirkətlər" value={String(data.companies.length)} note={`${data.companies.filter(x => x.status === 'Yoxlamada').length} gözləyir`} icon={Building2} tone="blue"/><Stat label="Aktiv abunəliklər" value={String(activeSubscriptions)} note={`${data.subscriptions.length} ümumi`} icon={CreditCard} tone="green"/><Stat label="Aylıq gəlir" value={`${monthlyRevenue.toFixed(2)} AZN`} note="Aktiv paketlər üzrə" icon={TrendingUp} tone="amber"/><Stat label="Şəbəkə" value={String(data.network.length)} note={`${data.reports.length} şikayət`} icon={MessageSquareText} tone="violet"/><Stat label="Yaxın tədbirlər" value={String(activeEvents)} note={`${data.events.length} ümumi tədbir`} icon={CalendarDays} tone="blue"/></div>
          <div className="dashboardGrid"><section className="panel"><div className="panelHead"><div><h3>Son müraciətlər</h3><p>Komandanın cavabını gözləyən namizədlər</p></div><button onClick={() => setActive('applications')}>Hamısına bax</button></div><div className="compactRows">{data.applications.slice(0, 5).map(row => <div className="compactRow" key={row.id}><span className="avatarCircle">{row.title.split(' ').map(x => x[0]).join('').slice(0, 2)}</span><div><b>{row.title}</b><small>{row.subtitle}</small></div><StatusPill status={row.status}/><time>{row.updatedAt}</time></div>)}</div></section><section className="panel"><div className="panelHead"><div><h3>Platforma aktivliyi</h3><p>Real məzmun göstəricisi</p></div><TrendingUp size={20}/></div><div className="chart"><div style={{ height: '34%' }}/><div style={{ height: '48%' }}/><div style={{ height: '43%' }}/><div style={{ height: '70%' }}/><div style={{ height: '62%' }}/><div style={{ height: '82%' }}/><div style={{ height: '92%' }}/></div><div className="chartLegend"><span>Şirkətlər</span><span>Elanlar</span></div><div className="chartTotal"><strong>{data.jobs.length + data.companies.length + data.events.length + data.benefits.length}</strong><span>idarə olunan qeyd</span></div></section></div>
          <section className="panel"><div className="panelHead"><div><h3>Tez idarəetmə</h3><p>Ən çox istifadə olunan bölmələr</p></div></div><div className="quickGrid">{nav.filter(x => ['jobs', 'companies', 'events', 'benefits'].includes(x.key)).map(item => { const Icon = item.icon; return <button key={item.key} onClick={() => setActive(item.key)}><Icon size={22}/><div><b>{item.label}</b><span>{data[item.key as ResourceKey].length} qeyd</span></div><ChevronDown size={16}/></button>; })}</div></section>
          {currentRole === 'super_admin' && <section className="panel dangerZone"><div><span>SİSTEM NƏZARƏTİ</span><h3>Platforma məlumatlarını sıfırla</h3><p>Tələbə, magistr, məzun, şirkət, vakansiya, müraciət, tədbir, şəbəkə və analitika məlumatlarını silir. Admin girişləri, fakültə/ixtisas siyahıları və paketlər saxlanılır.</p></div><button className="dangerButton" onClick={() => { setError(''); setResetOpen(true); }}><RotateCcw size={18}/>Sıfırlama panelini aç</button></section>}
        </> : <>
          <div className="tableTools"><div className="searchBox"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={`${titles[active]} üzrə axtar...`}/></div><select aria-label="Status üzrə süzgəc" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Bütün statuslar</option><option>Aktiv</option><option>Qaralama</option><option>Yoxlamada</option><option>Bitib</option></select>{addable.has(active) && <button className="primaryButton" onClick={() => { setError(''); setModal({ mode: 'create' }); }}><Plus size={18}/>Yeni əlavə et</button>}</div>
          <section className="panel tablePanel"><div className="dataTable"><div className="tableHeader"><span>Ad və məlumat</span><span>Status</span><span>Əlavə məlumat</span><span>Yenilənib</span><span/></div>{filtered.map(row => <div className="tableRow" key={row.id}><div className="mainCell"><span className="resourceIcon">{row.title[0]}</span><div><b>{row.title}</b><small>{row.subtitle}</small></div></div><StatusPill status={row.status}/><span className="metaCell">{row.meta}</span><time>{row.updatedAt}</time>{active !== 'audit_logs' ? <button className="rowMenu" aria-label={`${row.title} qeydini idarə et`} onClick={() => { setError(''); setModal({ mode: 'edit', row }); }}><MoreHorizontal size={20}/></button> : <span/>}</div>)}{filtered.length === 0 && <div className="emptyState"><Search size={28}/><b>Nəticə tapılmadı</b><span>Axtarış sözünü və ya statusu dəyişin.</span></div>}</div></section>
        </>}
      </section>
    </main>
    {modal && active !== 'dashboard' && <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setModal(null); }}><form className="modal" onSubmit={saveRow}><div className="modalHead"><div><h2>{modal.mode === 'create' ? 'Yeni qeyd əlavə et' : 'Qeydi idarə et'}</h2><p>{titles[active]} bölməsi</p></div><button type="button" aria-label="Pəncərəni bağla" onClick={() => setModal(null)} disabled={busy}><X size={20}/></button></div>{analyticsOnly.has(active) ? <div className="noticeBox">Bu analitika qeydi dəyişdirilmir. Lazım deyilsə aşağıdakı “Sil” düyməsi ilə bazadan çıxara bilərsiniz.</div> : <EditorFields resource={active} row={modal.row} companies={data.companies}/>} {error && <div className="errorBox">{error}</div>}<div className="modalActions">{modal.mode === 'edit' && removable.has(active) && <button type="button" className="dangerButton" onClick={() => modal.row && removeRow(modal.row)} disabled={busy}><Trash2 size={17}/>Sil</button>}<span/><button type="button" className="secondaryButton" onClick={() => setModal(null)} disabled={busy}>Ləğv et</button>{!analyticsOnly.has(active) && <button className="primaryButton" type="submit" disabled={busy}><Save size={17}/>{busy ? 'Yadda saxlanır...' : 'Yadda saxla'}</button>}</div></form></div>}
    {resetOpen && <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setResetOpen(false); }}><div className="modal resetModal"><div className="modalHead"><div><h2>Platformanı sıfırla</h2><p>Bu əməliyyat geri qaytarılmır.</p></div><button type="button" aria-label="Pəncərəni bağla" onClick={() => setResetOpen(false)} disabled={busy}><X size={20}/></button></div><div className="resetWarning"><Trash2 size={22}/><div><b>Silinəcək məlumatlar</b><p>Adi istifadəçilər və şirkət hesabları, elanlar, müraciətlər, tədbirlər, paylaşımlar, CV və müsahibə tarixçəsi, güzəştlər və sayt məzmunu.</p></div></div><div className="noticeBox">Admin hesabları, fakültə və ixtisas siyahıları, həmçinin Free / Pro / Business paketləri saxlanılır.</div><label>Təsdiq üçün <b>SIFIRLA</b> yazın<input value={resetPhrase} onChange={event => setResetPhrase(event.target.value)} autoComplete="off"/></label>{error && <div className="errorBox">{error}</div>}<div className="modalActions"><span/><span/><button type="button" className="secondaryButton" onClick={() => setResetOpen(false)} disabled={busy}>Ləğv et</button><button type="button" className="dangerButton solid" onClick={resetPlatform} disabled={busy || resetPhrase !== 'SIFIRLA'}><RotateCcw size={17}/>{busy ? 'Sıfırlanır...' : 'Hər şeyi sıfırla'}</button></div></div></div>}
  </div>;
}
