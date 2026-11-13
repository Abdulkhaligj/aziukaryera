// One-off data upgrades run when the API starts.
import type { Pool } from 'mysql2/promise';
import { codeHash, encryptField, isEncrypted } from './crypto.ts';
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
