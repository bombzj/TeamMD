import {
  collaborationTicketRequestSchema,
  collaborationCheckpointResponseSchema,
  collaborativeCheckpointRequestSchema,
  collaborationTicketResponseSchema,
  collaboratorListResponseSchema,
  collaboratorSchema,
  createDocumentRequestSchema,
  createFolderRequestSchema,
  documentContentResponseSchema,
  documentSummarySchema,
  folderSchema,
  permanentDeleteRequestSchema,
  publicDocumentRequestSchema,
  publicDocumentResponseSchema,
  publicLinkCreateResponseSchema,
  publicLinkStatusSchema,
  restoreRevisionRequestSchema,
  revisionContentResponseSchema,
  revisionListResponseSchema,
  saveDocumentRequestSchema,
  saveDocumentResponseSchema,
  shareDocumentRequestSchema,
  sharedDocumentListResponseSchema,
  trashResponseSchema,
  updateDocumentRequestSchema,
  updateFolderRequestSchema,
  updateCollaboratorRequestSchema,
  workspaceTreeResponseSchema,
} from '@teammd/contracts';
import type { FastifyInstance } from 'fastify';

import { ApiError } from '../../lib/api-error.js';
import { requireMutationAuth, requireSession } from '../auth/auth-guards.js';
import type { AuthService } from '../auth/auth-service.js';
import type { CollaborationCheckpointService } from '../collaboration/collaboration-checkpoint-service.js';
import type { CollaborationService } from '../collaboration/collaboration-service.js';
import type { SharingService } from './sharing-service.js';
import type { WorkspaceService } from './workspace-service.js';

type WorkspaceRouteOptions = {
  authService: AuthService;
  collaborationCheckpointService?: CollaborationCheckpointService;
  collaborationService: CollaborationService;
  collaborationWebsocketUrl: string;
  closeCollaborationConnections: (documentId: string) => void;
  sharingService: SharingService;
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

  app.get('/shared-with-me', async (request, reply) => {
    const session = requireSession(request);
    const result = await options.sharingService.listSharedDocuments(
      session.user.id,
    );
    return reply
      .header('Cache-Control', 'no-store')
      .send(sharedDocumentListResponseSchema.parse(result));
  });

  app.post(
    '/public/documents/resolve',
    publicReadRateLimit(),
    async (request, reply) => {
      const body = publicDocumentRequestSchema.parse(request.body);
      const result = await options.sharingService.resolvePublicDocument(
        body.token,
      );
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Referrer-Policy', 'no-referrer')
        .send(publicDocumentResponseSchema.parse(result));
    },
  );

  app.get<{ Params: { documentId: string } }>(
    '/documents/:documentId/collaborators',
    async (request, reply) => {
      const session = requireSession(request);
      const result = await options.sharingService.listCollaborators(
        session.user.id,
        request.params.documentId,
      );
      return reply
        .header('Cache-Control', 'no-store')
        .send(collaboratorListResponseSchema.parse(result));
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/collaborators',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const body = shareDocumentRequestSchema.parse(request.body);
      const result = await options.sharingService.grantAccess(
        session.user.id,
        request.params.documentId,
        body.email,
        body.role,
        request.id,
      );
      options.closeCollaborationConnections(request.params.documentId);
      return reply.status(201).send(collaboratorSchema.parse(result));
    },
  );

  app.patch<{
    Params: { documentId: string; collaboratorId: string };
  }>(
    '/documents/:documentId/collaborators/:collaboratorId',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const body = updateCollaboratorRequestSchema.parse(request.body);
      const result = await options.sharingService.updateRole(
        session.user.id,
        request.params.documentId,
        request.params.collaboratorId,
        body.role,
        request.id,
      );
      options.closeCollaborationConnections(request.params.documentId);
      return reply.send(collaboratorSchema.parse(result));
    },
  );

  app.delete<{
    Params: { documentId: string; collaboratorId: string };
  }>(
    '/documents/:documentId/collaborators/:collaboratorId',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      await options.sharingService.revokeAccess(
        session.user.id,
        request.params.documentId,
        request.params.collaboratorId,
        request.id,
      );
      options.closeCollaborationConnections(request.params.documentId);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { documentId: string } }>(
    '/documents/:documentId/public-link',
    async (request, reply) => {
      const session = requireSession(request);
      const result = await options.sharingService.getPublicLinkStatus(
        session.user.id,
        request.params.documentId,
      );
      return reply
        .header('Cache-Control', 'no-store')
        .send(publicLinkStatusSchema.parse(result));
    },
  );

  app.post<{ Params: { documentId: string } }>(
    '/documents/:documentId/public-link',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      const result = await options.sharingService.createPublicLink(
        session.user.id,
        request.params.documentId,
        request.id,
      );
      return reply
        .header('Cache-Control', 'no-store')
        .status(201)
        .send(publicLinkCreateResponseSchema.parse(result));
    },
  );

  app.delete<{ Params: { documentId: string } }>(
    '/documents/:documentId/public-link',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      await options.sharingService.revokePublicLink(
        session.user.id,
        request.params.documentId,
        request.id,
      );
      return reply.status(204).send();
    },
  );

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
      const body = collaborationTicketRequestSchema.parse(request.body);
      if (body.editorProtocol === 'milkdown-xml-v1') {
        if (options.collaborationCheckpointService === undefined) {
          throw new ApiError(
            503,
            'INTERNAL_ERROR',
            'Collaboration migration is temporarily unavailable.',
          );
        }
        await options.collaborationCheckpointService.migrateToMilkdown(
          session.user.id,
          request.params.documentId,
        );
      }
      const result = await options.collaborationService.createTicket(
        session.user.id,
        session.id,
        request.params.documentId,
        options.collaborationWebsocketUrl,
        body.editorProtocol,
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

  app.get<{ Params: { documentId: string } }>(
    '/documents/:documentId/revisions',
    async (request, reply) => {
      const session = requireSession(request);
      const result = await options.workspaceService.listRevisions(
        session.user.id,
        request.params.documentId,
      );
      return reply
        .header('Cache-Control', 'no-store')
        .send(revisionListResponseSchema.parse(result));
    },
  );

  app.get<{ Params: { documentId: string; revisionId: string } }>(
    '/documents/:documentId/revisions/:revisionId',
    async (request, reply) => {
      const session = requireSession(request);
      const result = await options.workspaceService.getRevision(
        session.user.id,
        request.params.documentId,
        request.params.revisionId,
      );
      return reply
        .header('Cache-Control', 'no-store')
        .send(revisionContentResponseSchema.parse(result));
    },
  );

  app.post<{ Params: { documentId: string; revisionId: string } }>(
    '/documents/:documentId/revisions/:revisionId/restore',
    mutationRateLimit(),
    async (request, reply) => {
      const session = requireMutationSession(request, options);
      if (options.collaborationCheckpointService === undefined) {
        throw new ApiError(
          503,
          'INTERNAL_ERROR',
          'Collaboration is temporarily unavailable.',
        );
      }
      const body = restoreRevisionRequestSchema.parse(request.body);
      const result =
        await options.collaborationCheckpointService.restoreRevision(
          session.user.id,
          request.params.documentId,
          request.params.revisionId,
          body,
          request.id,
        );
      return reply.send(collaborationCheckpointResponseSchema.parse(result));
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

function publicReadRateLimit() {
  return {
    bodyLimit: 1_024,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  };
}

function saveRateLimit() {
  return {
    bodyLimit: 2 * 1024 * 1024 + 2048,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  };
}
