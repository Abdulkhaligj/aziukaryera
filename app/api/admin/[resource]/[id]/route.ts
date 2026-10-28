import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, writeAudit } from '@/lib/admin-data';
import { can } from '@/lib/permissions';
import type { ResourceKey } from '@/lib/types';

const moderationStates = new Set(['visible', 'pending', 'hidden']);
const people = new Set<ResourceKey>(['students', 'master_students', 'alumni', 'admins']);
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function nullableNumber(value: unknown) { if (value === '' || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function list(value: unknown, separator = ',') { return text(value).split(separator).map(item => item.trim()).filter(Boolean); }
function bool(value: unknown) { return value === true || value === 'true' || value === 'on'; }
/* Formadakı "YYYY-MM-DDTHH:MM" Bakı vaxtıdır (UTC+4, yay vaxtı yoxdur) */
function bakuTime(value: unknown) { const s = text(value); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00+04:00` : s; }
function httpsUrl(value: unknown) { const s = text(value); return /^https:\/\//i.test(s) ? s : null; }
const placements = new Set(['landing_hero', 'landing_strip', 'dashboard']);
const adStatuses = new Set(['draft', 'active', 'paused', 'ended']);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const key = resource as ResourceKey;
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  if (!can(context.role, 'edit', key)) {
    return NextResponse.json({ error: key === 'admins' ? 'Əməkdaş hesablarını yalnız Super Admin idarə edə bilər' : 'Bu əməliyyata icazəniz yoxdur' }, { status: 403 });
  }
  const body = await request.json() as Record<string, unknown>;

  // Təsdiq səhifəsi yalnız statusu dəyişir. Formanın bütün vakansiya
  // sütunlarını yenidən yazmaq bu əməliyyatı uğursuz edirdi.
  if (key === 'pending_jobs' && body.__action === 'approval_status') {
    const status = text(body.status);
    const allowed = new Set(['draft', 'pending', 'pending_approval', 'changes_requested',
      'approved', 'published', 'rejected', 'expired', 'archived']);
    if (!allowed.has(status)) return NextResponse.json({ error: 'Yanlış təsdiq statusu.' }, { status: 400 });
    const reason = text(body.changes_requested).slice(0, 2000);
    if ((status === 'rejected' || status === 'changes_requested') && !reason)
      return NextResponse.json({ error: 'Rədd və ya düzəliş üçün səbəbi yazın.' }, { status: 400 });
    const update: Record<string, unknown> = {
      status,
      changes_requested: status === 'rejected' || status === 'changes_requested' ? reason : null,
      rejection_reason: status === 'rejected' ? reason : null
    };
    if (status === 'approved' || status === 'published') {
      update.approved_by = context.userId;
      update.approved_at = new Date().toISOString();
    }
    const { data, error } = await context.supabase.from('jobs')
      .update(update).eq('id', id).select('id,status').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: 'Vakansiya tapılmadı və ya bu əməliyyata icazə yoxdur.' }, { status: 404 });
    await writeAudit(context, 'pending_jobs', id, 'update', 'Vakansiyanın təsdiq statusu dəyişdirildi');
    return NextResponse.json({ ok: true, status: data.status });
  }

  if (people.has(key)) {
    /* "Şifrəni sıfırla": yeni müvəqqəti şifrə qaytarılır (yalnız hesab yaratmaq hüququ olanlar) */
    const action = body.__action === 'reset_password' ? 'reset_password' : 'update';
    if (action === 'reset_password' && !can(context.role, 'create', key)) return NextResponse.json({ error: 'Şifrəni sıfırlamağa icazəniz yoxdur' }, { status: 403 });
    const { data, error } = await context.supabase.functions.invoke('admin-users', {
      body: { ...body, action, resource: key, id }
    });
    if (error || !data?.ok) return NextResponse.json({ error: data?.error || error?.message || 'İstifadəçi yenilənmədi' }, { status: 400 });
    return NextResponse.json(data);
  }

  let table = resource;
  let payload: Record<string, unknown>;
  if (resource === 'companies') payload = { name: text(body.title), sector: text(body.sector), email: text(body.email), phone: text(body.phone), website: text(body.website), company_size: text(body.company_size), address: text(body.address), logo_url: text(body.logo_url) || null, about: text(body.about), contact: text(body.contact), contact_position: text(body.contact_position), contact_email: text(body.contact_email), contact_phone: text(body.contact_phone), verified: body.verified === true || body.verified === 'true', status: text(body.status) };
  else if (resource === 'jobs' || resource === 'pending_jobs') { table = 'jobs'; payload = { company_id: text(body.company_id), title: text(body.title), type: text(body.type), mode: text(body.mode), location: text(body.location), deadline: text(body.deadline), summary: text(body.summary), department: text(body.department), experience_level: text(body.experience_level), salary_min: nullableNumber(body.salary_min), salary_max: nullableNumber(body.salary_max), currency: text(body.currency) || 'AZN', salary_visible: body.salary_visible === true || body.salary_visible === 'true', positions: Math.max(1, number(body.positions, 1)), skills: list(body.skills), preferred_skills: list(body.preferred_skills), faculty_ids: list(body.faculty_ids), major_ids: list(body.major_ids), duties: list(body.duties, '\n'), requirements: list(body.requirements, '\n'), application_method: text(body.application_method) || 'platform', application_url: text(body.application_url) || null, changes_requested: text(body.changes_requested) || null, rejection_reason: text(body.status) === 'rejected' ? text(body.changes_requested) || null : null, status: text(body.status) }; }
  else if (resource === 'events') payload = { title: text(body.title), kind: text(body.kind), starts_at: bakuTime(body.starts_at), place: text(body.place), seats: number(body.seats), description: text(body.description) || null, organizers: list(body.organizers), image_url: httpsUrl(body.image_url) };
  else if (resource === 'ads') {
    const placement = text(body.placement);
    if (!placements.has(placement)) return NextResponse.json({ error: 'Reklam yerini seçin' }, { status: 400 });
    payload = { title: text(body.title), advertiser: text(body.advertiser) || text(body.title), company_id: text(body.company_id) || null, description: text(body.description) || null, image_url: httpsUrl(body.image_url), link_url: httpsUrl(body.link_url), cta_label: text(body.cta_label) || 'Ətraflı', placement, starts_on: text(body.starts_on), ends_on: text(body.ends_on), status: adStatuses.has(text(body.status)) ? text(body.status) : 'draft', priority: number(body.priority), price_azn: text(body.price_azn) ? number(body.price_azn) : null, paid: bool(body.paid) };
  }
  else if (resource === 'benefits') {
    let partnerId = text(body.partner_id);
    const partnerName = text(body.partner_name);
    if (partnerName) {
      const { data: partner } = await context.supabase.from('benefit_partners').select('id').ilike('name', partnerName).maybeSingle();
      if (partner?.id) partnerId = partner.id;
      else {
        const { data: created, error: partnerError } = await context.supabase.from('benefit_partners').insert({ name: partnerName, status: 'active', logo_url: httpsUrl(body.partner_logo_url) }).select('id').single();
        if (partnerError) return NextResponse.json({ error: partnerError.message }, { status: 400 });
        partnerId = created.id;
      }
    }
    if (!partnerId) return NextResponse.json({ error: 'Tərəfdaş adı məcburidir' }, { status: 400 });
    if (httpsUrl(body.partner_logo_url)) await context.supabase.from('benefit_partners').update({ logo_url: httpsUrl(body.partner_logo_url) }).eq('id', partnerId);
    payload = { partner_id: partnerId, title: text(body.title), description: text(body.description), discount_label: text(body.discount_label), valid_from: text(body.valid_from), valid_to: text(body.valid_to) || null, active: body.active !== false };
  }
  else if (resource === 'applications') payload = { status: text(body.status), note: text(body.note) };
  else if (resource === 'network') {
    table = 'posts';
    const state = text(body.moderation_status);
    if (!moderationStates.has(state)) return NextResponse.json({ error: 'Yanlış moderasiya statusu' }, { status: 400 });
    /* "pending" paylaşımı AI yoxlamasına yenidən göndərir */
    payload = { moderation_status: state };
  }
  else if (resource === 'awards') {
    table = 'company_awards';
    const nomination = text(body.nomination);
    const companyId = text(body.company_id);
    let companyName = text(body.company_name);
    if (companyId) {
      const { data: company } = await context.supabase.from('companies').select('name').eq('id', companyId).maybeSingle();
      if (company?.name) companyName = company.name;
    }
    if (!nomination || !companyName) return NextResponse.json({ error: 'Nominasiya və şirkət məcburidir' }, { status: 400 });
    payload = { year: number(body.year, new Date().getFullYear()), nomination, tier: text(body.tier) || 'gold', company_id: companyId || null, company_name: companyName, logo_url: text(body.logo_url) || null, citation: text(body.citation) || null, published: body.published === true || body.published === 'true' || body.published === 'on' };
  }
  else if (resource === 'reports') { table = 'reports'; payload = { status: text(body.status), reviewed_by: context.userId, reviewed_at: new Date().toISOString() }; }
  else if (resource === 'subscriptions') { table = 'subscriptions'; payload = { plan_id: text(body.plan_id), status: text(body.status), approved_by: text(body.status) === 'active' ? context.userId : null }; }
  else if (resource === 'payments') { table = 'payments'; payload = { status: text(body.status), paid_at: text(body.status) === 'paid' ? new Date().toISOString() : null }; }
  else if (resource === 'plans') {
    table = 'plans';
    payload = { monthly_price: number(body.monthly_price), currency: 'AZN', description: text(body.description), updated_at: new Date().toISOString() };
    const features = [
      { feature_key: 'active_vacancies', enabled: true, limit_value: nullableNumber(body.active_vacancies), label: 'Aktiv vakansiyalar' },
      { feature_key: 'featured_vacancies', enabled: nullableNumber(body.featured_vacancies) !== 0, limit_value: nullableNumber(body.featured_vacancies), label: 'Önə çıxarılan vakansiyalar' },
      { feature_key: 'monthly_network_posts', enabled: true, limit_value: nullableNumber(body.monthly_network_posts), label: 'Aylıq şirkət paylaşımları' },
      ...[['candidate_search','Namizəd axtarışı'],['ai_candidate_matching','AI namizəd uyğunluğu'],['ai_cv_ranking','AI CV sıralaması'],['advanced_analytics','Qabaqcıl analitika'],['bulk_messaging','Kütləvi mesajlaşma'],['premium_branding','Premium şirkət səhifəsi']].map(([feature_key, label]) => ({ feature_key, label, enabled: body[feature_key] === true || body[feature_key] === 'true', limit_value: body[feature_key] === true || body[feature_key] === 'true' ? null : 0 }))
    ];
    const { error: featureError } = await context.supabase.from('plan_features').upsert(features.map(feature => ({ ...feature, plan_id: id, updated_at: new Date().toISOString() })), { onConflict: 'plan_id,feature_key' });
    if (featureError) return NextResponse.json({ error: featureError.message }, { status: 400 });
  }
  else { table = 'site_content'; payload = { title: text(body.title), content_key: text(body.content_key), summary: text(body.summary), body: text(body.body), status: text(body.status), updated_by: context.userId }; }

  const { error } = await context.supabase.from(table).update(payload).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await writeAudit(context, resource, id, 'update', `${text(body.title) || resource} yeniləndi`);
  if (resource === 'network') {
    await context.supabase.from('moderation_logs').insert({ target_type: 'post', target_id: id, action: text(body.moderation_status) === 'hidden' ? 'hide' : 'approve', actor_id: context.userId, reason: 'Admin panelindən moderasiya' });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const key = resource as ResourceKey;
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  if (!can(context.role, 'delete', key)) return NextResponse.json({ error: 'Silməyə icazəniz yoxdur' }, { status: 403 });

  if (people.has(key)) {
    const { data, error } = await context.supabase.functions.invoke('admin-users', {
      body: { action: 'delete', resource: key, id }
    });
    if (error || !data?.ok) return NextResponse.json({ error: data?.error || error?.message || 'İstifadəçi silinmədi' }, { status: 400 });
    return NextResponse.json(data);
  }

  const table: Record<string, string> = {
    content: 'site_content', network: 'posts', pending_jobs: 'jobs', cv_analytics: 'cv_documents', awards: 'company_awards',
    interview_analytics: 'interview_sessions', ai_usage: 'ai_usage'
  };
  const target = table[resource] || resource;
  const { error } = await context.supabase.from(target).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await writeAudit(context, resource, id, 'delete', `${resource} qeydi silindi`);
  return NextResponse.json({ ok: true });
}
