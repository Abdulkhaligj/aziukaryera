import { existsSync, readFileSync } from 'node:fs';

// The standalone admin export keeps the portal in a sibling folder.
export function readSource(path) {
  let url = new URL('../' + path, import.meta.url);
  if (!existsSync(url) && path.startsWith('student-web/')) {
    url = new URL('../../esas-sayt-student-web/' + path.slice('student-web/'.length), import.meta.url);
  }
  return readFileSync(url, 'utf8');
}
