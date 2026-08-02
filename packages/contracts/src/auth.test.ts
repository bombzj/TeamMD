import { describe, expect, it } from 'vitest';

import {
  authResponseSchema,
  changePasswordRequestSchema,
  errorResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
} from './index.js';

describe('authentication contracts', () => {
  it('accepts a valid registration request', () => {
    const result = registerRequestSchema.parse({
      email: 'Person@example.com',
      password: 'correct horse battery staple',
    });

    expect(result.email).toBe('Person@example.com');
  });

  it('rejects short passwords and unknown fields', () => {
    expect(() =>
      registerRequestSchema.parse({
        email: 'person@example.com',
        password: 'too-short',
      }),
    ).toThrow();

    expect(() =>
      loginRequestSchema.parse({
        email: 'person@example.com',
        password: 'correct horse battery staple',
        rememberMe: true,
      }),
    ).toThrow();
  });

  it('requires a different valid password when changing credentials', () => {
    expect(
      changePasswordRequestSchema.parse({
        currentPassword: 'correct horse battery staple',
        newPassword: 'another secure password phrase',
      }),
    ).toEqual({
      currentPassword: 'correct horse battery staple',
      newPassword: 'another secure password phrase',
    });

    expect(() =>
      changePasswordRequestSchema.parse({
        currentPassword: 'correct horse battery staple',
        newPassword: 'correct horse battery staple',
      }),
    ).toThrow();
  });

  it('validates authenticated user and CSRF bootstrap data', () => {
    const result = authResponseSchema.parse({
      user: {
        id: 'cm1234567890abcdefghijklm',
        email: 'person@example.com',
        emailVerifiedAt: null,
        createdAt: '2026-07-27T12:00:00.000Z',
      },
      csrfToken: 'a'.repeat(43),
    });

    expect(result.user.email).toBe('person@example.com');
  });

  it('restricts errors to stable codes and ISO timestamps', () => {
    expect(() =>
      errorResponseSchema.parse({
        error: {
          code: 'MADE_UP_ERROR',
          message: 'Nope',
          requestId: 'req_123',
        },
      }),
    ).toThrow();

    expect(() =>
      authResponseSchema.parse({
        user: {
          id: 'cm1234567890abcdefghijklm',
          email: 'person@example.com',
          emailVerifiedAt: null,
          createdAt: 'yesterday',
        },
        csrfToken: 'a'.repeat(43),
      }),
    ).toThrow();
  });
});
