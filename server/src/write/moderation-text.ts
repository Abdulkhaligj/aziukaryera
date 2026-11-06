// The profanity filter of the Postgres database (private.mod_prep, mod_tokens,
// mod_scripts, mod_map, mod_skel, mod_mask, mod_candidates, mod_phrase_lines,
// mod_term and moderation_blocked_term), ported character for character.
// Matching is exact (byte equality), as in Postgres, not MySQL-collated.

const LATIN_EXTRA = '\u{259}\u{131}\u{142}\u{f8}\u{111}\u{df}\u{e6}\u{153}\u{fe}';
const CYRILLIC = '\u{430}-\u{44f}\u{456}\u{457}\u{454}\u{491}\u{45e}\u{455}\u{458}\u{4bb}\u{501}\u{51b}\u{51d}';
const ARABIC = '\u{621}-\u{63a}\u{641}-\u{64a}\u{671}-\u{6d3}';
const GREEK = '\u{3b1}-\u{3c9}';
const WORD = `a-z${LATIN_EXTRA}${CYRILLIC}${ARABIC}${GREEK}0-9@$`;

const INVISIBLE = /[\u{ad}\u{34f}\u{61c}\u{115f}\u{1160}\u{17b4}\u{17b5}\u{180b}-\u{180f}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{206f}\u{3164}\u{fe00}-\u{fe0f}\u{feff}\u{ffa0}\u{e0000}-\u{e007f}]/gu;
const MARKS = /[\u{300}-\u{36f}\u{610}-\u{61a}\u{64b}-\u{65f}\u{670}\u{6d6}-\u{6ed}\u{640}]/gu;
const SEPARATORS = /[\] \t\n\r\f\v\u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000},;:"()[{}\/\\<>=\u{ab}\u{bb}\u{201e}\u{201c}\u{201d}'\u{2018}\u{2019}`\u{b4}]+/u;
const EDGES = new RegExp(`^[^${WORD}]+|[^${WORD}]+$`, 'gu');
const HAS = {
  latin: new RegExp(`[a-z${LATIN_EXTRA}]`, 'u'), greek: new RegExp(`[${GREEK}]`, 'u'),
  cyrillic: new RegExp(`[${CYRILLIC}]`, 'u'), arabic: new RegExp(`[${ARABIC}]`, 'u')
};
const NOT_LETTER: Record<Script, RegExp> = { latin: /[^a-z]/gu, cyrillic: /[^\u{430}-\u{44f}]/gu, arabic: new RegExp(`[^${ARABIC}]`, 'gu') };
const NOT_MASKED: Record<Script, RegExp> = { latin: /[^a-z\u{b7}]/gu, cyrillic: /[^\u{430}-\u{44f}\u{b7}]/gu, arabic: new RegExp(`[^${ARABIC}\u{b7}]`, 'gu') };
const MASKABLE = new RegExp(`[${WORD}][*#%?_\u{2022}\u{b7}]+[${WORD}]|[${WORD}][*#%?_\u{2022}\u{b7}]+$`, 'u');
const MAP: Record<Script, [string, string]> = {
  latin: ['\u{430}\u{432}\u{435}\u{43a}\u{43c}\u{43d}\u{43e}\u{440}\u{441}\u{442}\u{443}\u{445}\u{456}\u{458}\u{455}\u{4bb}\u{501}\u{51b}\u{51d}\u{44c}'
    + '\u{3b1}\u{3b2}\u{3b3}\u{3b5}\u{3b6}\u{3b7}\u{3b9}\u{3ba}\u{3bc}\u{3bd}\u{3bf}\u{3c1}\u{3c3}\u{3c2}\u{3c4}\u{3c5}\u{3c7}\u{3c9}'
    + '01345789@$!|+\u{20ac}\u{a2}\u{a9}\u{259}\u{131}\u{142}\u{f8}\u{111}\u{df}\u{e6}\u{153}\u{fe}lv',
  'abekmhopctyxijshdqwbabyeznikuuopoctuxwoieastbgasiitecceiiodsaopiu'],
  cyrillic: ['aceopxykmtbhi3046@\u{44a}\u{456}\u{457}\u{454}\u{491}',
    '\u{430}\u{441}\u{435}\u{43e}\u{440}\u{445}\u{443}\u{43a}\u{43c}\u{442}\u{432}\u{43d}\u{438}\u{437}\u{43e}\u{447}\u{431}\u{430}\u{44c}\u{438}\u{438}\u{435}\u{433}'],
  arabic: ['\u{623}\u{625}\u{622}\u{671}\u{649}\u{6cc}\u{6a9}\u{629}\u{624}\u{626}\u{6c0}\u{6c1}\u{6be}',
    '\u{627}\u{627}\u{627}\u{627}\u{64a}\u{64a}\u{643}\u{647}\u{648}\u{64a}\u{647}\u{647}\u{647}']
};
const MIDDLE_FINGER = '\u{1f595}';

export type Script = 'latin' | 'cyrillic' | 'arabic';
export type Term = { term: string; match: string; script: string; tier: string };
export type Allowed = { word: string; script: string };
interface Candidate { script: Script; cand: string; kind: 'token' | 'mask' | 'run' | 'bigram' }

const chars = (s: string) => [...s];
const len = (s: string) => chars(s).length;
const collapse = (s: string) => s.replace(/(.)\1{2,}/gu, '$1');

/** Postgres translate(): first occurrence wins; unmatched extra characters are deleted. */
function translator(from: string, to: string) {
  const target = chars(to);
  const map = new Map<string, string>();
  chars(from).forEach((ch, i) => { if (!map.has(ch)) map.set(ch, i < target.length ? target[i] : ''); });
  return (s: string) => chars(s).map(ch => map.get(ch) ?? ch).join('');
}
const TRANSLATE = Object.fromEntries(Object.entries(MAP).map(([k, [f, t]]) => [k, translator(f, t)])) as Record<Script, (s: string) => string>;
const toMaskDots = translator('*#%?_\u{2022}\u{b7}', '\u{b7}'.repeat(7));

export const prep = (p: string | null) =>
  (p ?? '').normalize('NFKC').replace(INVISIBLE, '').toLowerCase().normalize('NFD').replace(MARKS, '');

export const tokens = (p: string | null) => prep(p).split(SEPARATORS).map(x => x.replace(EDGES, '')).filter(t => t !== '');

export function scripts(tok: string): Script[] {
  const found: Script[] = [];
  if (HAS.latin.test(tok) || HAS.greek.test(tok) || !(HAS.cyrillic.test(tok) || HAS.arabic.test(tok))) found.push('latin');
  if (HAS.cyrillic.test(tok)) found.push('cyrillic');
  if (HAS.arabic.test(tok)) found.push('arabic');
  return found;
}

export const skel = (tok: string, script: Script) => collapse(TRANSLATE[script](tok).replace(NOT_LETTER[script], ''));

export function mask(tok: string, script: Script): string | null {
  if (!MASKABLE.test(tok)) return null;
  let s = TRANSLATE[script](toMaskDots(tok)).replace(NOT_MASKED[script], '');
  s = s.replace(/([^\u{b7}])\1{2,}/gu, '$1');
  const masks = chars(s).filter(c => c === '\u{b7}').length;
  const letters = len(s) - masks;
  if (letters < 2 || masks < 1 || masks > letters) return null;
  return s.replaceAll('\u{b7}', '.');
}

export function candidates(p: string): Candidate[] {
  const toks = tokens(p);
  const out: Candidate[] = [];
  const sk: Record<Script, Map<number, string>> = { latin: new Map(), cyrillic: new Map(), arabic: new Map() };
  toks.forEach((tok, i) => {
    for (const sc of scripts(tok)) {
      const k = skel(tok, sc);
      if (k !== '') { out.push({ script: sc, cand: k, kind: 'token' }); sk[sc].set(i, k); }
      const pattern = mask(tok, sc);
      if (pattern !== null) out.push({ script: sc, cand: pattern, kind: 'mask' });
    }
  });
  for (const sc of ['latin', 'cyrillic', 'arabic'] as Script[]) {
    let run = '';
    let runLength = 0;
    for (let i = 0; i <= toks.length; i++) {
      const k = sk[sc].get(i);
      if (k !== undefined && len(k) === 1) { run += k; runLength++; continue; }
      if (runLength >= 3) out.push({ script: sc, cand: collapse(run), kind: 'run' });
      run = ''; runLength = 0;
    }
    for (let i = 0; i < toks.length - 1; i++) {
      const a = sk[sc].get(i), b = sk[sc].get(i + 1);
      if (a !== undefined && b !== undefined && Math.max(len(a), len(b)) <= 4) out.push({ script: sc, cand: collapse(a + b), kind: 'bigram' });
    }
  }
  return out;
}

export function phraseLines(p: string): { script: Script; line: string }[] {
  const lines = new Map<Script, string[]>();
  for (const tok of tokens(p)) {
    for (const sc of scripts(tok)) {
      const k = skel(tok, sc);
      if (k === '') continue;
      if (!lines.has(sc)) lines.set(sc, []);
      lines.get(sc)!.push(k);
    }
  }
  return [...lines].map(([script, parts]) => ({ script, line: ` ${parts.join(' ')} ` }));
}

/** private.mod_term: the normalised form of a term an admin adds, or null. */
export function normaliseTerm(p: string | null): { script: Script; term: string } | null {
  const toks = tokens(p);
  if (!toks.length) return null;
  let script: Script | null = null;
  const parts: string[] = [];
  for (const tok of toks) {
    const sc = scripts(tok);
    if (sc.length !== 1 || (script !== null && sc[0] !== script)) return null;
    script = sc[0];
    parts.push(skel(tok, script));
  }
  if (parts.includes('')) return null;
  return { script: script!, term: parts.join(' ') };
}

/** private.moderation_text */
export function moderationText(body: unknown, link: unknown = null, tags: unknown = null): string {
  const tagText = Array.isArray(tags) ? tags.filter(t => t != null).map(String).join('\n') : null;
  return [body, link, tagText].filter(v => v != null && v !== '').map(String).join('\n');
}

/** private.moderation_blocked_term: the first matching active term, or null. */
export function blockedTerm(text: string | null, terms: Term[], allowed: Allowed[]): string | null {
  if (!text) return null;
  if (text.includes(MIDDLE_FINGER)) return MIDDLE_FINGER;
  const allow = new Set(allowed.map(a => `${a.script}\u0000${a.word}`));
  const cands = candidates(text).filter(c => !allow.has(`${c.script}\u0000${c.cand}`));
  const byTerm = new Map<string, Term[]>();
  for (const t of terms) byTerm.set(t.term, [...(byTerm.get(t.term) ?? []), t]);
  const words = cands.filter(c => c.kind === 'token' || c.kind === 'run');

  // Whole words, and short split pairs of curated terms.
  for (const c of cands) {
    const hit = (byTerm.get(c.cand) ?? []).find(t => (c.kind !== 'mask' && c.kind !== 'bigram' && t.match === 'word') || (c.kind === 'bigram' && t.tier === 'A'));
    if (hit) return hit.term;
  }
  // A word starting with a stem.
  for (const c of words) {
    const letters = chars(c.cand);
    for (let n = 3; n <= letters.length; n++) {
      const hit = (byTerm.get(letters.slice(0, n).join('')) ?? []).find(t => t.match === 'stem' || t.match === 'infix');
      if (hit) return hit.term;
    }
  }
  // A root anywhere in the word.
  for (const c of words) {
    const hit = terms.find(t => t.match === 'infix' && t.script === c.script && c.cand.includes(t.term));
    if (hit) return hit.term;
  }
  // Masked letters: f*ck, s*kt*r.
  for (const c of cands.filter(x => x.kind === 'mask')) {
    for (const t of terms) {
      if (t.script !== c.script || t.term.includes(' ')) continue;
      const exact = t.match === 'word' && len(t.term) === len(c.cand) && new RegExp(`^${c.cand}$`, 'u').test(t.term);
      const prefix = t.match !== 'word' && len(t.term) <= len(c.cand)
        && new RegExp(`^${chars(c.cand).slice(0, len(t.term)).join('')}$`, 'u').test(t.term);
      if (exact || prefix) return t.term;
    }
  }
  // Multi-word terms.
  for (const l of phraseLines(text)) {
    const hit = terms.find(t => t.script === l.script && t.term.includes(' ') && l.line.includes(` ${t.term}${t.match === 'word' ? ' ' : ''}`));
    if (hit) return hit.term;
  }
  return null;
}
