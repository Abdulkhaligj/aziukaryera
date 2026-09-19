import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, loadResource, writeAudit } from '@/lib/admin-data';
import type { ResourceKey } from '@/lib/types';

const resources = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'applications', 'students', 'content', 'admins', 'audit_logs']);
const creatable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'content']);

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

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
  const title = text(body.title);
  if (!title) return NextResponse.json({ error: 'Başlıq məcburidir' }, { status: 400 });

  let table = resource;
  let payload: Record<string, unknown>;
  if (resource === 'companies') {
    payload = { name: title, sector: text(body.sector), email: text(body.email), website: text(body.website), about: text(body.about), status: text(body.status) || 'pending' };
  } else if (resource === 'jobs') {
    payload = { company_id: text(body.company_id), title, type: text(body.type) || 'tecrube', mode: text(body.mode) || 'Əyani', location: text(body.location) || 'Bakı', deadline: text(body.deadline), summary: text(body.summary), status: text(body.status) || 'draft' };
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
