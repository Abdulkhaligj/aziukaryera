'use client';

import { useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/* Şəkli brauzerdə kiçildib yenidən kodlayır: fayl yüngülləşir, EXIF/GPS silinir.
   Şəffaf loqolar üçün WebP (alfa kanalı saxlanır); WebP yaza bilməyən brauzerdə PNG/JPEG. */
async function resizeImage(file: File, max: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const encode = (type: string, q?: number) => new Promise<Blob | null>(r => canvas.toBlob(r, type, q));
    let blob = await encode('image/webp', 0.9);
    if (!blob || blob.type !== 'image/webp') blob = await encode(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
    if (!blob) throw new Error('Şəkil hazırlanmadı');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* public-media bucket-inə yükləyib ictimai linki qaytarır (yükləməni yalnız admin edə bilər) */
export async function uploadPublicImage(file: File, folder: string): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Yalnız PNG, JPG və ya WebP şəkil seçin');
  if (file.size > 15 * 1024 * 1024) throw new Error('Şəkil 15 MB-dan böyük olmamalıdır');
  const supabase = createClient();
  if (!supabase) throw new Error('Bağlantı qurulmayıb');
  const blob = await resizeImage(file, 1600);
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('public-media').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/row-level|unauthor/i.test(error.message) ? 'Şəkil yükləməyə icazəniz yoxdur' : error.message);
  return supabase.storage.from('public-media').getPublicUrl(path).data.publicUrl;
}

export default function ImageField({ name, label, defaultValue, folder, hint, wide = false }: { name: string; label: string; defaultValue?: string; folder: string; hint?: string; wide?: boolean }) {
  const [url, setUrl] = useState(defaultValue || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { setUrl(await uploadPublicImage(file, folder)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Şəkil yüklənmədi'); }
    finally { setBusy(false); }
  }

  return <div className="field imageField">
    <span>{label}</span>
    <input type="hidden" name={name} value={url}/>
    <div className={`imageBox ${wide ? 'wide' : ''}`}>{url ? <img src={url} alt=""/> : <span>Şəkil yoxdur</span>}</div>
    <div className="imageActions">
      <label className={`secondaryButton ${busy ? 'isBusy' : ''}`}>
        {busy ? <LoaderCircle size={17} className="spin"/> : <ImagePlus size={17}/>}{busy ? 'Yüklənir…' : url ? 'Dəyiş' : 'Şəkil yüklə'}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} disabled={busy}/>
      </label>
      {url && !busy && <button type="button" className="secondaryButton" onClick={() => setUrl('')}><Trash2 size={17}/>Sil</button>}
    </div>
    {hint && <small>{hint}</small>}
    {error && <small className="errorText">{error}</small>}
  </div>;
}
