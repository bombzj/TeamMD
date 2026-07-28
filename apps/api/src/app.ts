import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ServerConfig } from '@mymd/config';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { ApiError, sendApiError } from './lib/api-error.js';
import type { CollaborationCheckpointService } from './modules/collaboration/collaboration-checkpoint-service.js';
import { CollaborationService } from './modules/collaboration/collaboration-service.js';
import { AuthService } from './modules/auth/auth-service.js';
import { registerAuthRoutes } from './modules/auth/auth-routes.js';
import './modules/auth/auth-types.js';
import { registerWorkspaceRoutes } from './modules/workspace/workspace-routes.js';
import { WorkspaceService } from './modules/workspace/workspace-service.js';

type BuildAppOptions = {
  config: ServerConfig;
  prisma: PrismaClient;
  authService?: AuthService;
  collaborationCheckpointService?: CollaborationCheckpointService;
  collaborationService?: CollaborationService;
  workspaceService?: WorkspaceService;
};

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.config.nodeEnv === 'test'
        ? false
        : {
            redact: ['req.headers.cookie', 'req.headers.authorization'],
          },
    bodyLimit: 64 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  app.decorateRequest('authSession', null);
  await app.register(cookie);
  await app.register(cors, {
    origin: options.config.webOrigin,
    credentials: true,
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    global: false,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return sendApiError(request, reply, error);
    }
    if (error instanceof ZodError) {
      return sendApiError(
        request,
        reply,
        new ApiError(400, 'VALIDATION_ERROR', 'The request is invalid.', {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }),
      );
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return sendApiError(
      request,
      reply,
      new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.'),
    );
  });

  app.get('/api/v1/health/live', () => ({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    await options.prisma.$queryRaw`SELECT 1`;
    return reply.send({ status: 'ok' });
  });

  await app.register(
    (api, _pluginOptions, done) => {
      const authService =
        options.authService ??
        new AuthService(options.prisma, options.config.sessionTtlDays);
      registerAuthRoutes(api, {
        authService,
        sessionTtlDays: options.config.sessionTtlDays,
        secureCookies: options.config.secureCookies,
        webOrigin: options.config.webOrigin,
      });
      registerWorkspaceRoutes(api, {
        authService,
        ...(options.collaborationCheckpointService === undefined
          ? {}
          : {
              collaborationCheckpointService:
                options.collaborationCheckpointService,
            }),
        collaborationService:
          options.collaborationService ??
          new CollaborationService(options.prisma),
        collaborationWebsocketUrl: options.config.collaborationUrl,
        webOrigin: options.config.webOrigin,
        workspaceService:
          options.workspaceService ?? new WorkspaceService(options.prisma),
      });
      done();
    },
    { prefix: '/api/v1' },
  );

  return app;
}
