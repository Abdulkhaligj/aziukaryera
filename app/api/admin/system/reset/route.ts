import { readAdminJson } from '@/lib/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-data';
import { publicError } from '@/lib/admin-input';

export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context || context.role !== 'super_admin') {
    return NextResponse.json({ error: 'Bu əməliyyatı yalnız Super Admin icra edə bilər' }, { status: 403 });
  }

  const parsed = await readAdminJson(request);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.body;
  if (body.confirmation !== 'SIFIRLA') {
    return NextResponse.json({ error: 'Təsdiq sözü yanlışdır' }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc('admin_reset_platform_data', { p_confirmation: body.confirmation });
  if (error) return NextResponse.json({ error: publicError(error, 'Sıfırlama alınmadı') }, { status: 400 });
  return NextResponse.json(data);
}
