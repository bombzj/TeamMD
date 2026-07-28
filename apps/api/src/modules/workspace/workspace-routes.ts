import {
  collaborationCheckpointResponseSchema,
  collaborativeCheckpointRequestSchema,
  collaborationTicketResponseSchema,
  createDocumentRequestSchema,
  createFolderRequestSchema,
  documentContentResponseSchema,
  documentSummarySchema,
  folderSchema,
  permanentDeleteRequestSchema,
  saveDocumentRequestSchema,
  saveDocumentResponseSchema,
  trashResponseSchema,
  updateDocumentRequestSchema,
  updateFolderRequestSchema,
  workspaceTreeResponseSchema,
} from '@mymd/contracts';
import type { FastifyInstance } from 'fastify';

import { ApiError } from '../../lib/api-error.js';
import { requireMutationAuth, requireSession } from '../auth/auth-guards.js';
import type { AuthService } from '../auth/auth-service.js';
import type { CollaborationCheckpointService } from '../collaboration/collaboration-checkpoint-service.js';
import type { CollaborationService } from '../collaboration/collaboration-service.js';
import type { WorkspaceService } from './workspace-service.js';

type WorkspaceRouteOptions = {
  authService: AuthService;
  collaborationCheckpointService?: CollaborationCheckpointService;
  collaborationService: CollaborationService;
  collaborationWebsocketUrl: string;
  webOrigin: string;
  workspaceService: WorkspaceService;
};

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  options: WorkspaceRouteOptions,
): void {
  app.get('/workspace/tree', async (request, reply) => {
    const session = requireSession(request);
    const result = await options.workspaceService.listTree(session.user.id);
    return reply
      .header('Cache-Control', 'no-store')
      .send(workspaceTreeResponseSchema.parse(result));
  });

  app.get('/trash', async (request, reply) => {
    const session = requireSession(request);
    const result = await options.workspaceService.listTrash(session.user.id);
    return reply
      .header('Cache-Control', 'no-store')
      .send(trashResponseSchema.parse(result));
  });

  app.post('/folders', mutationRateLimit(), async (request, reply) => {
    const session = requireMutationSession(request, options);
    const body = createFolderRequestSchema.parse(request.body);
    const result = await options.workspaceService.createFolder(
      session.user.id,
      body,
      request.id,
    );
    return reply.status(201).send(folderSchema.parse(result));
  });

  app.patch<{ Params: { folderId: string } }>(
    '/folders/:folderId',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const body = updateFolderRequestSchema.parse(request.body);
      const result = await options.workspaceService.updateFolder(
        session.user.id,
        request.params.folderId,
        body,
        request.id,
      );
      return reply.send(folderSchema.parse(result));
    },
  );

  app.delete<{ Params: { folderId: string } }>(
    '/folders/:folderId',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      await options.workspaceService.trashFolder(
        session.user.id,
        request.params.folderId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { folderId: string } }>(
    '/folders/:folderId/restore',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const result = await options.workspaceService.restoreFolder(
        session.user.id,
        request.params.folderId,
        request.id,
      );
      return reply.send(folderSchema.parse(result));
    },
  );

  app.delete<{ Params: { folderId: string } }>(
    '/folders/:folderId/permanent',
    permanentDeleteRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      permanentDeleteRequestSchema.parse(request.body);
      await options.workspaceService.permanentlyDeleteFolder(
        session.user.id,
        request.params.folderId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.post('/documents', mutationRateLimit(), async (request, reply) => {
    const session = requireMutationSession(request, options);
    const body = createDocumentRequestSchema.parse(request.body);
    const result = await options.workspaceService.createDocument(
      session.user.id,
      body,
      request.id,
    );
    return reply.status(201).send(documentSummarySchema.parse(result));
  });

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/collaboration-ticket',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const result = await options.collaborationService.createTicket(
        session.user.id,
        session.id,
        request.params.documentId,
        options.collaborationWebsocketUrl,
      );
      return reply
        .header('Cache-Control', 'no-store')
        .send(collaborationTicketResponseSchema.parse(result));
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/collaboration-checkpoint',
    saveRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      if (options.collaborationCheckpointService === undefined) {
        throw new ApiError(
          503,
          'INTERNAL_ERROR',
          'Collaboration is temporarily unavailable.',
        );
      }
      const body = collaborativeCheckpointRequestSchema.parse(
        request.body ?? {},
      );
      const result = await options.collaborationCheckpointService.checkpoint(
        session.user.id,
        request.params.documentId,
        body,
        request.id,
      );
      return reply.send(collaborationCheckpointResponseSchema.parse(result));
    },
  );

  app.get<{ Params: { documentId: string } }>(
    '/documents/:documentId',
    async (request, reply) => {
      const session = requireSession(request);
      const result = await options.workspaceService.getDocument(
        session.user.id,
        request.params.documentId,
      );
      return reply
        .header('Cache-Control', 'no-store')
        .send(documentContentResponseSchema.parse(result));
    },
  );

  app.put<{ Params: { documentId: string } }>(
    '/documents/:documentId/content',
    saveRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const body = saveDocumentRequestSchema.parse(request.body);
      const result = await options.workspaceService.saveDocument(
        session.user.id,
        request.params.documentId,
        body,
        request.id,
      );
      return reply.send(saveDocumentResponseSchema.parse(result));
    },
  );

  app.patch<{ Params: { documentId: string } }>(
    '/documents/:documentId',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const body = updateDocumentRequestSchema.parse(request.body);
      const result = await options.workspaceService.updateDocument(
        session.user.id,
        request.params.documentId,
        body,
        request.id,
      );
      return reply.send(documentSummarySchema.parse(result));
    },
  );

  app.delete<{ Params: { documentId: string } }>(
    '/documents/:documentId',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      await options.workspaceService.trashDocument(
        session.user.id,
        request.params.documentId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/restore',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const result = await options.workspaceService.restoreDocument(
        session.user.id,
        request.params.documentId,
        request.id,
      );
      return reply.send(documentSummarySchema.parse(result));
    },
  );

  app.delete<{ Params: { documentId: string } }>(
    '/documents/:documentId/permanent',
    permanentDeleteRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      permanentDeleteRequestSchema.parse(request.body);
      await options.workspaceService.permanentlyDeleteDocument(
        session.user.id,
        request.params.documentId,
        request.id,
      );
      return reply.status(204).send();
    },
  );
}

function requireMutationSession(
  request: Parameters<typeof requireSession>[0],
  options: WorkspaceRouteOptions,
) {
  return requireMutationAuth(request, options.authService, options.webOrigin);
}

function mutationRateLimit() {
  return { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
}

function permanentDeleteRateLimit() {
  return { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
}

function saveRateLimit() {
  return {
    bodyLimit: 2 * 1024 * 1024 + 2048,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  };
}
