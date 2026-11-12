// Run after editing CV inline scripts: node scripts/update-security-policy.mjs
// The test checks these hashes against the actual shipped HTML.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const portal = new URL('../', import.meta.url);
const hashes = new Set([
  'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU'
]);
for (const name of ['index.html', 'cv-builder.html']) {
  const html = readFileSync(new URL(name, portal), 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) continue;
    hashes.add('sha256-' + createHash('sha256').update(match[2]).digest('base64'));
  }
}
const policy = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'",
  "script-src 'self' " + [...hashes].map(value => "'" + value + "'").join(' '),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com", "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-src 'self'", "worker-src 'self'", "form-action 'self'"
].join('; ');
for (const name of ['index.html', 'cv-builder.html']) {
  let html = readFileSync(new URL(name, portal), 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\r?\n?/gi, '');
  html = html.replace(/(<meta charset="utf-8"\s*\/?>)/i, '$1\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">');
  writeFileSync(new URL(name, portal), html);
}
const config = JSON.parse(readFileSync(new URL('vercel.json', portal), 'utf8'));
const headers = config.headers[0].headers.filter(item => item.key !== 'Content-Security-Policy');
headers.push({ key: 'Content-Security-Policy', value: policy + "; frame-ancestors 'self'" });
config.headers[0].headers = headers;
writeFileSync(new URL('vercel.json', portal), JSON.stringify(config, null, 2) + '\n');
writeFileSync(new URL('nginx-security-headers.conf', portal), [
  '# Include in the HTTPS server/location serving this static portal.',
  '# connect-src gets the API origin at the cutover (deploy/universitet-mysql/scripts/05-switch-frontend.mjs).',
  'add_header Content-Security-Policy "' + policy + "; frame-ancestors 'self'\" always;",
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header Referrer-Policy "no-referrer" always;',
  'add_header X-Frame-Options "SAMEORIGIN" always;',
  'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
  'add_header Cache-Control "private, no-store, max-age=0" always;',
  ''
].join('\n'));
console.log('Updated HTML CSP, Vercel headers and host-independent Nginx include.');
