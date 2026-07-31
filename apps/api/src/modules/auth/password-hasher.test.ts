import { describe, expect, it } from 'vitest';

import { hashPassword, passwordMatches } from './password-hasher.js';

describe('password hasher', () => {
  it('round-trips a password using a versioned scrypt hash', async () => {
    const encodedHash = await hashPassword('correct horse battery staple');

    expect(encodedHash).toMatch(/^scrypt-v1\$32768\$8\$1\$/);
    await expect(
      passwordMatches(encodedHash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(passwordMatches(encodedHash, 'wrong password')).resolves.toBe(
      false,
    );
  });

  it('uses a new random salt for each password hash', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');

    expect(first).not.toBe(second);
  });

  it.each([
    '',
    'not-a-password-hash',
    'scrypt-v1$1$8$1$c2FsdA$a2V5',
    'scrypt-v1$32768$8$1$c2FsdA$a2V5',
  ])('rejects malformed or unsupported hash %j', async (encodedHash) => {
    await expect(passwordMatches(encodedHash, 'password')).resolves.toBe(false);
  });
});
