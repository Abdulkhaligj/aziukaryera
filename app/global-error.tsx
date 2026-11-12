'use client';

// Replaces the root layout when it fails itself, so it renders its own html.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="az">
      <body style={{ fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 520, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>İdarəetmə paneli açılmadı</h1>
          <p style={{ color: '#5b6478', marginBottom: 20 }}>Gözlənilməz xəta baş verdi. Səhifəni yeniləyin.</p>
          <button onClick={reset} style={{ padding: '10px 18px', borderRadius: 10, border: 0, background: '#3b5bdb', color: '#fff', cursor: 'pointer' }}>Yenidən cəhd et</button>
        </main>
      </body>
    </html>
  );
}
