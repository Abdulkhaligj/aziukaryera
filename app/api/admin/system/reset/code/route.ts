import { readAdminJson } from '@/lib/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-data';

// The code for the platform reset goes to the super admin's own email (audit v4, M-03).
export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context || context.role !== 'super_admin') {
    return NextResponse.json({ error: 'Bu əməliyyatı yalnız Super Admin icra edə bilər' }, { status: 403 });
  }
  const parsed = await readAdminJson(request);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const { error } = await context.db.auth.reauthenticate();
  if (error) {
    const busy = (error as { status?: number }).status === 429;
    return NextResponse.json({ error: busy ? 'Kod bir az əvvəl göndərilib. Bir dəqiqə sonra yenidən cəhd edin.' : 'Kod göndərilmədi' }, { status: busy ? 429 : 400 });
  }
  return NextResponse.json({ ok: true });
}
