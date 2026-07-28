import { loginRequestSchema, registerRequestSchema } from '@mymd/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from '../../lib/api-error.js';
import {
  requireAllowedOrigin,
  requireMutationAuth,
  requireSession,
} from './auth-guards.js';
import type { AuthService, CreatedSession } from './auth-service.js';

const productionSessionCookie = '__Host-mymd_session';
const developmentSessionCookie = 'mymd_session';
const csrfCookie = 'mymd_csrf';

type AuthRouteOptions = {
  authService: AuthService;
  sessionTtlDays: number;
  secureCookies: boolean;
  webOrigin: string;
};

export function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): void {
  const sessionCookie = options.secureCookies
    ? productionSessionCookie
    : developmentSessionCookie;

  app.addHook('preHandler', async (request) => {
    request.authSession = await options.authService.authenticate(
      request.cookies[sessionCookie],
    );
  });

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      requireAllowedOrigin(request, options.webOrigin);
      const body = registerRequestSchema.parse(request.body);
      const result = await options.authService.register(
        body.email,
        body.password,
        requestContext(request),
        request.id,
      );
      return sendCreatedSession(
        reply,
        result,
        sessionCookie,
        options.sessionTtlDays,
        options.secureCookies,
        201,
      );
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      requireAllowedOrigin(request, options.webOrigin);
      const body = loginRequestSchema.parse(request.body);
      const result = await options.authService.login(
        body.email,
        body.password,
        requestContext(request),
        request.id,
      );
      return sendCreatedSession(
        reply,
        result,
        sessionCookie,
        options.sessionTtlDays,
        options.secureCookies,
        200,
      );
    },
  );

  app.get('/auth/me', async (request, reply) => {
    const session = requireSession(request);
    const csrfToken = request.cookies[csrfCookie];
    if (!csrfToken || !options.authService.csrfMatches(session, csrfToken)) {
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in required.');
    }
    return reply.header('Cache-Control', 'no-store').send({
      user: session.user,
      csrfToken,
    });
  });

  app.get('/auth/sessions', async (request, reply) => {
    const session = requireSession(request);
    const result = await options.authService.listSessions(
      session.user.id,
      session.id,
    );
    return reply.header('Cache-Control', 'no-store').send(result);
  });

  app.post('/auth/logout', async (request, reply) => {
    const session = requireMutationAuth(
      request,
      options.authService,
      options.webOrigin,
    );
    await options.authService.logout(session.id, request.id);
    clearAuthCookies(reply, sessionCookie, options.secureCookies);
    return reply.status(204).send();
  });

  app.post('/auth/logout-all', async (request, reply) => {
    const session = requireMutationAuth(
      request,
      options.authService,
      options.webOrigin,
    );
    await options.authService.logoutAll(session.user.id, request.id);
    clearAuthCookies(reply, sessionCookie, options.secureCookies);
    return reply.status(204).send();
  });

  app.delete<{ Params: { sessionId: string } }>(
    '/auth/sessions/:sessionId',
    async (request, reply) => {
      const session = requireMutationAuth(
        request,
        options.authService,
        options.webOrigin,
      );
      await options.authService.revokeSession(
        session.user.id,
        request.params.sessionId,
      );
      if (session.id === request.params.sessionId) {
        clearAuthCookies(reply, sessionCookie, options.secureCookies);
      }
      return reply.status(204).send();
    },
  );
}

function requestContext(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    userAgentSummary:
      typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
  };
}

function sendCreatedSession(
  reply: FastifyReply,
  result: CreatedSession,
  sessionCookie: string,
  sessionTtlDays: number,
  secure: boolean,
  statusCode: 200 | 201,
): FastifyReply {
  const maxAge = sessionTtlDays * 24 * 60 * 60;
  reply.setCookie(sessionCookie, result.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
  reply.setCookie(csrfCookie, result.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
  return reply.status(statusCode).header('Cache-Control', 'no-store').send({
    user: result.user,
    csrfToken: result.csrfToken,
  });
}

function clearAuthCookies(
  reply: FastifyReply,
  sessionCookie: string,
  secure: boolean,
): void {
  const options = { path: '/', sameSite: 'lax' as const, secure };
  reply.clearCookie(sessionCookie, options);
  reply.clearCookie(csrfCookie, options);
}
