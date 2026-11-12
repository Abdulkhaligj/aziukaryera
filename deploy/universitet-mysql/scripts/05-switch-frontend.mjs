// Cutover: points the student site at the MySQL API (runtime-config.js and the
// CSP connect-src in every place it is declared) and turns the maintenance page
// off on both sites. Run from the repository root:
//   node deploy/universitet-mysql/scripts/05-switch-frontend.mjs --url https://api.example.az --key <ANON_KEY>
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
  .replace(/apiUrl: '[^']*'/, `apiUrl: '${url}'`)
  .replace(/apiKey: '[^']*'/, `apiKey: '${key}'`));

// Until the cutover the sites may only connect to themselves; now also to the API.
const ownCsp = `connect-src 'self' https://${host} wss://${host}`;
for (const file of ['index.html', 'cv-builder.html', 'vercel.json', 'nginx-security-headers.conf']) {
  edit(`${web}/${file}`, text => replaceOnce(text, "connect-src 'self';", `${ownCsp};`, file));
}
edit(`${web}/scripts/update-security-policy.mjs`, text =>
  replaceOnce(text, `"connect-src 'self'",`, `"${ownCsp}",`, 'scripts/update-security-policy.mjs'));

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + 's';
for (const file of ['index.html', 'cv-builder.html']) {
  edit(`${web}/${file}`, text => text.replace(/runtime-config\.js\?v=[0-9a-z]+/, `runtime-config.js?v=${stamp}`));
}

// The maintenance page (shown while there was no backend) goes away on both sites.
edit(`${web}/vercel.json`, text => {
  const config = JSON.parse(text);
  delete config.redirects;
  return JSON.stringify(config, null, 2) + '\n';
});
edit('next.config.mjs', text => replaceOnce(text, 'const MAINTENANCE = true;', 'const MAINTENANCE = false;', 'next.config.mjs'));

console.log(`
Növbəti addımlar:
  1. Admin panel (Vercel → asoiu-career-admin → Settings → Environment Variables, Production),
     push-dan ƏVVƏL:
       NEXT_PUBLIC_API_URL = ${url}
       NEXT_PUBLIC_API_KEY = <ANON_KEY>
     (adlar köhnədir, dəyərlər yeni MySQL API-nin ünvanı və açarıdır)
  2. Testlər:  node --test tests/*.test.mjs
  3. Commit və push: git add -A && git commit -m "chore: switch the sites to ${host}" && git push origin main
     Vercel hər iki saytı yenidən yığır; texniki işlər səhifəsi yox olur.`);
