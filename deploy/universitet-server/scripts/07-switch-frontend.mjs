// Points the student site at the new server: runtime-config.js and the CSP
// connect-src in every place it is declared. Run from the repository root:
//   node deploy/universitet-server/scripts/07-switch-frontend.mjs --url https://api.example.az --key <ANON_KEY>
import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
const url = String(args.url || '').replace(/\/$/, '');
const key = String(args.key || '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('--url https://domen formatında olmalıdır (yol olmadan).');
if (key.length < 20) throw new Error('--key: yeni serverin ANON_KEY dəyəri lazımdır.');
const host = new URL(url).host;

function edit(file, change) {
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`${file}: dəyişiklik tətbiq olunmadı.`);
  writeFileSync(file, after);
  console.log(`yeniləndi: ${file}`);
}
function replaceOnce(text, from, to, file) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: "${from}" ${count} dəfə tapıldı, 1 gözlənilirdi.`);
  return text.replace(from, to);
}

const web = 'student-web';
edit(`${web}/assets/js/runtime-config.js`, text => text
  .replace(/supabaseUrl: '[^']*'/, `supabaseUrl: '${url}'`)
  .replace(/supabasePublishableKey: '[^']*'/, `supabasePublishableKey: '${key}'`));

const cloudCsp = "connect-src 'self' https://*.supabase.co wss://*.supabase.co";
const ownCsp = `connect-src 'self' https://${host} wss://${host}`;
for (const file of ['index.html', 'cv-builder.html', 'vercel.json', 'nginx-security-headers.conf', 'scripts/update-security-policy.mjs']) {
  edit(`${web}/${file}`, text => replaceOnce(text, cloudCsp, ownCsp, file));
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + 's';
for (const file of ['index.html', 'cv-builder.html']) {
  edit(`${web}/${file}`, text => text.replace(/runtime-config\.js\?v=[0-9a-z]+/, `runtime-config.js?v=${stamp}`));
}

console.log(`
Növbəti addımlar:
  1. Testlər:  node --test tests/*.test.mjs
  2. Commit və push: git add -A && git commit -m "chore: point the portal at ${host}" && git push origin main
  3. Admin panel (Vercel → asoiu-career-admin → Settings → Environment Variables, Production):
       NEXT_PUBLIC_SUPABASE_URL = ${url}
       NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = <ANON_KEY>
     sonra admin layihəsini yenidən deploy edin.`);
