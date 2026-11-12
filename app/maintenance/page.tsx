import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'ASOIU Karyera — texniki işlər' };

// Shown while the backend moves to the university's MySQL server
// (next.config.mjs sends every page here while MAINTENANCE is true).
export default function Maintenance() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px 16px', background: '#f3f5fb' }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: 20, padding: '36px 28px', textAlign: 'center', boxShadow: '0 12px 40px rgba(20, 30, 80, .10)' }}>
        <h1 style={{ fontSize: 24, margin: '0 0 12px', color: '#1b2440' }}>İdarəetmə paneli yenilənir</h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, margin: 0, color: '#4a5470' }}>
          Platforma universitetin yeni serverinə köçürülür. Panel tezliklə yenidən açılacaq.
        </p>
      </div>
    </main>
  );
}
