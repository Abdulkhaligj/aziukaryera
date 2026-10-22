'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Eye, EyeOff, LoaderCircle, LogIn } from 'lucide-react';

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button className="primaryButton block" type="submit" disabled={pending}>
    {pending ? <LoaderCircle size={18} className="spin"/> : <LogIn size={18}/>}{pending ? pendingLabel : label}
  </button>;
}

/* Şifrə sahəsi: göstər/gizlət düyməsi və Caps Lock xəbərdarlığı */
export function PasswordField({ name, label, autoComplete, defaultValue, minLength }: { name: string; label: string; autoComplete: string; defaultValue?: string; minLength?: number }) {
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState?.('CapsLock') ?? false);
  return <label className="field">{label}
    <span className="passwordWrap">
      <input name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} defaultValue={defaultValue}
        minLength={minLength} required onKeyDown={onKey} onKeyUp={onKey}/>
      <button type="button" className="eyeButton" onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Şifrəni gizlət' : 'Şifrəni göstər'} aria-pressed={visible}>
        {visible ? <EyeOff size={18}/> : <Eye size={18}/>}
      </button>
    </span>
    {caps && <small className="capsHint">Caps Lock açıqdır</small>}
  </label>;
}

export default function LoginForm({ action, error, notice, email }: { action: (formData: FormData) => void; error?: string; notice?: string; email?: string }) {
  return <form action={action} className="stackForm">
    {notice && <div className="successBox">{notice}</div>}
    {error && <div className="errorBox" role="alert">{error}</div>}
    <label className="field">E-poçt
      <input name="email" type="email" inputMode="email" autoComplete="username" placeholder="ad.soyad@asoiu.edu.az" defaultValue={email} required autoFocus={!email}/>
    </label>
    <PasswordField name="password" label="Şifrə" autoComplete="current-password"/>
    <SubmitButton label="Daxil ol" pendingLabel="Yoxlanılır…"/>
    <p className="formHint">Şifrəni unutmusunuzsa və ya hesabınız yoxdursa, Super Admin sizə müvəqqəti şifrə verə bilər.</p>
  </form>;
}

export function PasswordChangeButton() {
  return <SubmitButton label="Şifrəni yadda saxla" pendingLabel="Saxlanılır…"/>;
}
