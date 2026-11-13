import { readFileSync } from 'node:fs';

// Sources are read from this repository only (audit 2026-11-13, #86): no
// fallback to sibling folders, so a test never passes on files outside it.
export function readSource(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}
