import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-data';
import { can } from '@/lib/permissions';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  const jobId = request.nextUrl.searchParams.get('job_id') || '';
  if (!uuid.test(jobId)) return NextResponse.json({ error: 'Vakansiya identifikatoru yanlışdır.' }, { status: 400 });

  const { data, error } = await context.supabase
    .from('admin_audit_logs')
    .select('id,title,actor_name,created_at')
    .eq('resource', 'pending_jobs')
    .eq('resource_id', jobId)
    .eq('action', 'note')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: 'Daxili qeydlər açıla bilmədi.' }, { status: 400 });
  return NextResponse.json({ notes: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  if (!can(context.role, 'edit', 'pending_jobs'))
    return NextResponse.json({ error: 'Bu bölmədə qeyd yazmağa icazəniz yoxdur.' }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Sorğunun formatı yanlışdır.' }, { status: 400 }); }
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const jobId = typeof payload.job_id === 'string' ? payload.job_id : '';
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  if (!uuid.test(jobId)) return NextResponse.json({ error: 'Vakansiya identifikatoru yanlışdır.' }, { status: 400 });
  if (!note || note.length > 1200)
    return NextResponse.json({ error: 'Qeyd 1–1200 simvol arasında olmalıdır.' }, { status: 400 });

  const { data: job, error: jobError } = await context.supabase.from('jobs').select('id').eq('id', jobId).maybeSingle();
  if (jobError || !job) return NextResponse.json({ error: 'Vakansiya tapılmadı.' }, { status: 404 });

  // Internal audit history; never publish the note to employers or student profiles.
  const { data, error } = await context.supabase.from('admin_audit_logs')
    .insert({
      title: note,
      resource: 'pending_jobs',
      resource_id: jobId,
      action: 'note',
      actor_id: context.userId,
      actor_name: context.fullName
    })
    .select('id,title,actor_name,created_at')
    .single();
  if (error) return NextResponse.json({ error: 'Qeyd yadda saxlanmadı.' }, { status: 400 });
  return NextResponse.json({ ok: true, note: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
