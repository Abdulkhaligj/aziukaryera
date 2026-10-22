'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ImagePlus, LoaderCircle, Mic, Pencil, Rocket, Send, Sparkles, Square, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPublicImage } from '@/components/image-field';
import { can } from '@/lib/permissions';
import type { AdminRole, AdminRow, ResourceKey } from '@/lib/types';

export type AssistantAction = { type: string; summary: string; data: Record<string, unknown>; missing: string[] };
type Message = { role: 'user' | 'assistant'; text: string; image?: string; actions?: AssistantAction[]; error?: boolean; pending?: boolean };

export const actionResource: Record<string, ResourceKey> = {
  create_event: 'events', create_job: 'jobs', create_benefit: 'benefits', create_award: 'awards',
  create_content: 'content', create_company: 'companies', create_ad: 'ads'
};
const actionLabel: Record<string, string> = {
  create_event: 'Tədbir', create_job: 'Vakansiya', create_benefit: 'Güzəşt', create_award: 'Mükafat',
  create_content: 'Sayt mətni', create_company: 'Şirkət', create_ad: 'Reklam'
};
const fieldLabel: Record<string, string> = {
  title: 'Ad', kind: 'Növ', starts_at: 'Tarix və saat', place: 'Məkan', seats: 'Yer sayı', description: 'Təsvir',
  organizers: 'Təşkilatçılar', company: 'Şirkət', type: 'Növ', mode: 'Rejim', location: 'Məkan', deadline: 'Son tarix',
  summary: 'Qısa məlumat', duties: 'Öhdəliklər', requirements: 'Tələblər', skills: 'Bacarıqlar', partner_name: 'Tərəfdaş',
  discount_label: 'Endirim', valid_from: 'Başlama', valid_to: 'Bitmə', year: 'İl', nomination: 'Nominasiya', tier: 'Dərəcə',
  company_name: 'Şirkət', citation: 'Əsaslandırma', content_key: 'Açar', body: 'Mətn', name: 'Ad', sector: 'Sektor',
  website: 'Vebsayt', email: 'E-poçt', phone: 'Telefon', about: 'Haqqında', advertiser: 'Reklamçı', link_url: 'Link',
  cta_label: 'Düymə', placement: 'Yer', starts_on: 'Başlama', ends_on: 'Bitmə', price_azn: 'Qiymət (AZN)',
  salary_min: 'Maaş (min, AZN)', salary_max: 'Maaş (maks, AZN)'
};
const valueLabel: Record<string, string> = {
  is: 'İş', tecrube: 'Təcrübə', graduate: 'Məzun proqramı', konullu: 'Könüllülük', gold: '🥇 Qızıl', silver: '🥈 Gümüş', bronze: '🥉 Bürünc',
  landing_hero: 'Ana səhifə banneri', landing_strip: 'Ana səhifə sponsor kartı', dashboard: 'Kabinetdə'
};
/* Bunlar olmadan qeyd yaradıla bilməz; qalan çatışmayan sahələr yalnız məlumat üçündür */
const requiredFields: Record<string, string[]> = {
  create_event: ['title', 'starts_at'], create_job: ['title', 'company', 'deadline'], create_benefit: ['title', 'partner_name', 'discount_label'],
  create_award: ['nomination', 'company_name'], create_content: ['title', 'content_key'], create_company: ['name'],
  create_ad: ['title', 'advertiser', 'placement', 'ends_on']
};
const examples = [
  'Sabah saat 15:00-da əsas korpusda karyera seminarı, 120 yer, təşkilatçı Karyera Mərkəzi',
  'Ana səhifə üçün Karyera Mərkəzi haqqında qısa, maraqlı mətn hazırla',
  '30 noyabra qədər məlumat təhlili üzrə təcrübə elanı yaz, şirkəti mən deyəcəyəm',
  'Bu posterdəki tədbiri qeydiyyata al (şəkli əlavə edin)'
];

/* AI qaralamasını panelin forma sahələrinə çevirir (EditorFields eyni sahələri oxuyur) */
export function actionToRow(action: AssistantAction, companies: AdminRow[]): { resource: ResourceKey; row: AdminRow; warnings: string[] } {
  const d = action.data;
  const s = (k: string) => d[k] == null ? '' : String(d[k]);
  const join = (k: string, sep: string) => Array.isArray(d[k]) ? (d[k] as unknown[]).join(sep) : s(k);
  const find = (name: string) => name ? companies.find(c => c.title.toLocaleLowerCase('az-AZ') === name.toLocaleLowerCase('az-AZ')) : undefined;
  const warnings: string[] = [];
  const resource = actionResource[action.type];
  const base = { id: '', status: 'Qaralama' as const, meta: '', updatedAt: '' };
  let row: AdminRow;
  if (action.type === 'create_event') {
    row = { ...base, title: s('title'), subtitle: s('kind'), fields: { kind: s('kind'), starts_at: s('starts_at'), place: s('place'), seats: d.seats as number ?? 0, description: s('description'), organizers: join('organizers', ', '), image_url: s('image_url') } };
  } else if (action.type === 'create_job') {
    const co = find(s('company'));
    if (s('company') && !co) warnings.push(`“${s('company')}” platformada tapılmadı — əvvəl şirkəti dərc edin (AI qaralaması yuxarıdadır) və ya formada başqa şirkət seçin.`);
    row = { ...base, title: s('title'), subtitle: '', fields: { company_id: co?.id || '', type: s('type') || 'tecrube', mode: s('mode') || 'Əyani', location: s('location') || 'Bakı', deadline: s('deadline'), salary_min: d.salary_min as number ?? '', salary_max: d.salary_max as number ?? '', salary_visible: d.salary_min != null || d.salary_max != null, currency: 'AZN', summary: s('summary'), duties: join('duties', '\n'), requirements: join('requirements', '\n'), skills: join('skills', ', '), status: 'published' } };
  } else if (action.type === 'create_benefit') {
    row = { ...base, title: s('title'), subtitle: s('partner_name'), fields: { partner_name: s('partner_name'), discount_label: s('discount_label'), valid_from: s('valid_from'), valid_to: s('valid_to'), description: s('description'), active: true } };
  } else if (action.type === 'create_award') {
    const co = find(s('company_name'));
    row = { ...base, title: s('company_name'), subtitle: '', fields: { year: d.year as number ?? new Date().getFullYear(), nomination: s('nomination'), tier: s('tier') || 'gold', company_id: co?.id || '', company_name: co ? '' : s('company_name'), citation: s('citation'), logo_url: s('logo_url'), published: true } };
  } else if (action.type === 'create_content') {
    row = { ...base, status: 'Aktiv', title: s('title'), subtitle: s('content_key'), fields: { content_key: s('content_key'), summary: s('summary'), body: s('body') } };
  } else if (action.type === 'create_company') {
    row = { ...base, title: s('name'), subtitle: s('sector') || 'Şirkət', fields: { email: s('email'), phone: s('phone'), website: s('website'), about: s('about'), logo_url: s('logo_url'), status: 'active' } };
  } else {
    const co = find(s('advertiser'));
    row = { ...base, title: s('title'), subtitle: '', fields: { title: s('title'), advertiser: s('advertiser'), company_id: co?.id || '', description: s('description'), image_url: s('image_url'), link_url: s('link_url'), cta_label: s('cta_label') || 'Ətraflı', placement: s('placement') || 'landing_strip', starts_on: s('starts_on'), ends_on: s('ends_on'), status: 'active', priority: 0, price_azn: d.price_azn as number ?? '', paid: false } };
    if (!s('image_url')) warnings.push('Reklam üçün şəkil yoxdur — formada banner yükləyin.');
  }
  return { resource, row, warnings };
}

/* Formadakı "Yadda saxla" ilə eyni sahələr: birbaşa yaratmaq üçün */
export function rowToPayload(resource: ResourceKey, row: AdminRow): Record<string, unknown> {
  const payload: Record<string, unknown> = { title: row.title, ...row.fields };
  if (resource === 'companies') payload.sector = row.subtitle === 'Şirkət' ? '' : row.subtitle;
  if (resource === 'content') payload.status = row.status;
  return payload;
}

/* ---------------- Səs yazısı: 16 kHz mono WAV (Gemini birbaşa oxuyur) ---------------- */
type Recorder = { stop: () => Promise<Blob>; cancel: () => void };

function encodeWav(samples: Float32Array, rate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(processor);
  processor.connect(ctx.destination);
  let closed = false;
  const close = () => { if (closed) return; closed = true; processor.disconnect(); source.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); };
  return {
    cancel: close,
    stop: async () => {
      const rate = ctx.sampleRate;
      close();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      /* 16 kHz-ə endiririk: danışıq üçün kifayətdir, fayl 3 dəfə kiçilir */
      const target = 16000;
      const ratio = rate / target;
      const out = new Float32Array(Math.floor(merged.length / ratio));
      for (let i = 0; i < out.length; i++) {
        const start = Math.floor(i * ratio), end = Math.min(merged.length, Math.floor((i + 1) * ratio));
        let sum = 0; for (let j = start; j < end; j++) sum += merged[j];
        out[i] = sum / Math.max(1, end - start);
      }
      return encodeWav(out, target);
    }
  };
}

const MAX_SECONDS = 90;

export default function Assistant({ open, onClose, role, userId, companies, completed, onOpenForm, onPublish }: {
  open: boolean; onClose: () => void; role: AdminRole; userId: string; companies: AdminRow[];
  completed: Record<string, 'done' | 'busy' | string>;
  onOpenForm: (resource: ResourceKey, row: AdminRow, key: string) => void;
  onPublish: (resource: ResourceKey, payload: Record<string, unknown>, key: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ file: File; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<{ rec: Recorder; startedAt: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [micError, setMicError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - recording.startedAt) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) finishRecording();
    }, 250);
    return () => clearInterval(t);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Panel bağlananda/səhifədən çıxanda mikrofon açıq qalmasın */
  const recordingRef = useRef<Recorder | null>(null);
  useEffect(() => { recordingRef.current = recording?.rec || null; }, [recording]);
  useEffect(() => () => recordingRef.current?.cancel(), []);
  useEffect(() => { if (!open && recording) { recording.rec.cancel(); setRecording(null); } }, [open, recording]);

  async function toggleMic() {
    setMicError('');
    if (recording) { await finishRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setMicError('Bu brauzer mikrofonu dəstəkləmir.'); return; }
    try { setRecording({ rec: await startRecording(), startedAt: Date.now() }); setSeconds(0); }
    catch { setMicError('Mikrofona icazə verilmədi. Brauzerin ünvan sətrindən mikrofon icazəsini açın.'); }
  }

  async function finishRecording() {
    if (!recording) return;
    const current = recording;
    setRecording(null);
    const blob = await current.rec.stop();
    if (blob.size < 8000) { setMicError('Səs çox qısa oldu, yenidən cəhd edin.'); return; }
    await send(blob);
  }

  async function send(audio?: Blob) {
    const prompt = text.trim();
    if (busy || (!prompt && !audio && !image)) return;
    setBusy(true);
    const history = messages.filter(m => !m.pending && !m.error).map(m => ({ role: m.role, text: m.text })).slice(-6);
    const userIndex = messages.length;
    setMessages(m => [...m, { role: 'user', text: prompt || (audio ? '🎤 Səsli tapşırıq…' : ''), image: image?.preview, pending: !!audio }, { role: 'assistant', text: 'Düşünürəm…', pending: true }]);
    setText('');
    const attached = image;
    setImage(null);
    try {
      let audio_path = '';
      let image_url = '';
      if (audio) {
        const supabase = createClient();
        if (!supabase) throw new Error('Bağlantı qurulmayıb');
        audio_path = `${userId}/${crypto.randomUUID()}.wav`;
        const { error } = await supabase.storage.from('assistant-audio').upload(audio_path, audio, { contentType: 'audio/wav', upsert: false });
        if (error) throw new Error('Səs yüklənmədi: ' + error.message);
      }
      if (attached) image_url = await uploadPublicImage(attached.file, 'assistant');
      const response = await fetch('/api/admin/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt, audio_path, image_url, history }) });
      const result = await response.json();
      if (response.status === 401) { window.location.href = '/login'; return; }
      if (!response.ok) throw new Error(result.error || 'AI cavab vermədi');
      setMessages(m => m.map((msg, i) => i === userIndex ? { ...msg, text: result.transcript || msg.text.replace('…', ''), pending: false }
        : i === userIndex + 1 ? { role: 'assistant', text: result.reply || (result.actions?.length ? 'Qaralamalar hazırdır.' : 'Tapşırığı başa düşmədim, bir az ətraflı yazın.'), actions: result.actions || [] } : msg));
    } catch (caught) {
      setMessages(m => m.map((msg, i) => i === userIndex ? { ...msg, pending: false }
        : i === userIndex + 1 ? { role: 'assistant', text: caught instanceof Error ? caught.message : 'Xəta baş verdi', error: true } : msg));
    } finally { setBusy(false); }
  }

  function pickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setMicError('Yalnız PNG, JPG və ya WebP şəkil.'); return; }
    setImage({ file, preview: URL.createObjectURL(file) });
  }

  return <aside className={`assistantPanel ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="AI köməkçi">
    <header className="assistantHead">
      <span className="assistantMark"><Sparkles size={18}/></span>
      <div><b>AI köməkçi</b><small>Yazın və ya danışın — qaralamanı yoxlayıb dərc edirsiniz</small></div>
      <button className="iconButton" onClick={onClose} aria-label="Köməkçini bağla"><X size={19}/></button>
    </header>

    <div className="assistantList" ref={listRef}>
      {messages.length === 0 && <div className="assistantIntro">
        <p>Tədbir, vakansiya, güzəşt, mükafat, reklam və sayt mətnlərini sizin sözlərinizdən hazırlayıram. Tarixləri, şirkətləri və rəqəmləri <b>yalnız sizin dediyinizdən</b> götürürəm. Heç nə sizin təsdiqiniz olmadan dərc olunmur.</p>
        <div className="exampleChips">{examples.map(e => <button key={e} type="button" onClick={() => setText(e)}>{e}</button>)}</div>
      </div>}
      {messages.map((m, mi) => <div key={mi} className={`bubble ${m.role} ${m.error ? 'error' : ''}`}>
        {m.image && <img src={m.image} alt="" className="bubbleImage"/>}
        <p>{m.pending && m.role === 'assistant' ? <><LoaderCircle size={16} className="spin"/> {m.text}</> : m.text}</p>
        {m.actions?.map((a, ai) => {
          const key = `${mi}:${ai}`;
          const { resource, row, warnings } = actionToRow(a, companies);
          const allowed = can(role, 'create', resource);
          const state = completed[key];
          const preview = Object.entries(a.data).filter(([k, v]) => !['image_url', 'logo_url'].includes(k) && v !== '' && v != null).slice(0, 7);
          const picture = String(a.data.image_url || a.data.logo_url || '');
          const required = requiredFields[a.type] || [];
          const blocking = [...a.missing.filter(k => required.includes(k)), ...required.filter(k => a.data[k] == null || a.data[k] === '')];
          const blockingSet = [...new Set(blocking)];
          const optional = a.missing.filter(k => !required.includes(k));
          return <article className={`aiAction ${state === 'done' ? 'done' : ''}`} key={key}>
            <div className="aiActionHead"><span className="tag">{actionLabel[a.type] || a.type}</span><b>{a.summary || row.title}</b></div>
            {picture && <img src={picture} alt="" className="aiActionImage"/>}
            <dl>{preview.map(([k, v]) => <div key={k}><dt>{fieldLabel[k] || k}</dt><dd>{Array.isArray(v) ? v.join(', ') : valueLabel[String(v)] || String(v)}</dd></div>)}</dl>
            {blockingSet.length > 0 && <p className="aiMissing"><AlertTriangle size={15}/> Çatışmır (məcburi): {blockingSet.map(k => fieldLabel[k] || k).join(', ')} — “Formada yoxla” ilə tamamlayın.</p>}
            {optional.length > 0 && <p className="aiOptional">İstəsəniz əlavə edin: {optional.map(k => fieldLabel[k] || k).join(', ')}</p>}
            {warnings.map(w => <p className="aiMissing" key={w}><AlertTriangle size={15}/> {w}</p>)}
            {state === 'done' ? <p className="aiDone"><Check size={16}/> Yaradıldı</p>
              : !allowed ? <p className="aiMissing">Sizin rolunuz bunu yaratmağa icazə vermir.</p>
                : <div className="aiButtons">
                  <button type="button" className="secondaryButton" onClick={() => onOpenForm(resource, row, key)} disabled={state === 'busy'}><Pencil size={16}/>Formada yoxla</button>
                  <button type="button" className="primaryButton" onClick={() => onPublish(resource, rowToPayload(resource, row), key)} disabled={state === 'busy' || blockingSet.length > 0 || warnings.some(w => w.includes('tapılmadı'))}>
                    {state === 'busy' ? <LoaderCircle size={16} className="spin"/> : <Rocket size={16}/>}Dərc et</button>
                </div>}
            {state && state !== 'done' && state !== 'busy' && <p className="errorText">{state}</p>}
          </article>;
        })}
      </div>)}
    </div>

    <footer className="assistantComposer">
      {micError && <p className="errorText">{micError}</p>}
      {image && <div className="attachPreview"><img src={image.preview} alt=""/><span>Şəkil əlavə olundu</span><button type="button" onClick={() => setImage(null)} aria-label="Şəkli çıxar"><X size={16}/></button></div>}
      {recording
        ? <div className="recordingBar"><span className="recDot"/> Dinləyirəm… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} <small>/ 1:30</small>
          <button type="button" className="secondaryButton" onClick={() => { recording.rec.cancel(); setRecording(null); }}>Ləğv et</button>
          <button type="button" className="primaryButton" onClick={finishRecording}><Square size={15}/>Göndər</button></div>
        : <div className="composerRow">
          <label className="iconButton" aria-label="Şəkil əlavə et" title="Şəkil əlavə et (poster, loqo)"><ImagePlus size={19}/><input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickImage}/></label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="Tapşırığı yazın…"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}/>
          {text.trim() || image
            ? <button type="button" className="sendButton" onClick={() => send()} disabled={busy} aria-label="Göndər">{busy ? <LoaderCircle size={19} className="spin"/> : <Send size={19}/>}</button>
            : <button type="button" className="micButton" onClick={toggleMic} disabled={busy} aria-label="Səslə danış"><Mic size={20}/></button>}
        </div>}
    </footer>
  </aside>;
}
