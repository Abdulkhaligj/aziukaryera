'use client';

import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISS_KEY = 'admin.install.dismissed';
const DISMISS_DAYS = 30;

/* Tətbiq kimi (ana ekrandan) açılıbsa true */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 864e5;
  } catch { return false; }
}

/* Telefonda paneli ana ekrana əlavə etməyi təklif edir: Android-də bir toxunuşla,
   iPhone/iPad-də Safari-nin "Paylaş → Ana ekrana əlavə et" addımları ilə */
export default function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone()) { document.documentElement.classList.add('isStandalone'); return; }
    if (dismissedRecently() || !window.matchMedia('(max-width: 1023px)').matches) return;
    const ua = navigator.userAgent;
    const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (apple) { setIos(true); setShow(true); }
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); setShow(true); };
    const onInstalled = () => { setShow(false); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* gizli rejim */ }
  }

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === 'accepted') setShow(false);
  }

  if (!show || (!ios && !prompt)) return null;
  return <div className="installHint" role="region" aria-label="Paneli ana ekrana əlavə et">
    <img src="/icons/admin-192.png" alt="" width={44} height={44}/>
    <div className="installText">
      <b>Paneli telefona tətbiq kimi əlavə et</b>
      {ios
        ? <p>Safari-də aşağıdakı <Share size={14} aria-label="Paylaş"/> <b>Paylaş</b> düyməsinə toxun, sonra <SquarePlus size={14} aria-hidden="true"/> <b>Ana ekrana əlavə et</b> seç.</p>
        : <p>Ana ekrandan bir toxunuşla, brauzer paneli olmadan açılır.</p>}
    </div>
    {!ios && <button type="button" className="primaryButton" onClick={install}><Download size={17}/>Əlavə et</button>}
    <button type="button" className="iconButton" aria-label="Bağla" onClick={dismiss}><X size={18}/></button>
  </div>;
}
