import type { MetadataRoute } from 'next';

/* Telefonda "Ana ekrana əlavə et" ilə panel ayrıca tətbiq kimi açılır */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/admin',
    name: 'ASOIU Karyera — İdarəetmə',
    short_name: 'Karyera Admin',
    description: 'ADNSU Karyera Mərkəzi əməkdaşları üçün idarəetmə paneli',
    lang: 'az',
    dir: 'ltr',
    start_url: '/admin',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#071f78',
    theme_color: '#071f78',
    categories: ['education', 'productivity', 'business'],
    icons: [
      { src: '/icons/admin-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/admin-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/admin-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
