// Run after editing an inline script or the data client library:
//   node scripts/update-security-policy.mjs            (check and write)
//   node scripts/update-security-policy.mjs --approve  (after reviewing a changed inline script)
// The test checks these hashes against the actual shipped HTML.
//
// Audit 2026-11-13, #85: an inline script is allowed only when its hash is in
// inline-scripts.json, a reviewed list that is committed with the HTML. A
// script that appears in the HTML without review (for example injected into a
// page) makes this script fail instead of being blessed into the policy.
// The vendored data client gets a Subresource Integrity hash on every page
// that loads it, so a changed copy on the server does not run.
// Audit 2026-11-13, #81: images only from this site (and, after the cutover,
// the API's own storage), never from any https: address.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const portal = new URL('../', import.meta.url);
const pages = ['index.html', 'cv-builder.html'];
const approve = process.argv.includes('--approve');

// External scripts loaded with integrity (QR code, React for the CV builder).
const external = [
  'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU'
];

const listFile = new URL('scripts/inline-scripts.json', portal);
const reviewed = JSON.parse(readFileSync(listFile, 'utf8'));
const found = [];
for (const name of pages) {
  const html = readFileSync(new URL(name, portal), 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) continue;
    const hash = 'sha256-' + createHash('sha256').update(match[2]).digest('base64');
    found.push({ page: name, hash, start: match[2].trim().slice(0, 60).replace(/\s+/g, ' ') });
  }
}
const unknown = found.filter(script => !reviewed.some(entry => entry.hash === script.hash));
if (unknown.length && !approve) {
  console.error('Bu inline skriptlər yoxlanmamış siyahıdadır (inline-scripts.json):');
  for (const script of unknown) console.error(`  ${script.page}: ${script.hash}  «${script.start}…»`);
  console.error('Skripti oxuyub yoxlayın, sonra: node scripts/update-security-policy.mjs --approve');
  process.exit(1);
}
if (approve) {
  const next = found.map(script => ({ page: script.page, hash: script.hash, start: script.start }));
  writeFileSync(listFile, JSON.stringify(next, null, 2) + '\n');
  console.log(`inline-scripts.json: ${next.length} skript təsdiqləndi.`);
}
const inline = found.map(script => script.hash);

// Subresource Integrity for the vendored data client.
const client = readFileSync(new URL('assets/vendor/api-client.min.js', portal));
const integrity = 'sha384-' + createHash('sha384').update(client).digest('base64');
for (const name of pages) {
  const file = new URL(name, portal);
  const html = readFileSync(file, 'utf8');
  const next = html.replace(/<script src="(assets\/vendor\/api-client\.min\.js\?v=[0-9a-z]+)"(?: integrity="[^"]*")?><\/script>/,
    `<script src="$1" integrity="${integrity}"></script>`);
  writeFileSync(file, next);
}

const policy = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'",
  "script-src 'self' " + [...new Set([...external, ...inline])].map(value => "'" + value + "'").join(' '),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com", "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self'", "worker-src 'self'", "form-action 'self'"
].join('; ');
for (const name of pages) {
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
  '# connect-src and img-src get the API origin at the cutover (deploy/universitet-mysql/scripts/05-switch-frontend.mjs).',
  'add_header Content-Security-Policy "' + policy + "; frame-ancestors 'self'\" always;",
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header Referrer-Policy "no-referrer" always;',
  'add_header X-Frame-Options "SAMEORIGIN" always;',
  'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
  'add_header Cache-Control "private, no-store, max-age=0" always;',
  ''
].join('\n'));
console.log('Updated HTML CSP, data client integrity, Vercel headers and host-independent Nginx include.');
