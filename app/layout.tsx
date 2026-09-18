import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASOIU Karyera — İdarəetmə',
  description: 'ADNSU Karyera Mərkəzi üçün idarəetmə paneli'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="az"><body>{children}</body></html>;
}
