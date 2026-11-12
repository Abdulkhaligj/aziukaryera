'use client';

// A page that fails to render shows a way back instead of a blank screen.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 520, margin: '15vh auto', padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Səhifə açılmadı</h1>
      <p style={{ color: '#5b6478', marginBottom: 20 }}>Gözlənilməz xəta baş verdi. Yenidən cəhd edin; problem qalarsa, administratora bildirin.</p>
      <button onClick={reset} style={{ padding: '10px 18px', borderRadius: 10, border: 0, background: '#3b5bdb', color: '#fff', cursor: 'pointer' }}>Yenidən cəhd et</button>
    </main>
  );
}
