import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, loadResource, writeAudit } from '@/lib/admin-data';
import type { ResourceKey } from '@/lib/types';

const resources = new Set<ResourceKey>(['jobs', 'pending_jobs', 'companies', 'events', 'benefits', 'applications', 'students', 'master_students', 'alumni', 'network', 'reports', 'moderation_logs', 'subscriptions', 'plans', 'payments', 'cv_analytics', 'interview_analytics', 'ai_usage', 'notifications', 'content', 'admins', 'audit_logs']);
const creatable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'content', 'students', 'master_students', 'alumni', 'admins']);
const people = new Set<ResourceKey>(['students', 'master_students', 'alumni', 'admins']);

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function list(value: unknown, separator = ',') { return text(value).split(separator).map(item => item.trim()).filter(Boolean); }

export async function GET(_: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!resources.has(resource as ResourceKey)) return NextResponse.json({ error: 'Naməlum bölmə' }, { status: 404 });
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'İcazə yoxdur' }, { status: 401 });
  try {
    return NextResponse.json(await loadResource(context, resource as ResourceKey));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Məlumat alınmadı' }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!creatable.has(resource as ResourceKey)) return NextResponse.json({ error: 'Bu əməliyyata icazə yoxdur' }, { status: 403 });
  const context = await getAdminContext();
  if (!context || context.role === 'reviewer') return NextResponse.json({ error: 'İcazə yoxdur' }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;

  if (people.has(resource as ResourceKey)) {
    const { data, error } = await context.supabase.functions.invoke('admin-users', {
      body: { ...body, action: 'invite', resource }
    });
    if (error || !data?.ok) return NextResponse.json({ error: data?.error || error?.message || 'Dəvət göndərilmədi' }, { status: 400 });
    return NextResponse.json(data, { status: 201 });
  }

  const title = text(body.title);
  if (!title) return NextResponse.json({ error: 'Başlıq məcburidir' }, { status: 400 });

  let table = resource;
  let payload: Record<string, unknown>;
  if (resource === 'companies') {
    payload = { name: title, sector: text(body.sector), email: text(body.email), phone: text(body.phone), website: text(body.website), company_size: text(body.company_size), address: text(body.address), logo_url: text(body.logo_url) || null, about: text(body.about), contact: text(body.contact), contact_position: text(body.contact_position), contact_email: text(body.contact_email), contact_phone: text(body.contact_phone), verified: body.verified === true || body.verified === 'true', status: text(body.status) || 'pending' };
  } else if (resource === 'jobs') {
    payload = { company_id: text(body.company_id), title, type: text(body.type) || 'tecrube', mode: text(body.mode) || 'Əyani', location: text(body.location) || 'Bakı', deadline: text(body.deadline), summary: text(body.summary), department: text(body.department), experience_level: text(body.experience_level), salary_min: text(body.salary_min) ? number(body.salary_min) : null, salary_max: text(body.salary_max) ? number(body.salary_max) : null, currency: text(body.currency) || 'AZN', salary_visible: body.salary_visible === true || body.salary_visible === 'true', positions: Math.max(1, number(body.positions, 1)), skills: list(body.skills), preferred_skills: list(body.preferred_skills), faculty_ids: list(body.faculty_ids), major_ids: list(body.major_ids), duties: list(body.duties, '\n'), requirements: list(body.requirements, '\n'), application_method: text(body.application_method) || 'platform', application_url: text(body.application_url) || null, changes_requested: text(body.changes_requested) || null, status: text(body.status) || 'draft' };
  } else if (resource === 'events') {
    payload = { title, kind: text(body.kind), starts_at: text(body.starts_at), place: text(body.place), seats: number(body.seats) };
  } else if (resource === 'benefits') {
    let partnerId = text(body.partner_id);
    const partnerName = text(body.partner_name);
    if (!partnerId && partnerName) {
      const { data: existing } = await context.supabase.from('benefit_partners').select('id').ilike('name', partnerName).maybeSingle();
      if (existing?.id) partnerId = existing.id;
      else {
        const { data: created, error: partnerError } = await context.supabase.from('benefit_partners').insert({ name: partnerName, status: 'active' }).select('id').single();
        if (partnerError) return NextResponse.json({ error: partnerError.message }, { status: 400 });
        partnerId = created.id;
      }
    }
    if (!partnerId) return NextResponse.json({ error: 'Tərəfdaş adı məcburidir' }, { status: 400 });
    payload = { partner_id: partnerId, title, description: text(body.description), discount_label: text(body.discount_label), valid_from: text(body.valid_from) || new Date().toISOString().slice(0, 10), valid_to: text(body.valid_to) || null, active: body.active !== false };
  } else {
    table = 'site_content';
    payload = { title, content_key: text(body.content_key), summary: text(body.summary), body: text(body.body), status: text(body.status) || 'Qaralama', updated_by: context.userId };
  }

  const { data, error } = await context.supabase.from(table).insert(payload).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await writeAudit(context, resource, data.id, 'create', `${title} yaradıldı`);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
