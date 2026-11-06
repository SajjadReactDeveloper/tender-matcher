import { describe, expect, test } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  test('a hash verifies for the right password and fails for a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt:\d+:[0-9a-f]+:[0-9a-f]+$/);
    expect(hash).not.toContain('$'); // Next.js expands $VAR sequences in .env files, which would corrupt the hash
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  test('the same password hashes differently each time (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  test('a malformed stored hash never verifies and never throws', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'plaintext-password')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:notanumber:aa:bb')).toBe(false);
  });
});
