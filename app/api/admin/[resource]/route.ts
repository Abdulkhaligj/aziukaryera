import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, loadLookups, loadResource, resourceKeys, writeAudit } from '@/lib/admin-data';
import { can } from '@/lib/permissions';
import type { ResourceKey } from '@/lib/types';

const resources = new Set<ResourceKey>(resourceKeys);
const people = new Set<ResourceKey>(['students', 'master_students', 'alumni', 'admins']);

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function list(value: unknown, separator = ',') { return text(value).split(separator).map(item => item.trim()).filter(Boolean); }
function bool(value: unknown) { return value === true || value === 'true' || value === 'on'; }

export async function GET(_: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!resources.has(resource as ResourceKey)) return NextResponse.json({ error: 'Naməlum bölmə' }, { status: 404 });
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  try {
    return NextResponse.json(await loadResource(context, resource as ResourceKey, await loadLookups(context)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Məlumat alınmadı' }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const key = resource as ResourceKey;
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  if (!resources.has(key) || !can(context.role, 'create', key)) return NextResponse.json({ error: 'Bu əməliyyata icazəniz yoxdur' }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;

  /* Hesablar e-poçtsuz, müvəqqəti şifrə ilə yaradılır (SMTP tələb olunmur) */
  if (people.has(key)) {
    const { data, error } = await context.supabase.functions.invoke('admin-users', {
      body: { ...body, action: 'create', resource: key }
    });
    if (error || !data?.ok) return NextResponse.json({ error: data?.error || error?.message || 'Hesab yaradılmadı' }, { status: 400 });
    return NextResponse.json(data, { status: 201 });
  }

  if (key === 'awards') {
    const year = number(body.year, new Date().getFullYear());
    const nomination = text(body.nomination);
    const companyId = text(body.company_id);
    let companyName = text(body.company_name);
    if (companyId) {
      const { data: company } = await context.supabase.from('companies').select('name').eq('id', companyId).maybeSingle();
      if (company?.name) companyName = company.name;
    }
    if (!nomination || !companyName) return NextResponse.json({ error: 'Nominasiya və şirkət məcburidir' }, { status: 400 });
    const payload = { year, nomination, tier: text(body.tier) || 'gold', company_id: companyId || null, company_name: companyName, logo_url: text(body.logo_url) || null, citation: text(body.citation) || null, published: bool(body.published) };
    const { data, error } = await context.supabase.from('company_awards').insert(payload).select('id').single();
    if (error) return NextResponse.json({ error: /duplicate key/i.test(error.message) ? 'Bu şirkət həmin il və nominasiyada artıq var' : error.message }, { status: 400 });
    await writeAudit(context, resource, data.id, 'create', `${companyName} — ${nomination} mükafatı əlavə edildi`);
    return NextResponse.json({ id: data.id }, { status: 201 });
  }

  const title = text(body.title);
  if (!title) return NextResponse.json({ error: 'Başlıq məcburidir' }, { status: 400 });

  let table: string = resource;
  let payload: Record<string, unknown>;
  if (key === 'companies') {
    payload = { name: title, sector: text(body.sector), email: text(body.email), phone: text(body.phone), website: text(body.website), company_size: text(body.company_size), address: text(body.address), logo_url: text(body.logo_url) || null, about: text(body.about), contact: text(body.contact), contact_position: text(body.contact_position), contact_email: text(body.contact_email), contact_phone: text(body.contact_phone), verified: bool(body.verified), status: text(body.status) || 'pending' };
  } else if (key === 'jobs') {
    payload = { company_id: text(body.company_id), title, type: text(body.type) || 'tecrube', mode: text(body.mode) || 'Əyani', location: text(body.location) || 'Bakı', deadline: text(body.deadline), summary: text(body.summary), department: text(body.department), experience_level: text(body.experience_level), salary_min: text(body.salary_min) ? number(body.salary_min) : null, salary_max: text(body.salary_max) ? number(body.salary_max) : null, currency: text(body.currency) || 'AZN', salary_visible: bool(body.salary_visible), positions: Math.max(1, number(body.positions, 1)), skills: list(body.skills), preferred_skills: list(body.preferred_skills), faculty_ids: list(body.faculty_ids), major_ids: list(body.major_ids), duties: list(body.duties, '\n'), requirements: list(body.requirements, '\n'), application_method: text(body.application_method) || 'platform', application_url: text(body.application_url) || null, changes_requested: text(body.changes_requested) || null, status: text(body.status) || 'draft' };
  } else if (key === 'events') {
    payload = { title, kind: text(body.kind), starts_at: text(body.starts_at), place: text(body.place), seats: number(body.seats) };
  } else if (key === 'benefits') {
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
    payload = { partner_id: partnerId, title, description: text(body.description), discount_label: text(body.discount_label), valid_from: text(body.valid_from) || new Date().toISOString().slice(0, 10), valid_to: text(body.valid_to) || null, active: body.active !== false && body.active !== 'false' };
  } else {
    table = 'site_content';
    payload = { title, content_key: text(body.content_key), summary: text(body.summary), body: text(body.body), status: text(body.status) || 'Qaralama', updated_by: context.userId };
  }

  const { data, error } = await context.supabase.from(table).insert(payload).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await writeAudit(context, resource, data.id, 'create', `${title} yaradıldı`);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
