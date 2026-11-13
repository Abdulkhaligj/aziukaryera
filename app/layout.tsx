import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASOIU Karyera — İdarəetmə',
  description: 'ADNSU Karyera Mərkəzi üçün idarəetmə paneli',
  applicationName: 'Karyera Admin',
  /* iPhone-da ana ekrandan açılanda brauzer paneli olmadan, tətbiq kimi işləyir */
  appleWebApp: { capable: true, title: 'Karyera Admin', statusBarStyle: 'default' },
  icons: { icon: '/icons/favicon-64.png', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
  /* Next yalnız mobile-web-app-capable yazır; köhnə iOS versiyaları bu adı gözləyir */
  other: { 'apple-mobile-web-app-capable': 'yes' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#141b2e' }
  ]
};

// Every page is rendered per request, so its scripts carry the nonce of the
// response's Content-Security-Policy (proxy.ts, audit 2026-11-13, #58).
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await headers();
  return <html lang="az"><body>{children}</body></html>;
}
