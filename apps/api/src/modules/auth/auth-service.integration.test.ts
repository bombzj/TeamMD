import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from './auth-service.js';

dotenv.config({ path: '../../.env.local' });

const prisma = new PrismaClient({ log: ['error'] });
const authService = new AuthService(prisma, 30);
const testEmail = `auth-test-${crypto.randomUUID()}@example.test`;
const password = 'correct horse battery staple';
const replacementPassword = 'another secure password phrase';
const context = { userAgentSummary: 'Vitest integration' };
let userId: string;
let registrationSessionToken: string;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  if (userId) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe('AuthService with MySQL', () => {
  it('registers with normalized identity and hashed credentials', async () => {
    const result = await authService.register(
      `  ${testEmail.toUpperCase()}  `,
      password,
      context,
      'integration-register',
    );
    userId = result.user.id;
    registrationSessionToken = result.sessionToken;

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const storedSession = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashForTest(result.sessionToken) },
    });

    expect(storedUser.normalizedEmail).toBe(testEmail);
    expect(storedUser.passwordHash).not.toContain(password);
    expect(storedUser.passwordHash).toMatch(/^scrypt-v1\$/);
    expect(storedSession.tokenHash).not.toBe(result.sessionToken);
    expect(storedSession.csrfTokenHash).not.toBe(result.csrfToken);
  });

  it('logs in case-insensitively and revokes the resulting session', async () => {
    const result = await authService.login(
      testEmail.toUpperCase(),
      password,
      context,
      'integration-login',
    );
    const active = await authService.authenticate(result.sessionToken);

    expect(active?.user.id).toBe(userId);
    expect(active && authService.csrfMatches(active, result.csrfToken)).toBe(
      true,
    );

    await authService.logout(active!.id, 'integration-logout');
    await expect(
      authService.authenticate(result.sessionToken),
    ).resolves.toBeNull();
  });

  it('changes the password, revokes old sessions, and returns a replacement session', async () => {
    const oldSession = await authService.login(
      testEmail,
      password,
      context,
      'integration-password-login',
    );
    const replacement = await authService.changePassword(
      userId,
      password,
      replacementPassword,
      context,
      'integration-password-change',
    );

    await expect(
      authService.authenticate(registrationSessionToken),
    ).resolves.toBeNull();
    await expect(
      authService.authenticate(oldSession.sessionToken),
    ).resolves.toBeNull();
    await expect(
      authService.authenticate(replacement.sessionToken),
    ).resolves.toMatchObject({ user: { id: userId } });
    await expect(
      authService.login(
        testEmail,
        password,
        context,
        'integration-old-password',
      ),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    await expect(
      authService.login(
        testEmail,
        replacementPassword,
        context,
        'integration-new-password',
      ),
    ).resolves.toMatchObject({ user: { id: userId } });
  });
});

function hashForTest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
