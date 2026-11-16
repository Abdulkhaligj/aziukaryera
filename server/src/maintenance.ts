// One-off data upgrades run when the API starts.
import type { Pool } from 'mysql2/promise';
import { codeHash, decryptField, encryptField, isEncrypted } from './crypto.ts';
import { exec, rows } from './db.ts';

/** Claim codes written before encryption (#73): encrypt them and add their hash. */
export async function encryptLegacyClaimCodes(pool: Pool): Promise<number> {
  const legacy = await rows<{ id: string; code: string }>(pool, `SELECT id, code FROM benefit_claims WHERE code NOT LIKE 'enc:v1:%'`);
  for (const row of legacy) {
    if (isEncrypted(row.code)) continue;
    await exec(pool, 'UPDATE benefit_claims SET code = ?, code_hash = ? WHERE id = ? AND code = ?', [encryptField(row.code), codeHash(row.code), row.id, row.code]);
  }
  return legacy.length;
}

/** Claim codes hashed before the keyed lookup hash (L13): their hash is renewed. */
export async function rehashClaimCodes(pool: Pool): Promise<number> {
  const claims = await rows<{ id: string; code: string; code_hash: string | null }>(pool,
    `SELECT id, code, code_hash FROM benefit_claims WHERE code LIKE 'enc:v1:%'`);
  let changed = 0;
  for (const row of claims) {
    const hash = codeHash(String(decryptField(row.code)));
    if (hash === row.code_hash) continue;
    await exec(pool, 'UPDATE benefit_claims SET code_hash = ? WHERE id = ? AND code = ?', [hash, row.id, row.code]);
    changed++;
  }
  return changed;
}
