import { readAdminJson } from '@/lib/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-data';

/* Gemini cavabı 20-30 saniyə çəkə bilər */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  const parsed = await readAdminJson(request);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.body;
  // Every field is checked here too (audit 2026-11-16, M39): audio only from the
  // staff member's own folder, images only from the platform's public media,
  // and a short history of plain turns.
  const audioPath = typeof body.audio_path === 'string' ? body.audio_path : '';
  if (audioPath && !new RegExp(`^${context.userId}/[0-9a-f-]{36}\\.wav$`).test(audioPath)) {
    return NextResponse.json({ error: 'Yanlış səs faylı' }, { status: 400 });
  }
  const imageUrl = typeof body.image_url === 'string' ? body.image_url : '';
  const mediaBase = `${(process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')}/storage/v1/object/public/public-media/`;
  if (imageUrl && (!imageUrl.startsWith(mediaBase) || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(png|jpe?g|webp)$/.test(imageUrl.slice(mediaBase.length)))) {
    return NextResponse.json({ error: 'Şəkil yalnız panelin öz yükləməsindən ola bilər' }, { status: 400 });
  }
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
    .filter((h): h is { role: string; text: string } => !!h && typeof h === 'object' && typeof (h as { text?: unknown }).text === 'string')
    .map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', text: h.text.slice(0, 600) }));
  const payload = {
    text: typeof body.text === 'string' ? body.text.slice(0, 4000) : '',
    audio_path: audioPath,
    image_url: imageUrl,
    history
  };
  const { data, error } = await context.db.functions.invoke('admin-assistant', { body: payload });
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
