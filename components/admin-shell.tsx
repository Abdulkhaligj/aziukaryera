'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Building2, BriefcaseBusiness, CalendarDays, Gift, FileCheck2, Users, LayoutDashboard,
  PanelsTopLeft, ShieldCheck, ScrollText, Search, Plus, Bell, ChevronRight, Trophy,
  TrendingUp, UserCheck, Clock3, X, Save, Trash2, Menu, GraduationCap, KeyRound, LogOut,
  MessageSquareText, Flag, CreditCard, FileText, MessagesSquare, Sparkles, RotateCcw,
  AlertTriangle, Copy, Check, Eye, LoaderCircle, Pencil
} from 'lucide-react';
import type { AdminRole, AdminRow, Lookups, ResourceKey, Status } from '@/lib/types';
import { can, roleDescriptions, roleLabels } from '@/lib/permissions';
import { logout } from '@/app/login/actions';

type Store = Record<ResourceKey, AdminRow[]>;
type View = 'dashboard' | ResourceKey;
type NavItem = { key: View; label: string; icon: React.ComponentType<{ size?: number }>; group: string };

const nav: NavItem[] = [
  { key: 'dashboard', label: 'İcmal', icon: LayoutDashboard, group: 'İdarəetmə' },
  { key: 'pending_jobs', label: 'Təsdiq gözləyənlər', icon: Clock3, group: 'İdarəetmə' },
  { key: 'jobs', label: 'Vakansiyalar', icon: BriefcaseBusiness, group: 'Məzmun' },
  { key: 'companies', label: 'Şirkətlər', icon: Building2, group: 'Məzmun' },
  { key: 'events', label: 'Tədbirlər', icon: CalendarDays, group: 'Məzmun' },
  { key: 'benefits', label: 'Tələbə güzəştləri', icon: Gift, group: 'Məzmun' },
  { key: 'awards', label: 'Awards', icon: Trophy, group: 'Məzmun' },
  { key: 'content', label: 'Sayt məzmunu', icon: PanelsTopLeft, group: 'Məzmun' },
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
  { key: 'admins', label: 'Əməkdaşlar və rollar', icon: ShieldCheck, group: 'Sistem' },
  { key: 'audit_logs', label: 'Əməliyyat tarixçəsi', icon: ScrollText, group: 'Sistem' }
];
const groups = ['İdarəetmə', 'Məzmun', 'İnsanlar', 'İcma və nəzarət', 'Kommersiya', 'Analitika', 'Sistem'];
/* Telefonda alt menyu: ən çox işlənən bölmələr */
const bottomNav: View[] = ['dashboard', 'pending_jobs', 'applications', 'network'];

const titles: Record<ResourceKey, string> = {
  jobs: 'Vakansiyalar', pending_jobs: 'Təsdiq gözləyən vakansiyalar', companies: 'Şirkətlər', events: 'Tədbirlər',
  benefits: 'Tələbə güzəştləri', awards: 'Awards', applications: 'Müraciətlər', students: 'Tələbələr',
  master_students: 'Magistrlər', alumni: 'Məzunlar', network: 'Şəbəkə paylaşımları', reports: 'Şikayətlər',
  moderation_logs: 'Moderasiya tarixçəsi', plans: 'Paketlər və limitlər', subscriptions: 'Abunəliklər',
  payments: 'Ödənişlər', cv_analytics: 'CV analitikası', interview_analytics: 'Müsahibə analitikası',
  ai_usage: 'AI istifadəsi', notifications: 'Bildirişlər', content: 'Sayt məzmunu',
  admins: 'Əməkdaşlar və rollar', audit_logs: 'Əməliyyat tarixçəsi'
};
const singular: Partial<Record<ResourceKey, string>> = {
  jobs: 'vakansiya', companies: 'şirkət', events: 'tədbir', benefits: 'güzəşt', awards: 'mükafat', content: 'məzmun',
  students: 'tələbə', master_students: 'magistr', alumni: 'məzun', admins: 'əməkdaş'
};
const people = new Set<ResourceKey>(['students', 'master_students', 'alumni', 'admins']);
const statuses: Status[] = ['Aktiv', 'Yoxlamada', 'Qaralama', 'Bitib'];
/* Formada çoxlu seçim sahələri vergüllə birləşdirilib göndərilir */
const multiFields = ['faculty_ids', 'major_ids'];

const initialsOf = (value: string) => value.split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '•';

function StatusPill({ status }: { status: Status }) { return <span className={`status status-${status.toLowerCase()}`}>{status}</span>; }

function Stat({ label, value, note, icon: Icon, tone, onClick }: { label: string; value: string; note: string; icon: React.ComponentType<{ size?: number }>; tone: string; onClick?: () => void }) {
  return <button type="button" className="statCard" onClick={onClick} disabled={!onClick}>
    <span className={`statIcon ${tone}`}><Icon size={20}/></span>
    <span className="statText"><span>{label}</span><strong>{value}</strong><small>{note}</small></span>
  </button>;
}

function FacultyMajorPicker({ lookups, faculties, majors }: { lookups: Lookups; faculties: string; majors: string }) {
  const selectedF = new Set(faculties.split(',').map(x => x.trim()).filter(Boolean));
  const selectedM = new Set(majors.split(',').map(x => x.trim()).filter(Boolean));
  return <fieldset className="pickerBox"><legend>Hədəf fakültə və ixtisaslar</legend>
    <p className="fieldHint">Heç nə seçilməsə, elan bütün tələbələrə göstərilir.</p>
    {lookups.faculties.map(f => <details key={f.id} open={selectedF.has(f.id) || lookups.majors.some(m => m.faculty_id === f.id && selectedM.has(m.id))}>
      <summary>{f.name}</summary>
      <label className="checkLine"><input type="checkbox" name="faculty_ids" value={f.id} defaultChecked={selectedF.has(f.id)}/> Bütün fakültə</label>
      <div className="chipChecks">{lookups.majors.filter(m => m.faculty_id === f.id).map(m => <label key={m.id} className="chipCheck"><input type="checkbox" name="major_ids" value={m.id} defaultChecked={selectedM.has(m.id)}/><span>{m.name}</span></label>)}</div>
    </details>)}
  </fieldset>;
}

function EditorFields({ resource, row, data, lookups, mode, self = false }: { resource: ResourceKey; row?: AdminRow; data: Store; lookups: Lookups; mode: 'create' | 'edit'; self?: boolean }) {
  const f = row?.fields || {};
  const companies = data.companies;
  if (resource === 'jobs' || resource === 'pending_jobs') return <>
    <label className="field">Elanın adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label className="field">Şirkət<select name="company_id" defaultValue={String(f.company_id || companies[0]?.id || '')} required>{companies.map(company => <option key={company.id} value={company.id}>{company.title}</option>)}</select></label><label className="field">Elan növü<select name="type" defaultValue={String(f.type || 'tecrube')}><option value="is">İş</option><option value="tecrube">Təcrübə</option><option value="graduate">Məzun proqramı</option><option value="konullu">Könüllülük</option></select></label></div>
    <div className="formGrid"><label className="field">Status<select name="status" defaultValue={String(f.status || 'draft')}><option value="draft">Qaralama</option><option value="pending_approval">Təsdiq gözləyir</option><option value="changes_requested">Düzəliş tələb olunur</option><option value="approved">Təsdiqlənib</option><option value="published">Dərc olunub</option><option value="rejected">Rədd edilib</option><option value="expired">Müddəti bitib</option><option value="archived">Arxiv</option></select></label><label className="field">Son müraciət tarixi<input name="deadline" type="date" defaultValue={String(f.deadline || '')} required/></label></div>
    <label className="field">Düzəliş tələbi / rədd səbəbi<textarea name="changes_requested" rows={2} placeholder="Status 'Düzəliş tələb olunur' və ya 'Rədd edilib' olanda şirkətə göstərilir" defaultValue={String(f.changes_requested || f.rejection_reason || '')}/></label>
    <div className="formGrid"><label className="field">İş rejimi<select name="mode" defaultValue={String(f.mode || 'Əyani')}><option>Əyani</option><option>Hibrid</option><option>Uzaqdan</option></select></label><label className="field">Məkan<input name="location" defaultValue={String(f.location || 'Bakı')} required/></label></div>
    <label className="field">Qısa təsvir<textarea name="summary" rows={3} defaultValue={String(f.summary || '')}/></label>
    <div className="formGrid"><label className="field">Öhdəliklər <small>(hər sətirdə biri)</small><textarea name="duties" rows={4} defaultValue={String(f.duties || '')}/></label><label className="field">Tələblər <small>(hər sətirdə biri)</small><textarea name="requirements" rows={4} defaultValue={String(f.requirements || '')}/></label></div>
    <label className="field">Tələb olunan bacarıqlar <small>(vergüllə)</small><input name="skills" defaultValue={String(f.skills || '')} placeholder="Excel, AutoCAD, SQL"/></label>
    <label className="field">Üstünlük verilən bacarıqlar<input name="preferred_skills" defaultValue={String(f.preferred_skills || '')}/></label>
    <FacultyMajorPicker lookups={lookups} faculties={String(f.faculty_ids || '')} majors={String(f.major_ids || '')}/>
    <details className="moreFields"><summary>Əlavə sahələr: maaş, yer sayı, müraciət üsulu</summary>
      <div className="formGrid"><label className="field">Departament<input name="department" defaultValue={String(f.department || '')}/></label><label className="field">Təcrübə səviyyəsi<input name="experience_level" defaultValue={String(f.experience_level || '')}/></label></div>
      <div className="formGrid"><label className="field">Minimum maaş<input name="salary_min" type="number" inputMode="numeric" min="0" defaultValue={String(f.salary_min ?? '')}/></label><label className="field">Maksimum maaş<input name="salary_max" type="number" inputMode="numeric" min="0" defaultValue={String(f.salary_max ?? '')}/></label></div>
      <div className="formGrid"><label className="field">Valyuta<input name="currency" defaultValue={String(f.currency || 'AZN')}/></label><label className="field">Yer sayı<input name="positions" type="number" inputMode="numeric" min="1" defaultValue={String(f.positions || 1)}/></label></div>
      <label className="checkLine"><input type="checkbox" name="salary_visible" value="true" defaultChecked={Boolean(f.salary_visible)}/> Əmək haqqı tələbəyə görünsün</label>
      <div className="formGrid"><label className="field">Müraciət üsulu<select name="application_method" defaultValue={String(f.application_method || 'platform')}><option value="platform">Platforma üzərindən</option><option value="external">Xarici link</option><option value="email">E-poçt</option></select></label><label className="field">Müraciət keçidi<input name="application_url" type="url" defaultValue={String(f.application_url || '')}/></label></div>
    </details>
  </>;
  if (resource === 'companies') return <>
    <label className="field">Şirkətin adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label className="field">Sektor<input name="sector" defaultValue={row?.subtitle === 'Şirkət' ? '' : row?.subtitle}/></label><label className="field">Status<select name="status" defaultValue={String(f.status || 'pending')}><option value="pending">Yoxlamada</option><option value="active">Aktiv (təsdiqlənib)</option><option value="rejected">Rədd edilib</option></select></label></div>
    <label className="checkLine"><input type="checkbox" name="verified" value="true" defaultChecked={Boolean(f.verified)}/> Təsdiqlənmiş şirkət nişanı</label>
    <div className="formGrid"><label className="field">E-poçt<input name="email" type="email" defaultValue={String(f.email || '')}/></label><label className="field">Telefon<input name="phone" type="tel" defaultValue={String(f.phone || '')}/></label></div>
    <div className="formGrid"><label className="field">Vebsayt<input name="website" type="url" defaultValue={String(f.website || '')}/></label><label className="field">Şirkət ölçüsü<input name="company_size" defaultValue={String(f.company_size || '')}/></label></div>
    <label className="field">Şirkət haqqında<textarea name="about" rows={3} defaultValue={String(f.about || '')}/></label>
    <details className="moreFields"><summary>Əlaqəli şəxs, ünvan və loqo</summary>
      <div className="formGrid"><label className="field">Əlaqəli şəxs<input name="contact" defaultValue={String(f.contact || '')}/></label><label className="field">Vəzifə<input name="contact_position" defaultValue={String(f.contact_position || '')}/></label></div>
      <div className="formGrid"><label className="field">Əlaqə e-poçtu<input name="contact_email" type="email" defaultValue={String(f.contact_email || '')}/></label><label className="field">Əlaqə telefonu<input name="contact_phone" type="tel" defaultValue={String(f.contact_phone || '')}/></label></div>
      <div className="formGrid"><label className="field">Ünvan<input name="address" defaultValue={String(f.address || '')}/></label><label className="field">Loqo linki (https://)<input name="logo_url" type="url" defaultValue={String(f.logo_url || '')}/></label></div>
    </details>
  </>;
  if (resource === 'events') return <>
    <label className="field">Tədbirin adı<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label className="field">Növü<input name="kind" list="eventKinds" defaultValue={String(f.kind || '')} placeholder="Seminar, Karyera sərgisi..."/><datalist id="eventKinds"><option value="Seminar"/><option value="Karyera sərgisi"/><option value="Master-klass"/><option value="Təlim"/><option value="Görüş"/></datalist></label><label className="field">Tarix və saat<input name="starts_at" type="datetime-local" defaultValue={String(f.starts_at || '')} required/></label></div>
    <div className="formGrid"><label className="field">Məkan<input name="place" defaultValue={String(f.place || '')}/></label><label className="field">Yer sayı<input name="seats" type="number" inputMode="numeric" min="0" defaultValue={String(f.seats ?? 0)}/></label></div>
  </>;
  if (resource === 'benefits') return <>
    <label className="field">Güzəştin adı<input name="title" defaultValue={row?.title} required/></label>
    <input type="hidden" name="partner_id" value={String(f.partner_id || '')}/>
    <div className="formGrid"><label className="field">Tərəfdaş<input name="partner_name" defaultValue={String(f.partner_name || row?.subtitle || '')} required/></label><label className="field">Endirim<input name="discount_label" placeholder="məsələn, 20%" defaultValue={String(f.discount_label || '')} required/></label></div>
    <div className="formGrid"><label className="field">Başlama tarixi<input name="valid_from" type="date" defaultValue={String(f.valid_from || '')}/></label><label className="field">Bitmə tarixi<input name="valid_to" type="date" defaultValue={String(f.valid_to || '')}/></label></div>
    <label className="field">Status<select name="active" defaultValue={String(f.active ?? true)}><option value="true">Aktiv</option><option value="false">Bitib</option></select></label>
    <label className="field">Açıqlama<textarea name="description" rows={3} defaultValue={String(f.description || '')}/></label>
  </>;
  if (resource === 'awards') return <>
    <div className="formGrid"><label className="field">İl<input name="year" type="number" inputMode="numeric" min="2020" max="2100" defaultValue={String(f.year || new Date().getFullYear())} required/></label><label className="field">Dərəcə<select name="tier" defaultValue={String(f.tier || 'gold')}><option value="gold">🥇 Qızıl</option><option value="silver">🥈 Gümüş</option><option value="bronze">🥉 Bürünc</option></select></label></div>
    <label className="field">Nominasiya<input name="nomination" list="awardNoms" maxLength={80} defaultValue={String(f.nomination || '')} placeholder="məsələn, İlin işəgötürəni" required/><datalist id="awardNoms">{[...new Set(['İlin işəgötürəni', 'Ən yaxşı təcrübə proqramı', 'Tələbələrin seçimi', 'Gənc istedadlara investisiya', 'Karyera tədbirlərində fəallıq', 'İnnovasiya və texnologiya', ...data.awards.map(a => String(a.fields?.nomination || ''))])].filter(Boolean).map(n => <option key={n} value={n}/>)}</datalist></label>
    <div className="formGrid"><label className="field">Platformadakı şirkət<select name="company_id" defaultValue={String(f.company_id || '')}><option value="">— Siyahıda yoxdur —</option>{companies.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label className="field">və ya şirkətin adı<input name="company_name" defaultValue={String(f.company_name || '')} placeholder="Siyahıda yoxdursa yazın"/></label></div>
    <label className="field">Loqo linki (istəyə bağlı, https://)<input name="logo_url" type="url" defaultValue={String(f.logo_url || '')}/></label>
    <label className="field">Qısa əsaslandırma<textarea name="citation" rows={2} maxLength={300} defaultValue={String(f.citation || '')} placeholder="Niyə bu mükafata layiq görüldü"/></label>
    <label className="checkLine"><input type="checkbox" name="published" value="true" defaultChecked={Boolean(f.published)}/> Dərc et — əsas saytda görünsün</label>
  </>;
  if (resource === 'applications') return <>
    <div className="readGrid"><div><span>Namizəd</span><b>{row?.title}</b></div><div><span>Vakansiya</span><b>{row?.subtitle}</b></div></div>
    <label className="field">Mərhələ<select name="status" defaultValue={String(f.status || 'under_review')}><option value="applied">Müraciət edib</option><option value="under_review">Baxılır</option><option value="shortlisted">Qısa siyahı</option><option value="interview">Müsahibə</option><option value="offer">Təklif</option><option value="rejected">İmtina</option><option value="hired">İşə qəbul</option><option value="geri_goturuldu">Geri götürülüb</option></select></label>
    <label className="field">Daxili qeyd<textarea name="note" rows={3} defaultValue={String(f.note || '')}/></label>
  </>;
  if (resource === 'students' || resource === 'master_students' || resource === 'alumni') return <>
    {mode === 'create' && <div className="noticeBox">Hesab müvəqqəti şifrə ilə yaradılacaq. Şifrə bir dəfə göstəriləcək, onu şəxsə özünüz təhvil verin.{resource !== 'alumni' && ' Tələbə hesabı üçün @asoiu.edu.az e-poçtu tələb olunur.'}</div>}
    <label className="field">Ad və soyad<input name="full_name" defaultValue={String(f.full_name || row?.title || '')} required/></label>
    <div className="formGrid"><label className="field">Giriş e-poçtu<input name="email" type="email" defaultValue={String(f.email || '')} required/></label><label className="field">Şəxsi e-poçt<input name="personal_email" type="email" defaultValue={String(f.personal_email || '')}/></label></div>
    <div className="formGrid"><label className="field">Fakültə<select name="faculty_id" defaultValue={String(f.faculty_id || '')}><option value="">— Seçilməyib —</option>{lookups.faculties.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="field">İxtisas<select name="major_id" defaultValue={String(f.major_id || '')}><option value="">— Seçilməyib —</option>{lookups.faculties.map(fac => <optgroup key={fac.id} label={fac.name}>{lookups.majors.filter(m => m.faculty_id === fac.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>)}</select></label></div>
    <div className="formGrid"><label className="field">Kurs<input name="course" type="number" inputMode="numeric" min="1" max="6" defaultValue={String(f.course || 1)}/></label><label className="field">ÜOMG / GPA<input name="gpa" type="number" inputMode="decimal" min="0" max="100" step="0.01" defaultValue={String(f.gpa ?? '')}/></label></div>
    <div className="formGrid"><label className="field">Telefon<input name="phone" type="tel" defaultValue={String(f.phone || '')}/></label><label className="field">Şəhər<input name="city" defaultValue={String(f.city || 'Bakı, Azərbaycan')}/></label></div>
    <label className="field">Hesab statusu<select name="status" defaultValue={String(f.status || 'active')}><option value="active">Aktiv</option><option value="pending">Təsdiq gözləyir</option><option value="rejected">Dayandırılıb</option></select></label>
    {resource === 'alumni' && <label className="checkLine"><input type="checkbox" name="alumni_verified" value="true" defaultChecked={Boolean(f.alumni_verified)}/> Təsdiqlənmiş ADNSU məzunu</label>}
  </>;
  if (resource === 'admins') return <>
    {mode === 'create' && <div className="noticeBox">Əməkdaş hesabı müvəqqəti şifrə ilə yaradılacaq. Şifrə bir dəfə göstəriləcək. Əməkdaş ilk girişdə öz şifrəsini quracaq. Maksimum 5 aktiv admin.</div>}
    <label className="field">Ad və soyad<input name="full_name" defaultValue={String(f.full_name || row?.title || '')} required/></label>
    <label className="field">Giriş e-poçtu<input name="email" type="email" defaultValue={String(f.email || (row?.subtitle !== 'Administrator' ? row?.subtitle : '') || '')} required/></label>
    {self
      /* Öz rolunu endirmək və ya hesabını dayandırmaq paneli kilidləyə bilər — yalnız göstəririk */
      ? <><input type="hidden" name="admin_role" value={String(f.admin_role || 'super_admin')}/><input type="hidden" name="status" value="active"/>
        <div className="readGrid"><div><span>Rol</span><b>{roleLabels[String(f.admin_role || 'super_admin') as AdminRole]}</b></div><div><span>Status</span><b>Aktiv</b></div></div>
        <p className="fieldHint">Öz rolunuzu və statusunuzu dəyişə bilməzsiniz. Lazım olsa, başqa Super Admin dəyişməlidir.</p></>
      : <><fieldset className="roleChoices"><legend>Rol</legend>{(Object.keys(roleLabels) as AdminRole[]).map(r => <label key={r} className="roleChoice"><input type="radio" name="admin_role" value={r} defaultChecked={String(f.admin_role || 'reviewer') === r}/><span><b>{roleLabels[r]}</b><small>{roleDescriptions[r]}</small></span></label>)}</fieldset>
        <label className="field">Hesab statusu<select name="status" defaultValue={String(f.status || 'active')}><option value="active">Aktiv</option><option value="rejected">Dayandırılıb (girişi bağlanır)</option></select></label></>}
  </>;
  if (resource === 'network') return <>
    <div className="readBlock"><span>{row?.title}</span><p>{row?.subtitle}</p></div>
    <label className="field">Moderasiya statusu<select name="moderation_status" defaultValue={String(f.moderation_status || 'visible')}><option value="visible">Görünür</option><option value="pending">AI yoxlamasına yenidən göndər</option><option value="hidden">Gizlədilib</option></select></label>
  </>;
  if (resource === 'reports') return <>
    <div className="readBlock"><span>{row?.subtitle}</span><p>{row?.title}{row?.meta ? ` — ${row.meta}` : ''}</p></div>
    <label className="field">Şikayət statusu<select name="status" defaultValue={String(f.status || 'open')}><option value="open">Açıq</option><option value="reviewing">Yoxlanılır</option><option value="resolved">Həll edildi</option><option value="dismissed">Əsassızdır</option></select></label>
  </>;
  if (resource === 'subscriptions') return <>
    <label className="field">Paket<select name="plan_id" defaultValue={String(f.plan_id || 'free')}>{data.plans.map(p => <option key={p.id} value={p.id}>{p.title} · {p.subtitle}</option>)}</select></label>
    <label className="field">Status<select name="status" defaultValue={String(f.status || 'pending')}><option value="pending">Təsdiq gözləyir</option><option value="active">Aktiv</option><option value="past_due">Ödəniş gecikib</option><option value="cancelled">Ləğv edilib</option></select></label>
  </>;
  if (resource === 'plans') return <>
    <div className="readGrid"><div><span>Paket</span><b>{row?.title}</b></div></div>
    <div className="formGrid"><label className="field">Aylıq qiymət (AZN)<input name="monthly_price" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={String(f.monthly_price ?? 0)}/></label><label className="field">Aktiv vakansiya limiti<input name="active_vacancies" type="number" inputMode="numeric" min="-1" defaultValue={String(f.active_vacancies ?? '')} placeholder="Limitsiz üçün boş"/></label></div>
    <div className="formGrid"><label className="field">Önə çıxarılan vakansiya<input name="featured_vacancies" type="number" inputMode="numeric" min="0" defaultValue={String(f.featured_vacancies ?? 0)}/></label><label className="field">Aylıq paylaşım limiti<input name="monthly_network_posts" type="number" inputMode="numeric" min="-1" defaultValue={String(f.monthly_network_posts ?? '')} placeholder="Limitsiz üçün boş"/></label></div>
    <label className="field">Təsvir<textarea name="description" rows={2} defaultValue={String(f.description || '')}/></label>
    <div className="featureChecks">{[['candidate_search', 'Namizəd axtarışı'], ['ai_candidate_matching', 'AI uyğunluğu'], ['ai_cv_ranking', 'AI CV sıralaması'], ['advanced_analytics', 'Qabaqcıl analitika'], ['bulk_messaging', 'Kütləvi mesajlaşma'], ['premium_branding', 'Premium brend səhifəsi']].map(([key, label]) => <label className="checkLine" key={key}><input type="checkbox" name={key} value="true" defaultChecked={Boolean(f[key])}/>{label}</label>)}</div>
  </>;
  if (resource === 'payments') return <label className="field">Ödəniş statusu<select name="status" defaultValue={String(f.status || 'pending')}><option value="pending">Gözləyir</option><option value="paid">Ödənilib</option><option value="failed">Uğursuz</option><option value="refunded">Geri qaytarılıb</option><option value="cancelled">Ləğv edilib</option></select></label>;
  if (resource === 'content') return <>
    <label className="field">Başlıq<input name="title" defaultValue={row?.title} required/></label>
    <div className="formGrid"><label className="field">Məzmun açarı<input name="content_key" placeholder="home.hero" defaultValue={String(f.content_key || row?.subtitle || '')} required/></label><label className="field">Status<select name="status" defaultValue={row?.status || 'Qaralama'}><option>Qaralama</option><option>Aktiv</option><option>Bitib</option></select></label></div>
    <label className="field">Qısa məlumat<input name="summary" defaultValue={String(f.summary || '')}/></label><label className="field">Mətn<textarea name="body" rows={6} defaultValue={String(f.body || '')}/></label>
  </>;
  return null;
}

/* Redaktə hüququ olmayanda qeyd yalnız oxunur */
function ReadOnlyDetails({ row }: { row: AdminRow }) {
  return <div className="readGrid">
    <div><span>Ad</span><b>{row.title}</b></div>
    <div><span>Məlumat</span><b>{row.subtitle}</b></div>
    <div><span>Status</span><b><StatusPill status={row.status}/></b></div>
    <div><span>Tarix</span><b>{row.updatedAt}</b></div>
    <div className="wide"><span>Əlavə</span><b>{row.meta}</b></div>
  </div>;
}

type Secret = { title: string; email: string; password: string };

export default function AdminShell({ initialData, initialErrors, lookups, notice: initialNotice, currentUser, currentEmail, currentRole, currentUserId }: {
  initialData: Store; initialErrors: Partial<Record<ResourceKey, string>>; lookups: Lookups; notice?: string;
  currentUser: string; currentEmail: string; currentRole: AdminRole; currentUserId: string;
}) {
  const [active, setActive] = useState<View>('dashboard');
  const [data, setData] = useState<Store>(initialData);
  const [errors, setErrors] = useState(initialErrors);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; row?: AdminRow } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState<{ tone: 'good' | 'bad'; text: string } | null>(initialNotice ? { tone: 'good', text: initialNotice } : null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);
  /* Açıq pəncərə və ya menyu varkən arxa fon sürüşməsin (telefon) */
  useEffect(() => { document.body.style.overflow = modal || menuOpen || secret || resetOpen ? 'hidden' : ''; }, [modal, menuOpen, secret, resetOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { setModal(null); setMenuOpen(false); setUserMenu(false); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const current = active === 'dashboard' ? [] : data[active];
  const counts = useMemo(() => Object.fromEntries(statuses.map(s => [s, current.filter(r => r.status === s).length])) as Record<Status, number>, [current]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('az-AZ');
    return current.filter(row => (!statusFilter || row.status === statusFilter)
      && (!q || `${row.title} ${row.subtitle} ${row.meta}`.toLocaleLowerCase('az-AZ').includes(q)));
  }, [current, query, statusFilter]);

  const attention = {
    jobs: data.pending_jobs.length,
    companies: data.companies.filter(x => x.status === 'Yoxlamada').length,
    reports: data.reports.filter(x => x.status !== 'Bitib').length,
    payments: data.payments.filter(x => x.status === 'Yoxlamada').length,
    posts: data.network.filter(x => x.status === 'Yoxlamada').length,
    alumni: data.alumni.filter(x => x.status === 'Yoxlamada').length
  };
  const badge = (key: View) => key === 'pending_jobs' ? attention.jobs : key === 'reports' ? attention.reports : key === 'companies' ? attention.companies : key === 'payments' ? attention.payments : 0;
  const planPrice = new Map(data.plans.map(plan => [plan.id, Number(plan.fields?.monthly_price || 0)]));
  const monthlyRevenue = data.subscriptions.filter(x => x.status === 'Aktiv').reduce((sum, s) => sum + (planPrice.get(String(s.fields?.plan_id || 'free')) || 0), 0);
  const visibleNav = nav.filter(item => item.key !== 'admins' || currentRole === 'super_admin');

  function go(view: View) {
    setActive(view); setQuery(''); setStatusFilter(''); setMenuOpen(false); setUserMenu(false);
    window.scrollTo({ top: 0 });
  }
  function openCreate(resource: ResourceKey) { setFormError(''); setActive(resource); setModal({ mode: 'create' }); }

  async function refreshResource(resource: ResourceKey) {
    const response = await fetch(`/api/admin/${resource}`, { cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) { window.location.href = '/login'; return; }
    if (!response.ok) throw new Error(result.error || 'Məlumat yenilənmədi');
    setData(previous => ({ ...previous, [resource]: result }));
    setErrors(previous => ({ ...previous, [resource]: undefined }));
    /* Əlaqəli siyahılar: təsdiq gözləyənlər ↔ vakansiyalar */
    const related: ResourceKey[] = resource === 'jobs' ? ['pending_jobs'] : resource === 'pending_jobs' ? ['jobs'] : [];
    for (const key of [...related, 'audit_logs' as ResourceKey]) {
      if (key === resource) continue;
      const r = await fetch(`/api/admin/${key}`, { cache: 'no-store' });
      if (r.ok) { const rows = await r.json(); setData(previous => ({ ...previous, [key]: rows })); }
    }
  }

  async function saveRow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active === 'dashboard' || !modal) return;
    setBusy(true); setFormError('');
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) if (!multiFields.includes(key)) payload[key] = value;
    multiFields.forEach(key => { if (form.has(key) || active === 'jobs' || active === 'pending_jobs') payload[key] = form.getAll(key).join(','); });
    if ('active' in payload) payload.active = payload.active === 'true';
    const endpoint = modal.mode === 'edit' && modal.row ? `/api/admin/${active}/${modal.row.id}` : `/api/admin/${active}`;
    try {
      const response = await fetch(endpoint, { method: modal.mode === 'edit' ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (response.status === 401) { window.location.href = '/login'; return; }
      if (!response.ok) throw new Error(result.error || 'Əməliyyat alınmadı');
      await refreshResource(active);
      setModal(null);
      if (result.temporaryPassword) setSecret({ title: 'Hesab yaradıldı', email: String(result.email || payload.email || ''), password: result.temporaryPassword });
      else setToast({ tone: 'good', text: modal.mode === 'create' ? 'Əlavə edildi.' : 'Dəyişikliklər yadda saxlanıldı.' });
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : 'Əməliyyat alınmadı'); }
    finally { setBusy(false); }
  }

  async function removeRow(row: AdminRow) {
    if (active === 'dashboard') return;
    if (!window.confirm(`“${row.title}” qeydi silinsin? Bu əməliyyat geri qaytarılmır.`)) return;
    setBusy(true); setFormError('');
    try {
      const response = await fetch(`/api/admin/${active}/${row.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Silmək mümkün olmadı');
      await refreshResource(active);
      setModal(null);
      setToast({ tone: 'good', text: 'Qeyd silindi.' });
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : 'Silmək mümkün olmadı'); }
    finally { setBusy(false); }
  }

  async function resetPassword(row: AdminRow) {
    if (active === 'dashboard') return;
    if (!window.confirm(`${row.title} üçün yeni müvəqqəti şifrə yaradılsın? Köhnə şifrə dərhal işləməyəcək.`)) return;
    setBusy(true); setFormError('');
    try {
      const response = await fetch(`/api/admin/${active}/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ __action: 'reset_password' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Şifrə sıfırlanmadı');
      setModal(null);
      setSecret({ title: 'Şifrə sıfırlandı', email: String(result.email || ''), password: result.temporaryPassword });
      await refreshResource(active);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : 'Şifrə sıfırlanmadı'); }
    finally { setBusy(false); }
  }

  async function resetPlatform() {
    if (resetPhrase !== 'SIFIRLA') return;
    setBusy(true); setFormError('');
    try {
      const response = await fetch('/api/admin/system/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: resetPhrase }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sıfırlama alınmadı');
      setResetOpen(false); setResetPhrase('');
      window.location.reload();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : 'Sıfırlama alınmadı'); }
    finally { setBusy(false); }
  }

  const resource = active === 'dashboard' ? null : active;
  const canCreate = resource ? can(currentRole, 'create', resource) : false;
  const canEdit = resource ? can(currentRole, 'edit', resource) : false;
  const canDelete = resource ? can(currentRole, 'delete', resource) : false;
  const editingSelf = resource === 'admins' && modal?.row?.id === currentUserId;
  const subtitle = active === 'dashboard' ? 'Platformanın bugünkü vəziyyəti'
    : active === 'admins' ? `${data.admins.filter(row => row.status === 'Aktiv').length}/5 aktiv admin`
      : `${data[active].length} qeyd`;

  const NavButton = ({ item }: { item: NavItem }) => { const Icon = item.icon; const n = badge(item.key); return <button className={active === item.key ? 'active' : ''} onClick={() => go(item.key)} aria-current={active === item.key ? 'page' : undefined}><Icon size={18}/><span>{item.label}</span>{n > 0 && <em>{n}</em>}</button>; };

  return <div className="adminApp">
    {menuOpen && <div className="drawerBackdrop" onClick={() => setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen ? 'sidebarOpen' : ''}`} aria-label="Bölmələr">
      <div className="brand"><span className="brandMark">A</span><div><b>ASOIU Karyera</b><small>İdarəetmə paneli</small></div><button className="mobileClose" aria-label="Menyunu bağla" onClick={() => setMenuOpen(false)}><X size={20}/></button></div>
      <nav>{groups.map(group => { const items = visibleNav.filter(n => n.group === group); return items.length ? <div className="navGroup" key={group}><p>{group}</p>{items.map(item => <NavButton key={item.key} item={item}/>)}</div> : null; })}</nav>
      <div className="sidebarFoot">
        <div className="miniAvatar">{initialsOf(currentUser)}</div>
        <div className="who"><b>{currentUser}</b><span>{roleLabels[currentRole]}</span></div>
        <Link href="/account/password" className="iconButton" aria-label="Şifrəni dəyiş" title="Şifrəni dəyiş"><KeyRound size={17}/></Link>
        <form action={logout}><button className="iconButton" aria-label="Çıxış" title="Çıxış"><LogOut size={17}/></button></form>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <button className="menuButton" aria-label="Menyunu aç" onClick={() => setMenuOpen(true)}><Menu size={22}/></button>
        <div className="pageIdentity"><h1>{active === 'dashboard' ? 'İcmal' : titles[active]}</h1><p>{subtitle}</p></div>
        <div className="topActions">
          {canCreate && <button className="primaryButton hideMobile" onClick={() => { setFormError(''); setModal({ mode: 'create' }); }}><Plus size={18}/>Yeni {singular[active as ResourceKey] || 'qeyd'}</button>}
          <div className="userMenuWrap">
            <button className="profileButton" aria-label="Profil menyusu" aria-expanded={userMenu} onClick={() => setUserMenu(v => !v)}><span>{initialsOf(currentUser)}</span><div><b>{currentUser}</b><small>{roleLabels[currentRole]}</small></div></button>
            {userMenu && <div className="userMenu" role="menu">
              <div className="userMenuHead"><b>{currentUser}</b><small>{currentEmail}</small><span className="roleTag">{roleLabels[currentRole]}</span></div>
              <Link href="/account/password" role="menuitem"><KeyRound size={16}/>Şifrəni dəyiş</Link>
              <form action={logout}><button role="menuitem"><LogOut size={16}/>Çıxış</button></form>
            </div>}
          </div>
        </div>
      </header>

      <section className="content">
        {active === 'dashboard' ? <>
          <div className="welcome"><div><span>Salam, {currentUser.split(' ')[0]}</span><h2>Bu gün nəyə baxmaq lazımdır?</h2><p>Gözləyən işlər aşağıdadır. Qalan bölmələr menyudadır.</p></div></div>

          <div className="attentionGrid">
            {[
              { label: 'Təsdiq gözləyən elan', n: attention.jobs, view: 'pending_jobs' as View, icon: Clock3 },
              { label: 'Təsdiq gözləyən şirkət', n: attention.companies, view: 'companies' as View, icon: Building2 },
              { label: 'Açıq şikayət', n: attention.reports, view: 'reports' as View, icon: Flag },
              { label: 'Gözləyən ödəniş', n: attention.payments, view: 'payments' as View, icon: CreditCard },
              { label: 'AI yoxlamasında paylaşım', n: attention.posts, view: 'network' as View, icon: MessageSquareText },
              { label: 'Təsdiq gözləyən məzun', n: attention.alumni, view: 'alumni' as View, icon: UserCheck }
            ].map(a => { const Icon = a.icon; return <button key={a.label} className={`attentionCard ${a.n ? 'hot' : ''}`} onClick={() => go(a.view)}>
              <Icon size={20}/><span><strong>{a.n}</strong>{a.label}</span><ChevronRight size={18}/>
            </button>; })}
          </div>

          <div className="statsGrid">
            <Stat label="Aktiv vakansiyalar" value={String(data.jobs.filter(x => x.status === 'Aktiv').length)} note={`${data.jobs.length} ümumi`} icon={BriefcaseBusiness} tone="blue" onClick={() => go('jobs')}/>
            <Stat label="Müraciətlər" value={String(data.applications.length)} note={`${data.applications.filter(x => x.status === 'Yoxlamada').length} baxılmayıb`} icon={FileCheck2} tone="amber" onClick={() => go('applications')}/>
            <Stat label="Tələbələr" value={String(data.students.length)} note={`${data.master_students.length} magistr · ${data.alumni.length} məzun`} icon={Users} tone="green" onClick={() => go('students')}/>
            <Stat label="Şirkətlər" value={String(data.companies.filter(x => x.status === 'Aktiv').length)} note={`${data.companies.length} ümumi`} icon={Building2} tone="violet" onClick={() => go('companies')}/>
            <Stat label="Aktiv abunəliklər" value={String(data.subscriptions.filter(x => x.status === 'Aktiv').length)} note={`Aylıq ${monthlyRevenue.toFixed(2)} AZN`} icon={TrendingUp} tone="green" onClick={() => go('subscriptions')}/>
            <Stat label="Yaxın tədbirlər" value={String(data.events.filter(x => x.status === 'Aktiv').length)} note={`${data.events.length} ümumi`} icon={CalendarDays} tone="blue" onClick={() => go('events')}/>
          </div>

          <div className="dashboardGrid">
            <section className="panel"><div className="panelHead"><div><h3>Son müraciətlər</h3><p>Ən yeni 6 müraciət</p></div><button className="linkButton" onClick={() => go('applications')}>Hamısı<ChevronRight size={16}/></button></div>
              <div className="compactRows">{data.applications.slice(0, 6).map(row => <button className="compactRow" key={row.id} onClick={() => { setActive('applications'); setFormError(''); setModal({ mode: 'edit', row }); }}><span className="avatarCircle">{initialsOf(row.title)}</span><span className="who"><b>{row.title}</b><small>{row.subtitle}</small></span><StatusPill status={row.status}/></button>)}
                {data.applications.length === 0 && <p className="emptyLine">Hələ müraciət yoxdur.</p>}</div>
            </section>
            <section className="panel"><div className="panelHead"><div><h3>Tez əlavə et</h3><p>İcazəniz olan əməliyyatlar</p></div></div>
              <div className="quickGrid">{(['jobs', 'events', 'benefits', 'awards', 'companies', 'content'] as ResourceKey[]).filter(k => can(currentRole, 'create', k)).map(k => { const item = nav.find(n => n.key === k)!; const Icon = item.icon; return <button key={k} onClick={() => openCreate(k)}><Icon size={20}/><span><b>Yeni {singular[k]}</b><small>{data[k].length} mövcud</small></span><Plus size={16}/></button>; })}
                {!(['jobs', 'events', 'benefits', 'awards', 'companies', 'content'] as ResourceKey[]).some(k => can(currentRole, 'create', k)) && <p className="emptyLine">Sizin rolunuz ({roleLabels[currentRole]}) əlavə etməyə icazə vermir.</p>}</div>
            </section>
          </div>

          {currentRole === 'super_admin' && <section className="panel dangerZone"><div><span>SİSTEM NƏZARƏTİ</span><h3>Platforma məlumatlarını sıfırla</h3><p>Tələbə, şirkət, vakansiya, müraciət, tədbir, şəbəkə və analitika məlumatlarını silir. Admin girişləri, fakültə/ixtisas siyahıları və paketlər saxlanılır.</p></div><button className="dangerButton" onClick={() => { setFormError(''); setResetOpen(true); }}><RotateCcw size={18}/>Sıfırlama panelini aç</button></section>}
        </> : <>
          {errors[active] && <div className="errorBox" role="alert"><AlertTriangle size={18}/> Bu bölmə yüklənmədi: {errors[active]} <button className="linkButton" onClick={() => refreshResource(active).catch(e => setToast({ tone: 'bad', text: e.message }))}>Yenidən cəhd et</button></div>}
          <div className="tableTools">
            <div className="searchBox"><Search size={18}/><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`${titles[active]} üzrə axtar…`} aria-label="Axtarış"/>{query && <button type="button" aria-label="Axtarışı təmizlə" onClick={() => setQuery('')}><X size={16}/></button>}</div>
            <div className="filterChips" role="tablist" aria-label="Status filtri">
              <button role="tab" aria-selected={statusFilter === ''} onClick={() => setStatusFilter('')}>Hamısı <em>{current.length}</em></button>
              {statuses.filter(s => counts[s] > 0 || statusFilter === s).map(s => <button role="tab" key={s} aria-selected={statusFilter === s} onClick={() => setStatusFilter(s)}>{s} <em>{counts[s]}</em></button>)}
            </div>
          </div>
          {!canEdit && !canDelete && <p className="roleNote"><Eye size={15}/> Bu bölmədə yalnız baxış hüququnuz var ({roleLabels[currentRole]}).</p>}
          <section className="panel tablePanel">
            <div className="dataTable">
              <div className="tableHeader"><span>Ad və məlumat</span><span>Status</span><span>Əlavə məlumat</span><span>Tarix</span><span/></div>
              {filtered.map(row => <button type="button" className="tableRow" key={row.id} onClick={() => { setFormError(''); setModal({ mode: 'edit', row }); }}>
                <span className="mainCell"><span className="resourceIcon">{initialsOf(row.title)}</span><span><b>{row.title}</b><small>{row.subtitle}</small></span></span>
                <StatusPill status={row.status}/>
                <span className="metaCell">{row.meta}</span>
                <time>{row.updatedAt}</time>
                <span className="rowAction">{canEdit ? <Pencil size={16}/> : <Eye size={16}/>}</span>
              </button>)}
              {filtered.length === 0 && <div className="emptyState"><Search size={28}/><b>{current.length ? 'Nəticə tapılmadı' : 'Hələ qeyd yoxdur'}</b><span>{current.length ? 'Axtarış sözünü və ya filtri dəyişin.' : canCreate ? 'Yuxarıdakı “+” düyməsi ilə ilk qeydi əlavə edin.' : 'Bu bölmə hələ boşdur.'}</span></div>}
            </div>
          </section>
        </>}
      </section>
    </main>

    {/* Telefon: aşağı menyu və üzən "+" düyməsi */}
    <nav className="bottomNav" aria-label="Əsas bölmələr">
      {bottomNav.map(key => { const item = nav.find(n => n.key === key)!; const Icon = item.icon; const n = badge(key); return <button key={key} className={active === key ? 'active' : ''} onClick={() => go(key)}><Icon size={21}/><span>{key === 'pending_jobs' ? 'Təsdiq' : key === 'network' ? 'Şəbəkə' : item.label}</span>{n > 0 && <em>{n}</em>}</button>; })}
      <button onClick={() => setMenuOpen(true)}><Menu size={21}/><span>Menyu</span></button>
    </nav>
    {canCreate && !modal && <button className="fab" aria-label={`Yeni ${singular[active as ResourceKey] || 'qeyd'}`} onClick={() => { setFormError(''); setModal({ mode: 'create' }); }}><Plus size={24}/></button>}

    {modal && resource && <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setModal(null); }}>
      <form className="modal" onSubmit={saveRow} noValidate={false}>
        <div className="modalHead"><div><h2>{modal.mode === 'create' ? `Yeni ${singular[resource] || 'qeyd'}` : canEdit ? 'Redaktə' : 'Ətraflı'}</h2><p>{titles[resource]}</p></div><button type="button" className="iconButton" aria-label="Pəncərəni bağla" onClick={() => setModal(null)} disabled={busy}><X size={20}/></button></div>
        <div className="modalBody">
          {(modal.mode === 'create' ? canCreate : canEdit)
            ? <EditorFields resource={resource} row={modal.row} data={data} lookups={lookups} mode={modal.mode} self={editingSelf}/>
            : modal.row && <ReadOnlyDetails row={modal.row}/>}
          {resource === 'admins' && modal.mode === 'edit' && modal.row && !editingSelf && <div className="noticeBox subtle"><KeyRound size={16}/> Əməkdaş şifrəni unudubsa, “Şifrəni sıfırla” ilə yeni müvəqqəti şifrə verin.</div>}
          {formError && <div className="errorBox" role="alert">{formError}</div>}
        </div>
        <div className="modalActions">
          {modal.mode === 'edit' && canDelete && modal.row && !editingSelf && <button type="button" className="dangerButton" onClick={() => modal.row && removeRow(modal.row)} disabled={busy}><Trash2 size={17}/>Sil</button>}
          {modal.mode === 'edit' && modal.row && people.has(resource) && can(currentRole, 'create', resource) && !editingSelf && <button type="button" className="secondaryButton" onClick={() => modal.row && resetPassword(modal.row)} disabled={busy}><KeyRound size={17}/>Şifrəni sıfırla</button>}
          <span className="spacer"/>
          <button type="button" className="secondaryButton" onClick={() => setModal(null)} disabled={busy}>{(modal.mode === 'create' ? canCreate : canEdit) ? 'Ləğv et' : 'Bağla'}</button>
          {(modal.mode === 'create' ? canCreate : canEdit) && <button className="primaryButton" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin"/> : <Save size={17}/>}{busy ? 'Saxlanılır…' : 'Yadda saxla'}</button>}
        </div>
      </form>
    </div>}

    {secret && <div className="modalBackdrop"><div className="modal secretModal" role="dialog" aria-modal="true">
      <div className="modalHead"><div><h2>{secret.title}</h2><p>Müvəqqəti şifrə yalnız indi göstərilir</p></div></div>
      <div className="modalBody">
        <div className="secretBox"><span>E-poçt</span><b>{secret.email}</b><span>Müvəqqəti şifrə</span><code>{secret.password}</code></div>
        <div className="noticeBox">Bu məlumatı şəxsə özünüz, təhlükəsiz yolla (üzbəüz və ya telefonla) çatdırın. Əməkdaş ilk girişdə öz şifrəsini quracaq. Pəncərəni bağladıqdan sonra şifrəni yenidən görmək mümkün deyil.</div>
      </div>
      <div className="modalActions"><span className="spacer"/>
        <button type="button" className="secondaryButton" onClick={() => { navigator.clipboard.writeText(`${secret.email}\n${secret.password}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>{copied ? <Check size={17}/> : <Copy size={17}/>}{copied ? 'Kopyalandı' : 'Kopyala'}</button>
        <button type="button" className="primaryButton" onClick={() => setSecret(null)}>Hazırdır</button>
      </div>
    </div></div>}

    {resetOpen && <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setResetOpen(false); }}><div className="modal resetModal">
      <div className="modalHead"><div><h2>Platformanı sıfırla</h2><p>Bu əməliyyat geri qaytarılmır.</p></div><button type="button" className="iconButton" aria-label="Pəncərəni bağla" onClick={() => setResetOpen(false)} disabled={busy}><X size={20}/></button></div>
      <div className="modalBody">
        <div className="resetWarning"><Trash2 size={22}/><div><b>Silinəcək məlumatlar</b><p>Adi istifadəçilər və şirkət hesabları, elanlar, müraciətlər, tədbirlər, paylaşımlar, CV və müsahibə tarixçəsi, güzəştlər və sayt məzmunu.</p></div></div>
        <div className="noticeBox">Admin hesabları, fakültə və ixtisas siyahıları, həmçinin paketlər saxlanılır.</div>
        <label className="field">Təsdiq üçün <b>SIFIRLA</b> yazın<input value={resetPhrase} onChange={event => setResetPhrase(event.target.value)} autoComplete="off"/></label>
        {formError && <div className="errorBox">{formError}</div>}
      </div>
      <div className="modalActions"><span className="spacer"/><button type="button" className="secondaryButton" onClick={() => setResetOpen(false)} disabled={busy}>Ləğv et</button><button type="button" className="dangerButton solid" onClick={resetPlatform} disabled={busy || resetPhrase !== 'SIFIRLA'}><RotateCcw size={17}/>{busy ? 'Sıfırlanır…' : 'Hər şeyi sıfırla'}</button></div>
    </div></div>}

    {toast && <div className={`toast ${toast.tone}`} role="status" onClick={() => setToast(null)}>{toast.tone === 'good' ? <Check size={18}/> : <AlertTriangle size={18}/>}{toast.text}</div>}
  </div>;
}
