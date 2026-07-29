import {
  authResponseSchema,
  errorResponseSchema,
  type SessionListResponse,
} from '@teammd/contracts';
import type { ServerConfig } from '@teammd/config';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app.js';
import { hashToken } from '../../lib/tokens.js';
import type { AuthService, CreatedSession } from './auth-service.js';
import type { AuthenticatedSession } from './auth-types.js';

const config: ServerConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  webOrigin: 'http://localhost:5173',
  databaseUrl: 'mysql://unused',
  collaborationPort: 3001,
  collaborationUrl: 'ws://localhost:3001/',
  sessionTtlDays: 30,
  secureCookies: false,
};

const user = {
  id: 'cm1234567890abcdefghijklm',
  email: 'person@example.com',
  emailVerifiedAt: null,
  createdAt: '2026-07-27T12:00:00.000Z',
} as const;

class FakeAuthService {
  public register = vi
    .fn<() => Promise<CreatedSession>>()
    .mockResolvedValue(createdSession());
  public login = vi
    .fn<() => Promise<CreatedSession>>()
    .mockResolvedValue(createdSession());
  public logout = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  public logoutAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  public revokeSession = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  public listSessions = vi
    .fn<() => Promise<SessionListResponse>>()
    .mockResolvedValue({ items: [] });

  public authenticate(
    token: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    return Promise.resolve(
      token === 'session-token'
        ? {
            id: 'cm1234567890sessionidxyz',
            user: { ...user },
            csrfTokenHash: hashToken('a'.repeat(43)),
          }
        : null,
    );
  }

  public csrfMatches(session: AuthenticatedSession, token: string): boolean {
    return hashToken(token) === session.csrfTokenHash;
  }
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('authentication routes', () => {
  it('returns liveness without touching the database', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('rejects invalid registration input with the standard envelope', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: config.webOrigin },
      payload: { email: 'not-an-email', password: 'short' },
    });

    expect(response.statusCode).toBe(400);
    const error = errorResponseSchema.parse(response.json());
    expect(error.error.code).toBe('VALIDATION_ERROR');
    expect(error.error.requestId).toBeTypeOf('string');
  });

  it('rejects registration from an untrusted origin', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'https://attacker.example' },
      payload: validCredentials(),
    });

    expect(response.statusCode).toBe(403);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(
      'CSRF_INVALID',
    );
  });

  it('sets an HttpOnly session cookie and returns CSRF bootstrap data', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: config.webOrigin },
      payload: validCredentials(),
    });

    expect(response.statusCode).toBe(200);
    expect(authResponseSchema.parse(response.json())).toEqual({
      user,
      csrfToken: 'a'.repeat(43),
    });
    const cookies = String(response.headers['set-cookie']);
    expect(cookies).toContain('teammd_session=session-token');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('SameSite=Lax');
  });

  it('requires both active session and matching CSRF for logout', async () => {
    const service = new FakeAuthService();
    const app = await createTestApp(service);
    const cookie =
      'teammd_session=session-token; teammd_csrf=' + 'a'.repeat(43);
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: config.webOrigin, cookie, 'x-csrf-token': 'wrong' },
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        origin: config.webOrigin,
        cookie,
        'x-csrf-token': 'a'.repeat(43),
      },
    });

    expect(rejected.statusCode).toBe(403);
    expect(errorResponseSchema.parse(rejected.json()).error.code).toBe(
      'CSRF_INVALID',
    );
    expect(accepted.statusCode).toBe(204);
    expect(service.logout).toHaveBeenCalledOnce();
  });
});

async function createTestApp(service = new FakeAuthService()) {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
  } as unknown as PrismaClient;
  const app = await buildApp({
    config,
    prisma,
    authService: service as unknown as AuthService,
  });
  apps.push(app);
  return app;
}

function validCredentials() {
  return {
    email: 'person@example.com',
    password: 'correct horse battery staple',
  };
}

function createdSession(): CreatedSession {
  return {
    user: { ...user },
    csrfToken: 'a'.repeat(43),
    sessionToken: 'session-token',
  };
}
