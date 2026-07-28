import type {
  AuthResponse,
  SessionListResponse,
  UserDto,
} from '@mymd/contracts';
import { Prisma, type PrismaClient, type User } from '@prisma/client';
import argon2 from 'argon2';

import { ApiError } from '../../lib/api-error.js';
import {
  createOpaqueToken,
  hashToken,
  tokenMatches,
} from '../../lib/tokens.js';
import type { AuthenticatedSession, SessionContext } from './auth-types.js';

const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

export type CreatedSession = AuthResponse & {
  sessionToken: string;
};

export class AuthService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionTtlDays: number,
  ) {}

  public async register(
    email: string,
    password: string,
    context: SessionContext,
    requestId: string,
  ): Promise<CreatedSession> {
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await argon2.hash(password, passwordOptions);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { email: email.trim(), normalizedEmail, passwordHash },
        });
        const session = await this.createSession(transaction, user, context);
        await transaction.auditEvent.create({
          data: {
            actorId: user.id,
            action: 'AUTH_REGISTER',
            result: 'SUCCESS',
            requestId,
          },
        });
        return session;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiError(
          409,
          'INVALID_CREDENTIALS',
          'Unable to create an account with those credentials.',
        );
      }
      throw error;
    }
  }

  public async login(
    email: string,
    password: string,
    context: SessionContext,
    requestId: string,
  ): Promise<CreatedSession> {
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail: normalizeEmail(email) },
    });
    const valid =
      user !== null &&
      user.disabledAt === null &&
      (await argon2.verify(user.passwordHash, password));

    if (!valid || user === null) {
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'The email or password is incorrect.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const session = await this.createSession(transaction, user, context);
      await transaction.auditEvent.create({
        data: {
          actorId: user.id,
          action: 'AUTH_LOGIN',
          result: 'SUCCESS',
          requestId,
        },
      });
      return session;
    });
  }

  public async authenticate(
    sessionToken: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!sessionToken) return null;

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(sessionToken) },
      include: { user: true },
    });
    const now = new Date();
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      session.user.disabledAt !== null ||
      session.sessionEpoch !== session.user.sessionEpoch
    ) {
      return null;
    }

    return {
      id: session.id,
      user: toUserDto(session.user),
      csrfTokenHash: session.csrfTokenHash,
    };
  }

  public async logout(sessionId: string, requestId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditEvent.create({
        data: {
          action: 'AUTH_LOGOUT',
          result: 'SUCCESS',
          requestId,
        },
      }),
    ]);
  }

  public async logoutAll(userId: string, requestId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { sessionEpoch: { increment: 1 } },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditEvent.create({
        data: {
          actorId: userId,
          action: 'AUTH_LOGOUT_ALL',
          result: 'SUCCESS',
          requestId,
        },
      }),
    ]);
  }

  public async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionListResponse> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      items: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        current: session.id === currentSessionId,
        userAgentSummary: session.userAgentSummary,
      })),
    };
  }

  public async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Session not found.');
    }
  }

  public csrfMatches(session: AuthenticatedSession, token: string): boolean {
    return tokenMatches(token, session.csrfTokenHash);
  }

  private async createSession(
    transaction: Prisma.TransactionClient,
    user: User,
    context: SessionContext,
  ): Promise<CreatedSession> {
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1000,
    );

    await transaction.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        sessionEpoch: user.sessionEpoch,
        expiresAt,
        userAgentSummary: context.userAgentSummary,
      },
    });

    return {
      user: toUserDto(user),
      csrfToken,
      sessionToken,
    };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
