// Prints a JWT secret and the anon / service_role API keys signed with it,
// in the standard form (HS256 JWTs with a role claim).
//   node tools/generate-keys.mjs >> .env
// The keys live KEY_LIFETIME_DAYS (default 730, two years; audit 2026-11-13,
// M-08). deploy/universitet-mysql/scripts/rotate-keys.sh replaces them.
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';

const secret = process.env.JWT_SECRET || randomBytes(48).toString('base64url');
const key = new TextEncoder().encode(secret);
const days = Math.min(Math.max(Number(process.env.KEY_LIFETIME_DAYS || 730), 30), 1095);
const iat = Math.floor(Date.now() / 1000);
const exp = iat + days * 24 * 3600;
const sign = role => new SignJWT({ role, iss: 'asoiu-career' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setIssuedAt(iat).setExpirationTime(exp).sign(key);

console.log(`JWT_SECRET=${secret}`);
console.log(`ANON_KEY=${await sign('anon')}`);
console.log(`SERVICE_ROLE_KEY=${await sign('service_role')}`);
