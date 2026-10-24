import { createClient } from '@/lib/supabase/server';
import type { AdminRole, AdminRow, Lookups, ResourceKey, Status } from '@/lib/types';

export type AdminStore = Record<ResourceKey, AdminRow[]>;
export type AdminLoad = { data: AdminStore; errors: Partial<Record<ResourceKey, string>>; lookups: Lookups };
export type AdminContext = {
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>;
  userId: string;
  role: AdminRole;
  fullName: string;
  email: string;
  /* Super Admin müvəqqəti şifrə verəndə ilk girişdə yeni şifrə tələb olunur */
  mustChangePassword: boolean;
};

export const resourceKeys: ResourceKey[] = ['jobs', 'pending_jobs', 'companies', 'events', 'benefits', 'awards', 'ads', 'applications', 'students', 'master_students', 'alumni', 'network', 'reports', 'moderation_logs', 'subscriptions', 'plans', 'payments', 'cv_analytics', 'interview_analytics', 'ai_usage', 'notifications', 'content', 'admins', 'audit_logs'];

const adminRoles: AdminRole[] = ['super_admin', 'manager', 'editor', 'reviewer'];

function dateLabel(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('az-AZ', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function jobStatus(value: string): Status {
  if (value === 'approved' || value === 'published') return 'Aktiv';
  if (value === 'draft') return 'Qaralama';
  if (['closed', 'rejected', 'expired', 'archived'].includes(value)) return 'Bitib';
  return 'Yoxlamada';
}

function accountStatus(value: string): Status {
  if (value === 'active') return 'Aktiv';
  if (value === 'rejected') return 'Bitib';
  return 'Yoxlamada';
}

function applicationStatus(value: string): Status {
  if (['teklif', 'musahibe', 'shortlisted', 'interview', 'offer', 'hired'].includes(value)) return 'Aktiv';
  if (['imtina', 'geri_goturuldu', 'rejected'].includes(value)) return 'Bitib';
  return 'Yoxlamada';
}

export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === 'string' ? claims.sub : '';
  if (!userId) return null;
  const metadata = claims?.app_metadata as Record<string, unknown> | undefined;
  const requestedRole = metadata?.admin_role;
  if (!adminRoles.includes(requestedRole as AdminRole)) return null;
  const { data: profile } = await supabase.from('profiles').select('full_name,email,role,status').eq('id', userId).single();
  if (!profile || profile.role !== 'admin' || profile.status !== 'active') return null;
  const role = requestedRole as AdminRole;
  return {
    supabase, userId, role,
    fullName: profile.full_name || 'Karyera Mərkəzi',
    email: profile.email || (typeof claims?.email === 'string' ? claims.email : ''),
    mustChangePassword: metadata?.must_change_password === true
  };
}

export async function loadLookups(context: AdminContext): Promise<Lookups> {
  const [faculties, majors] = await Promise.all([
    context.supabase.from('faculties').select('id,name').order('sort_order'),
    context.supabase.from('majors').select('id,name,faculty_id').order('name')
  ]);
  return { faculties: faculties.data || [], majors: majors.data || [] };
}

function labelMaps(lookups?: Lookups) {
  const faculty = new Map((lookups?.faculties || []).map(f => [f.id, f.name]));
  const major = new Map((lookups?.majors || []).map(m => [m.id, m.name]));
  return { faculty: (id?: string | null) => (id && faculty.get(id)) || id || '', major: (id?: string | null) => (id && major.get(id)) || id || '' };
}

const tierLabel: Record<string, string> = { gold: 'Qızıl', silver: 'Gümüş', bronze: 'Bürünc' };
const jobTypeLabel: Record<string, string> = { is: 'İş', tecrube: 'Təcrübə', graduate: 'Məzun proqramı', konullu: 'Könüllülük' };
const placementLabel: Record<string, string> = { landing_hero: 'Ana səhifə banneri', landing_strip: 'Ana səhifə sponsor kartı', dashboard: 'Kabinetdə' };
/* timestamptz → Bakı vaxtı ilə "YYYY-MM-DDTHH:MM" (datetime-local sahəsi üçün) */
function bakuLocal(value?: string | null) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/* Profil şəkilləri şəxsi "avatars" bucket-indədir. Admin üçün yalnız AI yoxlamasından
   keçmiş şəklin (avatar_path) qısa müddətli imzalı linki yaradılır. */
async function signAvatars(context: AdminContext, paths: unknown[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0))];
  if (!list.length) return {};
  const { data, error } = await context.supabase.storage.from('avatars').createSignedUrls(list, 6 * 3600);
  if (error) return {};
  const out: Record<string, string> = {};
  (data || []).forEach(item => { if (item.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl; });
  return out;
}
const logoOf = (url: unknown) => typeof url === 'string' && /^https:\/\//i.test(url) ? url : undefined;
const photo = (pics: Record<string, string>, path: unknown) => (typeof path === 'string' && pics[path]) || undefined;

export async function loadResource(context: AdminContext, resource: ResourceKey, lookups?: Lookups): Promise<AdminRow[]> {
  const { supabase } = context;
  const label = labelMaps(lookups);
  if (resource === 'jobs' || resource === 'pending_jobs') {
    const { data, error } = await supabase.from('jobs').select('id,title,type,mode,location,deadline,summary,department,duties,requirements,skills,preferred_skills,faculty_ids,major_ids,experience_level,salary_min,salary_max,currency,salary_visible,positions,application_method,application_url,rejection_reason,changes_requested,status,company_id,created_at,companies(name)').order('created_at', { ascending: false });
    if (error) throw error;
    const rows = resource === 'pending_jobs' ? (data || []).filter((row: any) => ['pending', 'pending_approval', 'changes_requested'].includes(row.status)) : (data || []);
    return rows.map((row: any) => ({
      id: row.id, title: row.title, subtitle: `${row.companies?.name || 'Şirkət'} · ${jobTypeLabel[row.type] || row.type || 'Elan'}`,
      status: jobStatus(row.status), meta: `${row.location || 'Bakı'} · son tarix ${dateLabel(row.deadline)}`,
      updatedAt: dateLabel(row.created_at), fields: { company_id: row.company_id, type: row.type, mode: row.mode, location: row.location, deadline: row.deadline, summary: row.summary, department: row.department, duties: (row.duties || []).join('\n'), requirements: (row.requirements || []).join('\n'), skills: (row.skills || []).join(', '), preferred_skills: (row.preferred_skills || []).join(', '), faculty_ids: (row.faculty_ids || []).join(', '), major_ids: (row.major_ids || []).join(', '), experience_level: row.experience_level, salary_min: row.salary_min, salary_max: row.salary_max, currency: row.currency, salary_visible: row.salary_visible, positions: row.positions, application_method: row.application_method, application_url: row.application_url, rejection_reason: row.rejection_reason, changes_requested: row.changes_requested, status: row.status }
    }));
  }
  if (resource === 'companies') {
    const { data, error } = await supabase.from('companies').select('id,name,sector,email,phone,website,about,status,verified,company_size,address,logo_url,contact,contact_position,contact_email,contact_phone,created_at').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.name, subtitle: row.sector || 'Şirkət', status: accountStatus(row.status),
      meta: row.website || row.email || 'Əlaqə məlumatı yoxdur', updatedAt: dateLabel(row.created_at),
      avatar: logoOf(row.logo_url), avatarKind: 'logo' as const,
      fields: { email: row.email, phone: row.phone, website: row.website, about: row.about, status: row.status, verified: row.verified, company_size: row.company_size, address: row.address, logo_url: row.logo_url, contact: row.contact, contact_position: row.contact_position, contact_email: row.contact_email, contact_phone: row.contact_phone }
    }));
  }
  if (resource === 'events') {
    const { data, error } = await supabase.from('events').select('id,title,kind,starts_at,place,seats,description,organizers,image_url,created_at').order('starts_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.title, subtitle: row.kind || 'Tədbir', status: new Date(row.starts_at) >= new Date() ? 'Aktiv' : 'Bitib',
      meta: `${row.place || 'Məkan qeyd edilməyib'} · ${row.seats || 0} yer`, updatedAt: dateLabel(row.starts_at),
      fields: { kind: row.kind, starts_at: bakuLocal(row.starts_at), place: row.place, seats: row.seats, description: row.description, organizers: (row.organizers || []).join(', '), image_url: row.image_url }
    }));
  }
  if (resource === 'benefits') {
    const { data, error } = await supabase.from('benefits').select('id,title,description,discount_label,valid_from,valid_to,active,created_at,partner_id,benefit_partners(name,logo_url)').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.title, subtitle: row.benefit_partners?.name || 'Tərəfdaş', status: row.active ? 'Aktiv' : 'Bitib',
      avatar: logoOf(row.benefit_partners?.logo_url), avatarKind: 'logo' as const,
      meta: `${row.discount_label || 'Güzəşt'} · ${row.valid_to ? dateLabel(row.valid_to) : 'müddətsiz'}`, updatedAt: dateLabel(row.created_at),
      fields: { partner_id: row.partner_id, partner_name: row.benefit_partners?.name, partner_logo_url: row.benefit_partners?.logo_url, description: row.description, discount_label: row.discount_label, valid_from: row.valid_from, valid_to: row.valid_to, active: row.active }
    }));
  }
  if (resource === 'applications') {
    const { data, error } = await supabase.from('applications').select('id,status,note,created_at,profiles!applications_student_id_fkey(full_name,avatar_path),jobs(title)').order('created_at', { ascending: false });
    if (error) throw error;
    const pics = await signAvatars(context, (data || []).map((row: any) => row.profiles?.avatar_path));
    return (data || []).map((row: any) => ({
      id: row.id, title: row.profiles?.full_name || 'Tələbə', subtitle: row.jobs?.title || 'Vakansiya', status: applicationStatus(row.status),
      avatar: photo(pics, row.profiles?.avatar_path), avatarKind: 'photo' as const,
      meta: row.note || 'Qeyd yoxdur', updatedAt: dateLabel(row.created_at), fields: { status: row.status, note: row.note }
    }));
  }
  if (resource === 'students') {
    const { data, error } = await supabase.from('profiles').select('id,full_name,email,personal_email,phone,city,role,status,account_status,faculty_id,major_id,course,gpa,alumni_verified,avatar_path,updated_at').eq('role', 'student').eq('account_status', 'student').order('updated_at', { ascending: false });
    if (error) throw error;
    const pics = await signAvatars(context, (data || []).map((row: any) => row.avatar_path));
    return (data || []).map((row: any) => ({
      id: row.id, title: row.full_name || 'Tələbə', subtitle: `${row.course || '—'}. kurs · ${label.major(row.major_id) || 'İxtisas qeyd edilməyib'}`,
      avatar: photo(pics, row.avatar_path), avatarKind: 'photo' as const,
      status: accountStatus(row.status), meta: row.gpa ? `ÜOMG: ${row.gpa}` : (row.email || 'Profil məlumatı'), updatedAt: dateLabel(row.updated_at),
      fields: { full_name: row.full_name, email: row.email, personal_email: row.personal_email, phone: row.phone, city: row.city, faculty_id: row.faculty_id, major_id: row.major_id, course: row.course, gpa: row.gpa, status: row.status, account_status: row.account_status, alumni_verified: row.alumni_verified }
    }));
  }
  if (resource === 'master_students' || resource === 'alumni') {
    const alumni = resource === 'alumni';
    let query = supabase.from('profiles').select('id,full_name,email,personal_email,phone,city,role,status,account_status,faculty_id,major_id,course,gpa,alumni_verified,avatar_path,updated_at');
    query = alumni ? query.eq('role', 'graduate') : query.eq('role', 'student').eq('account_status', 'master_student');
    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) throw error;
    const pics = await signAvatars(context, (data || []).map((row: any) => row.avatar_path));
    return (data || []).map((row: any) => ({
      id: row.id, title: row.full_name || (alumni ? 'Məzun' : 'Magistr'),
      avatar: photo(pics, row.avatar_path), avatarKind: 'photo' as const,
      subtitle: `${label.major(row.major_id) || 'İxtisas qeyd edilməyib'} · ${row.email || ''}`,
      status: accountStatus(row.status), meta: alumni ? (row.alumni_verified ? 'Təsdiqlənmiş məzun' : 'Təsdiq gözləyir') : `${row.course || '—'}. kurs`,
      updatedAt: dateLabel(row.updated_at), fields: { full_name: row.full_name, email: row.email, personal_email: row.personal_email, phone: row.phone, city: row.city, faculty_id: row.faculty_id, major_id: row.major_id, course: row.course, gpa: row.gpa, status: row.status, account_status: row.account_status, alumni_verified: row.alumni_verified }
    }));
  }
  if (resource === 'network') {
    const { data, error } = await supabase.from('posts').select('id,body,kind,tags,moderation_status,created_at,profiles!posts_author_id_fkey(full_name,avatar_path)').order('created_at', { ascending: false });
    if (error) throw error;
    const pics = await signAvatars(context, (data || []).map((row: any) => row.profiles?.avatar_path));
    return (data || []).map((row: any) => ({ id: row.id, title: row.profiles?.full_name || 'İstifadəçi', subtitle: row.body, avatar: photo(pics, row.profiles?.avatar_path), avatarKind: 'photo' as const, status: row.moderation_status === 'visible' ? 'Aktiv' : row.moderation_status === 'hidden' ? 'Bitib' : 'Yoxlamada', meta: `${row.kind || 'general'} · ${(row.tags || []).map((x: string) => `#${x}`).join(' ')}`, updatedAt: dateLabel(row.created_at), fields: { moderation_status: row.moderation_status, kind: row.kind } }));
  }
  if (resource === 'reports') {
    const { data, error } = await supabase.from('reports').select('id,target_type,target_id,reason,details,status,created_at,profiles!reports_reporter_id_fkey(full_name)').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.reason, subtitle: `${row.target_type} · ${row.profiles?.full_name || 'İstifadəçi'}`, status: row.status === 'resolved' || row.status === 'dismissed' ? 'Bitib' : row.status === 'reviewing' ? 'Yoxlamada' : 'Aktiv', meta: row.details || String(row.target_id), updatedAt: dateLabel(row.created_at), fields: { status: row.status } }));
  }
  if (resource === 'subscriptions') {
    const { data, error } = await supabase.from('subscriptions').select('id,plan_id,status,requested_at,starts_at,ends_at,companies(name),plans(name,monthly_price)').order('requested_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.companies?.name || 'Şirkət', subtitle: `${row.plans?.name || row.plan_id} · ${row.plans?.monthly_price ?? 0} AZN/ay`, status: row.status === 'active' ? 'Aktiv' : row.status === 'pending' ? 'Yoxlamada' : 'Bitib', meta: row.ends_at ? `Bitmə: ${dateLabel(row.ends_at)}` : 'Aylıq paket', updatedAt: dateLabel(row.requested_at), fields: { plan_id: row.plan_id, status: row.status } }));
  }
  if (resource === 'plans') {
    const [{ data: plans, error }, { data: features, error: featureError }] = await Promise.all([
      supabase.from('plans').select('*').order('sort_order'),
      supabase.from('plan_features').select('plan_id,feature_key,enabled,limit_value')
    ]);
    if (error || featureError) throw error || featureError;
    const featureMap = new Map((features || []).map((feature: any) => [`${feature.plan_id}:${feature.feature_key}`, feature]));
    return (plans || []).map((row: any) => ({ id: row.id, title: row.name, subtitle: `${row.monthly_price} ${row.currency}/ay`, status: row.active ? 'Aktiv' : 'Bitib', meta: row.description || 'Şirkət paketi', updatedAt: dateLabel(row.updated_at), fields: {
      monthly_price: row.monthly_price, currency: row.currency, description: row.description, active: row.active,
      active_vacancies: featureMap.get(`${row.id}:active_vacancies`)?.limit_value ?? '',
      featured_vacancies: featureMap.get(`${row.id}:featured_vacancies`)?.limit_value ?? '',
      monthly_network_posts: featureMap.get(`${row.id}:monthly_network_posts`)?.limit_value ?? '',
      candidate_search: !!featureMap.get(`${row.id}:candidate_search`)?.enabled,
      ai_candidate_matching: !!featureMap.get(`${row.id}:ai_candidate_matching`)?.enabled,
      ai_cv_ranking: !!featureMap.get(`${row.id}:ai_cv_ranking`)?.enabled,
      advanced_analytics: !!featureMap.get(`${row.id}:advanced_analytics`)?.enabled,
      bulk_messaging: !!featureMap.get(`${row.id}:bulk_messaging`)?.enabled,
      premium_branding: !!featureMap.get(`${row.id}:premium_branding`)?.enabled
    } }));
  }
  if (resource === 'payments') {
    const { data, error } = await supabase.from('payments').select('id,amount,currency,status,provider,provider_reference,created_at,paid_at,companies(name)').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.companies?.name || 'Şirkət', subtitle: `${row.amount} ${row.currency} · ${row.provider}`, status: row.status === 'paid' ? 'Aktiv' : row.status === 'pending' ? 'Yoxlamada' : 'Bitib', meta: row.provider_reference || 'Manual qeyd', updatedAt: dateLabel(row.paid_at || row.created_at), fields: { status: row.status } }));
  }
  if (resource === 'moderation_logs') {
    const { data, error } = await supabase.from('moderation_logs').select('id,target_type,target_id,action,reason,created_at,profiles(full_name)').order('created_at', { ascending: false }).limit(250);
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.action, subtitle: `${row.target_type} · ${row.profiles?.full_name || 'Admin'}`, status: 'Aktiv', meta: row.reason || String(row.target_id), updatedAt: dateLabel(row.created_at) }));
  }
  if (resource === 'notifications') {
    const { data, error } = await supabase.from('notifications').select('id,kind,title,body,read_at,created_at,profiles(full_name)').order('created_at', { ascending: false }).limit(250);
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.title, subtitle: `${row.profiles?.full_name || 'İstifadəçi'} · ${row.kind}`, status: row.read_at ? 'Bitib' : 'Aktiv', meta: row.body || 'Bildiriş', updatedAt: dateLabel(row.created_at) }));
  }
  if (resource === 'cv_analytics') {
    const { data, error } = await supabase.from('cv_documents').select('id,title,language,template_id,ats_score,updated_at,profiles(full_name)').order('updated_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.profiles?.full_name || row.title, subtitle: `${row.title} · ${row.language?.toUpperCase() || 'AZ'}`, status: row.ats_score >= 70 ? 'Aktiv' : 'Yoxlamada', meta: `ATS: ${row.ats_score ?? '—'} · ${row.template_id || 'şablonsuz'}`, updatedAt: dateLabel(row.updated_at) }));
  }
  if (resource === 'interview_analytics') {
    const { data, error } = await supabase.from('interview_sessions').select('id,target_role,interview_type,major,score,created_at,completed_at,profiles(full_name)').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.profiles?.full_name || 'Namizəd', subtitle: `${row.target_role} · ${row.interview_type}`, status: row.completed_at ? 'Aktiv' : 'Yoxlamada', meta: `${row.major || 'İxtisas yoxdur'} · bal ${row.score ?? '—'}`, updatedAt: dateLabel(row.created_at) }));
  }
  if (resource === 'ai_usage') {
    const { data, error } = await supabase.from('ai_usage').select('id,task,provider,model,input_chars,output_chars,success,error_code,created_at').order('created_at', { ascending: false }).limit(250);
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: String(row.id), title: row.task, subtitle: `${row.provider || '—'} · ${row.model || '—'}`, status: row.success ? 'Aktiv' : 'Bitib', meta: `${row.input_chars} → ${row.output_chars} simvol${row.error_code ? ` · ${row.error_code}` : ''}`, updatedAt: dateLabel(row.created_at) }));
  }
  if (resource === 'ads') {
    const { data, error } = await supabase.from('ads').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    return (data || []).map((row: any) => ({
      id: row.id, title: row.title, subtitle: `${row.advertiser} · ${placementLabel[row.placement] || row.placement}`,
      status: row.status === 'active' && row.ends_on >= today ? 'Aktiv' : row.status === 'draft' ? 'Qaralama' : row.status === 'paused' ? 'Yoxlamada' : 'Bitib',
      meta: `${dateLabel(row.starts_on)} – ${dateLabel(row.ends_on)} · ${row.impressions} baxış · ${row.clicks} klik${row.price_azn != null ? ` · ${row.price_azn} AZN${row.paid ? ' (ödənilib)' : ' (ödənilməyib)'}` : ''}`,
      updatedAt: dateLabel(row.updated_at || row.created_at),
      fields: { title: row.title, advertiser: row.advertiser, company_id: row.company_id, description: row.description, image_url: row.image_url, link_url: row.link_url, cta_label: row.cta_label, placement: row.placement, starts_on: row.starts_on, ends_on: row.ends_on, status: row.status, priority: row.priority, price_azn: row.price_azn, paid: row.paid }
    }));
  }
  if (resource === 'awards') {
    const { data, error } = await supabase.from('company_awards').select('*').order('year', { ascending: false }).order('nomination');
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.company_name, subtitle: `${row.year} · ${row.nomination}`,
      avatar: logoOf(row.logo_url), avatarKind: 'logo' as const,
      status: row.published ? 'Aktiv' : 'Qaralama', meta: `${tierLabel[row.tier] || row.tier}${row.citation ? ` · ${row.citation}` : ''}`,
      updatedAt: dateLabel(row.updated_at || row.created_at),
      fields: { year: row.year, nomination: row.nomination, tier: row.tier, company_id: row.company_id, company_name: row.company_name, logo_url: row.logo_url, citation: row.citation, published: row.published }
    }));
  }
  if (resource === 'admins') {
    const { data, error } = await supabase.from('profiles').select('id,full_name,email,status,admin_role,avatar_path,updated_at').eq('role', 'admin').order('updated_at', { ascending: false });
    if (error) throw error;
    const pics = await signAvatars(context, (data || []).map((row: any) => row.avatar_path));
    return (data || []).map((row: any) => ({
      id: row.id, title: row.full_name || 'Əməkdaş', subtitle: row.email || 'Administrator', status: accountStatus(row.status),
      avatar: photo(pics, row.avatar_path), avatarKind: 'photo' as const,
      meta: row.admin_role || 'İdarəetmə hüquqları', updatedAt: dateLabel(row.updated_at), fields: { full_name: row.full_name, email: row.email, status: row.status, admin_role: row.admin_role || 'reviewer' }
    }));
  }
  if (resource === 'content') {
    const { data, error } = await supabase.from('site_content').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, title: row.title, subtitle: row.content_key, status: row.status as Status, meta: row.summary || 'Sayt məzmunu', updatedAt: dateLabel(row.updated_at), fields: { content_key: row.content_key, summary: row.summary, body: row.body } }));
  }
  const { data, error } = await supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).map((row: any) => ({ id: row.id, title: row.title, subtitle: row.resource, status: 'Aktiv', meta: row.actor_name || 'Admin', updatedAt: dateLabel(row.created_at) }));
}

/* Hər bölmə ayrıca yüklənir: biri xəta versə, panel açılır və həmin bölmədə səbəb göstərilir. */
export async function loadAdminData(context: AdminContext): Promise<AdminLoad> {
  const lookups = await loadLookups(context);
  const results = await Promise.allSettled(resourceKeys.map((key) => loadResource(context, key, lookups)));
  const data = {} as AdminStore;
  const errors: Partial<Record<ResourceKey, string>> = {};
  resourceKeys.forEach((key, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') data[key] = result.value;
    else {
      data[key] = [];
      const reason = result.reason as { message?: string } | undefined;
      errors[key] = reason?.message || 'Məlumat yüklənmədi';
    }
  });
  return { data, errors, lookups };
}

export async function writeAudit(context: AdminContext, resource: string, resourceId: string | null, action: string, title: string) {
  const auditResourceId = resourceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resourceId) ? resourceId : null;
  await context.supabase.from('admin_audit_logs').insert({ title, resource, resource_id: auditResourceId, action, actor_id: context.userId, actor_name: context.fullName });
}
