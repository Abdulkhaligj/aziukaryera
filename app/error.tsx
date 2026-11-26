'use client';
import { useEffect } from 'react';

// A page that fails to render shows a way back instead of a blank screen.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The cause goes to the console, and a short code is shown, so a report
  // (a screenshot) is enough to find it in the server logs or the code.
  useEffect(() => { console.error('admin page error', error); }, [error]);
  const code = error.digest || error.name || 'Error';
  return (
    <main style={{ maxWidth: 520, margin: '15vh auto', padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Səhifə açılmadı</h1>
      <p style={{ color: '#5b6478', marginBottom: 20 }}>Gözlənilməz xəta baş verdi. Yenidən cəhd edin; problem qalarsa, administratora bildirin.</p>
      <p style={{ color: '#8a93a6', fontSize: 12, marginBottom: 20, wordBreak: 'break-word' }}>Kod: {code}{error.message && !error.digest ? ` — ${error.message.slice(0, 160)}` : ''}</p>
      <button onClick={reset} style={{ padding: '10px 18px', borderRadius: 10, border: 0, background: '#3b5bdb', color: '#fff', cursor: 'pointer' }}>Yenidən cəhd et</button>
    </main>
  );
}
