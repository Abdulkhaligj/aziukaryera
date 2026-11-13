// Field encryption at rest (audit 2026-11-13, #73): AES-256-GCM with a key from
// DATA_ENCRYPTION_KEY (32 bytes, base64), or derived from the JWT secret when
// that is not set. Values look like "enc:v1:<iv>:<tag>:<ciphertext>" (base64url).
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

let key: Buffer | null = null;
export function setEncryptionKey(dataKey: string | undefined, jwtSecret: string) {
  if (dataKey) {
    const raw = Buffer.from(dataKey, 'base64');
    if (raw.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    key = raw;
  } else {
    key = Buffer.from(hkdfSync('sha256', Buffer.from(jwtSecret), Buffer.alloc(0), Buffer.from('asoiu-career field encryption v1'), 32));
  }
}
const need = () => { if (!key) throw new Error('encryption key not set'); return key; };

export const isEncrypted = (value: unknown) => typeof value === 'string' && value.startsWith('enc:v1:');

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', need(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${data.toString('base64url')}`;
}

/** The plain text of an encrypted value; other values come back unchanged. */
export function decryptField(value: unknown): unknown {
  if (!isEncrypted(value)) return value;
  const [, , iv, tag, data] = String(value).split(':');
  const decipher = createDecipheriv('aes-256-gcm', need(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** The lookup key of a claim code: SHA-256 of the trimmed, upper-case code. */
export const codeHash = (code: string) => createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

/** Columns stored encrypted and shown decrypted to the readers the policies allow. */
export const ENCRYPTED_COLUMNS: Record<string, string[]> = { benefit_claims: ['code'] };
