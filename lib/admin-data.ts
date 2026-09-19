import { createClient } from '@/lib/supabase/server';
import type { AdminRole, AdminRow, ResourceKey, Status } from '@/lib/types';

export type AdminStore = Record<ResourceKey, AdminRow[]>;
export type AdminContext = {
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>;
  userId: string;
  role: AdminRole;
  fullName: string;
};

const adminRoles: AdminRole[] = ['super_admin', 'manager', 'editor', 'reviewer'];

function dateLabel(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('az-AZ', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function jobStatus(value: string): Status {
  if (value === 'approved') return 'Aktiv';
  if (value === 'draft') return 'Qaralama';
  if (value === 'closed' || value === 'rejected') return 'Bitib';
  return 'Yoxlamada';
}

function accountStatus(value: string): Status {
  if (value === 'active') return 'Aktiv';
  if (value === 'rejected') return 'Bitib';
  return 'Yoxlamada';
}

function applicationStatus(value: string): Status {
  if (value === 'teklif' || value === 'musahibe') return 'Aktiv';
  if (value === 'imtina' || value === 'geri_goturuldu') return 'Bitib';
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
  const { data: profile } = await supabase.from('profiles').select('full_name,role,status').eq('id', userId).single();
  if (!profile || profile.status !== 'active') return null;
  // All Career Center administrators have the same full-access permission set.
  // The metadata claim is only used to distinguish admins from student accounts.
  const role: AdminRole = 'super_admin';
  return { supabase, userId, role, fullName: profile.full_name || 'Karyera Mərkəzi' };
}

export async function loadResource(context: AdminContext, resource: ResourceKey): Promise<AdminRow[]> {
  const { supabase } = context;
  if (resource === 'jobs') {
    const { data, error } = await supabase.from('jobs').select('id,title,type,mode,location,deadline,summary,status,company_id,created_at,companies(name)').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.title, subtitle: `${row.companies?.name || 'Şirkət'} · ${row.type || 'Elan'}`,
      status: jobStatus(row.status), meta: `${row.location || 'Bakı'} · son tarix ${dateLabel(row.deadline)}`,
      updatedAt: dateLabel(row.created_at), fields: { company_id: row.company_id, type: row.type, mode: row.mode, location: row.location, deadline: row.deadline, summary: row.summary, status: row.status }
    }));
  }
  if (resource === 'companies') {
    const { data, error } = await supabase.from('companies').select('id,name,sector,email,website,about,status,created_at').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.name, subtitle: row.sector || 'Şirkət', status: accountStatus(row.status),
      meta: row.website || row.email || 'Əlaqə məlumatı yoxdur', updatedAt: dateLabel(row.created_at),
      fields: { email: row.email, website: row.website, about: row.about, status: row.status }
    }));
  }
  if (resource === 'events') {
    const { data, error } = await supabase.from('events').select('id,title,kind,starts_at,place,seats,created_at').order('starts_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.title, subtitle: row.kind || 'Tədbir', status: new Date(row.starts_at) >= new Date() ? 'Aktiv' : 'Bitib',
      meta: `${row.place || 'Məkan qeyd edilməyib'} · ${row.seats || 0} yer`, updatedAt: dateLabel(row.starts_at),
      fields: { kind: row.kind, starts_at: row.starts_at?.slice(0, 16), place: row.place, seats: row.seats }
    }));
  }
  if (resource === 'benefits') {
    const { data, error } = await supabase.from('benefits').select('id,title,description,discount_label,valid_from,valid_to,active,created_at,partner_id,benefit_partners(name)').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.title, subtitle: row.benefit_partners?.name || 'Tərəfdaş', status: row.active ? 'Aktiv' : 'Bitib',
      meta: `${row.discount_label || 'Güzəşt'} · ${row.valid_to ? dateLabel(row.valid_to) : 'müddətsiz'}`, updatedAt: dateLabel(row.created_at),
      fields: { partner_id: row.partner_id, partner_name: row.benefit_partners?.name, description: row.description, discount_label: row.discount_label, valid_from: row.valid_from, valid_to: row.valid_to, active: row.active }
    }));
  }
  if (resource === 'applications') {
    const { data, error } = await supabase.from('applications').select('id,status,note,created_at,profiles!applications_student_id_fkey(full_name),jobs(title)').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.profiles?.full_name || 'Tələbə', subtitle: row.jobs?.title || 'Vakansiya', status: applicationStatus(row.status),
      meta: row.note || 'Qeyd yoxdur', updatedAt: dateLabel(row.created_at), fields: { status: row.status, note: row.note }
    }));
  }
  if (resource === 'students') {
    const { data, error } = await supabase.from('profiles').select('id,full_name,role,status,faculty_id,major_id,course,gpa,updated_at').in('role', ['student', 'graduate']).order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.full_name || 'Tələbə', subtitle: `${row.role === 'graduate' ? 'Məzun' : `${row.course || '—'}. kurs`} · ${row.major_id || 'İxtisas qeyd edilməyib'}`,
      status: accountStatus(row.status), meta: row.gpa ? `ÜOMG: ${row.gpa}` : 'Profil məlumatı', updatedAt: dateLabel(row.updated_at)
    }));
  }
  if (resource === 'admins') {
    const { data, error } = await supabase.from('profiles').select('id,full_name,email,status,updated_at').eq('role', 'admin').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id, title: row.full_name || 'Əməkdaş', subtitle: row.email || 'Administrator', status: accountStatus(row.status),
      meta: 'İdarəetmə hüquqları', updatedAt: dateLabel(row.updated_at), fields: { status: row.status }
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

export async function loadAdminData(context: AdminContext): Promise<AdminStore> {
  const keys: ResourceKey[] = ['jobs', 'companies', 'events', 'benefits', 'applications', 'students', 'content', 'admins', 'audit_logs'];
  const values = await Promise.all(keys.map((key) => loadResource(context, key)));
  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as AdminStore;
}

export async function writeAudit(context: AdminContext, resource: string, resourceId: string | null, action: string, title: string) {
  await context.supabase.from('admin_audit_logs').insert({ title, resource, resource_id: resourceId, action, actor_id: context.userId, actor_name: context.fullName });
}
