import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, writeAudit } from '@/lib/admin-data';
import type { ResourceKey } from '@/lib/types';

const editable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'content', 'applications', 'admins']);
const removable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'content']);
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const key = resource as ResourceKey;
  const context = await getAdminContext();
  if (!context || !editable.has(key) || (context.role === 'reviewer' && key !== 'applications')) return NextResponse.json({ error: 'İcazə yoxdur' }, { status: 403 });
  if (key === 'admins' && context.role !== 'super_admin') return NextResponse.json({ error: 'Əməkdaş hesablarını yalnız Super Admin idarə edə bilər' }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  let table = resource;
  let payload: Record<string, unknown>;
  if (resource === 'companies') payload = { name: text(body.title), sector: text(body.sector), email: text(body.email), website: text(body.website), about: text(body.about), status: text(body.status) };
  else if (resource === 'jobs') payload = { company_id: text(body.company_id), title: text(body.title), type: text(body.type), mode: text(body.mode), location: text(body.location), deadline: text(body.deadline), summary: text(body.summary), status: text(body.status) };
  else if (resource === 'events') payload = { title: text(body.title), kind: text(body.kind), starts_at: text(body.starts_at), place: text(body.place), seats: number(body.seats) };
  else if (resource === 'benefits') {
    let partnerId = text(body.partner_id);
    const partnerName = text(body.partner_name);
    if (partnerName) {
      const { data: partner } = await context.supabase.from('benefit_partners').select('id').ilike('name', partnerName).maybeSingle();
      if (partner?.id) partnerId = partner.id;
      else {
        const { data: created, error: partnerError } = await context.supabase.from('benefit_partners').insert({ name: partnerName, status: 'active' }).select('id').single();
        if (partnerError) return NextResponse.json({ error: partnerError.message }, { status: 400 });
        partnerId = created.id;
      }
    }
    if (!partnerId) return NextResponse.json({ error: 'Tərəfdaş adı məcburidir' }, { status: 400 });
    payload = { partner_id: partnerId, title: text(body.title), description: text(body.description), discount_label: text(body.discount_label), valid_from: text(body.valid_from), valid_to: text(body.valid_to) || null, active: body.active !== false };
  }
  else if (resource === 'applications') payload = { status: text(body.status), note: text(body.note) };
  else if (resource === 'admins') { table = 'profiles'; payload = { status: text(body.status) }; }
  else { table = 'site_content'; payload = { title: text(body.title), content_key: text(body.content_key), summary: text(body.summary), body: text(body.body), status: text(body.status), updated_by: context.userId }; }

  const { error } = await context.supabase.from(table).update(payload).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await writeAudit(context, resource, id, 'update', `${text(body.title) || resource} yeniləndi`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const key = resource as ResourceKey;
  const context = await getAdminContext();
  if (!context || !removable.has(key) || !['super_admin', 'manager'].includes(context.role)) return NextResponse.json({ error: 'İcazə yoxdur' }, { status: 403 });
  const table = resource === 'content' ? 'site_content' : resource;
  const { error } = await context.supabase.from(table).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await writeAudit(context, resource, id, 'delete', `${resource} qeydi silindi`);
  return NextResponse.json({ ok: true });
}
