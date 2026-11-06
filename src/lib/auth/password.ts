import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const KEYLEN = 64;

const derive = (password: string, salt: Buffer, n: number): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, KEYLEN, { N: n }, (err, key) => (err ? reject(err) : resolve(key))));

// Format: scrypt:N:saltHex:hashHex  (never "$": Next.js expands $VAR sequences in .env files and would corrupt the hash)
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt:${N}:${salt.toString("hex")}:${(await derive(plain, salt, N)).toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, n, saltHex, hashHex] = stored.split(":");
  const cost = Number(n);
  if (scheme !== 'scrypt' || !Number.isInteger(cost) || cost < 2 || !/^[0-9a-f]+$/.test(saltHex ?? '') || !/^[0-9a-f]+$/.test(hashHex ?? '')) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await derive(plain, Buffer.from(saltHex, 'hex'), cost);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
