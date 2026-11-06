import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpError } from './security';

export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

// SETTINGS_ENCRYPTION_KEY: base64 of exactly 32 random bytes. Read on every call so a rotated env var takes effect without a restart.
function key(): Buffer | null {
  const k = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY ?? '', 'base64');
  return k.length === 32 ? k : null;
}

export const encryptionConfigured = (): boolean => key() !== null;

// AES-256-GCM with a fresh 12-byte IV. The provider name is bound in as AAD so a ciphertext cannot be moved to another row.
export function encryptSecret(plain: string, aad: string): Sealed {
  const k = key();
  if (!k) throw new HttpError(503, 'SETTINGS_ENCRYPTION_KEY is not set or is not 32 bytes of base64');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

export function decryptSecret(s: Sealed, aad: string): string {
  const k = key();
  if (!k) throw new Error('SETTINGS_ENCRYPTION_KEY is not set');
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(s.iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.ciphertext, 'base64')), d.final()]).toString('utf8');
}
