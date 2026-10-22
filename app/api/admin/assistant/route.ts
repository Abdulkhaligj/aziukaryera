import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-data';

/* Gemini cavabı 20-30 saniyə çəkə bilər */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const payload = {
    text: typeof body.text === 'string' ? body.text.slice(0, 4000) : '',
    audio_path: typeof body.audio_path === 'string' ? body.audio_path : '',
    image_url: typeof body.image_url === 'string' ? body.image_url : '',
    history
  };
  const { data, error } = await context.supabase.functions.invoke('admin-assistant', { body: payload });
  if (error) {
    let message = 'AI cavab vermədi. Bir az sonra yenidən cəhd edin.';
    try {
      const reply = await (error as { context?: Response }).context?.json();
      if (reply?.error) message = reply.error;
    } catch { /* cavab JSON deyil */ }
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!data?.ok) return NextResponse.json({ error: data?.error || 'AI cavab vermədi' }, { status: 400 });
  return NextResponse.json(data);
}
