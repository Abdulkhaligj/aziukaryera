'use client';

import { useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';

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

/* Panelin öz serveri ilə yüklənir: sessiya cookie-si HttpOnly-dir, brauzer API ilə birbaşa danışmır (audit 2026-11-13, #58). */
export async function uploadFile(kind: 'image' | 'audio', blob: Blob, folder = ''): Promise<{ path: string; url?: string }> {
  const form = new FormData();
  form.set('kind', kind);
  form.set('folder', folder);
  form.set('file', blob, kind === 'audio' ? 'audio.wav' : 'image');
  const response = await fetch('/api/admin/upload', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.href = '/login'; throw new Error('Sessiya bitib'); }
  if (!response.ok || !result.path) throw new Error(result.error || 'Fayl yüklənmədi');
  return result;
}

/* public-media bucket-inə yükləyib ictimai linki qaytarır (yükləməni yalnız admin edə bilər) */
export async function uploadPublicImage(file: File, folder: string): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Yalnız PNG, JPG və ya WebP şəkil seçin');
  if (file.size > 15 * 1024 * 1024) throw new Error('Şəkil 15 MB-dan böyük olmamalıdır');
  const blob = await resizeImage(file, 1600);
  if (blob.size > 5 * 1024 * 1024) throw new Error('Şəkil kiçildildikdən sonra da 5 MB-dan böyükdür');
  return (await uploadFile('image', blob, folder)).url!;
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
