import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-data';
import { crossSite } from '@/lib/admin-input';

/*
 * Uploads from the panel go through this route (audit 2026-11-13, #58): the
 * session cookie is HttpOnly, so the browser never holds the access token and
 * cannot talk to the storage API itself. The API checks the bucket policies
 * and the file content again with the staff member's own session.
 */
const KINDS = {
  image: { bucket: 'public-media', types: /^image\/(png|jpeg|webp)$/, max: 5 * 1024 * 1024, cache: '31536000' },
  audio: { bucket: 'assistant-audio', types: /^audio\/(wav|x-wav)$/, max: 10 * 1024 * 1024, cache: '60' }
} as const;
const FOLDER = /^[a-z][a-z0-9-]{0,39}$/;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

export async function POST(request: NextRequest) {
  if (crossSite(request)) return NextResponse.json({ error: 'Sorğu başqa saytdan göndərilib.' }, { status: 403 });
  const context = await getAdminContext();
  if (!context) return NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 });
  const length = Number(request.headers.get('content-length') || 0);
  if (!length || length > 11 * 1024 * 1024) return NextResponse.json({ error: 'Fayl çox böyükdür.' }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: 'Sorğunun formatı yanlışdır.' }, { status: 400 }); }
  const kind = String(form.get('kind') || '') as keyof typeof KINDS;
  const file = form.get('file');
  if (!Object.hasOwn(KINDS, kind) || !(file instanceof File)) return NextResponse.json({ error: 'Fayl seçilməyib.' }, { status: 400 });
  const rule = KINDS[kind];
  if (!rule.types.test(file.type)) return NextResponse.json({ error: kind === 'image' ? 'Yalnız PNG, JPG və ya WebP şəkil seçin' : 'Yalnız WAV səs faylı' }, { status: 415 });
  if (file.size > rule.max) return NextResponse.json({ error: 'Fayl çox böyükdür.' }, { status: 413 });
  const folder = String(form.get('folder') || '');
  if (kind === 'image' && !FOLDER.test(folder)) return NextResponse.json({ error: 'Yanlış qovluq.' }, { status: 400 });
  // Audio lives in the staff member's own folder, as the assistant expects.
  const path = kind === 'audio' ? `${context.userId}/${crypto.randomUUID()}.wav` : `${folder}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error } = await context.db.storage.from(rule.bucket).upload(path, file, { contentType: file.type, cacheControl: rule.cache, upsert: false });
  if (error) {
    return NextResponse.json({ error: /row-level|unauthor/i.test(error.message) ? 'Fayl yükləməyə icazəniz yoxdur' : 'Fayl yüklənmədi' }, { status: 400 });
  }
  if (kind === 'audio') return NextResponse.json({ path });
  return NextResponse.json({ path, url: context.db.storage.from(rule.bucket).getPublicUrl(path).data.publicUrl });
}
