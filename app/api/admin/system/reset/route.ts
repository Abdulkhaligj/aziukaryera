import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-data';

export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context || context.role !== 'super_admin') {
    return NextResponse.json({ error: 'Bu əməliyyatı yalnız Super Admin icra edə bilər' }, { status: 403 });
  }

  const body = await request.json() as { confirmation?: string };
  if (body.confirmation !== 'SIFIRLA') {
    return NextResponse.json({ error: 'Təsdiq sözü yanlışdır' }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc('admin_reset_platform_data', { p_confirmation: body.confirmation });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
