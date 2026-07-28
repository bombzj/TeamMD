import {
  collaborationTicketResponseSchema,
  documentContentResponseSchema,
  documentSummarySchema,
  errorResponseSchema,
  folderSchema,
  saveDocumentResponseSchema,
  workspaceTreeResponseSchema,
  type DocumentSummaryDto,
  type FolderDto,
} from '@mymd/contracts';
import type { ServerConfig } from '@mymd/config';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app.js';
import { hashToken } from '../../lib/tokens.js';
import type { AuthService } from '../auth/auth-service.js';
import type { AuthenticatedSession } from '../auth/auth-types.js';
import type { CollaborationCheckpointService } from '../collaboration/collaboration-checkpoint-service.js';
import type { CollaborationService } from '../collaboration/collaboration-service.js';
import type { WorkspaceService } from './workspace-service.js';

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
const userId = 'cm1234567890abcdefghijklm';
const folder: FolderDto = {
  id: 'cm1234567890folderabcdefg',
  parentId: null,
  name: 'Notes',
  createdAt: '2026-07-27T12:00:00.000Z',
  updatedAt: '2026-07-27T12:00:00.000Z',
};
const document: DocumentSummaryDto = {
  id: 'cm1234567890documentabcde',
  folderId: folder.id,
  name: 'Readme.md',
  currentRevision: {
    id: 'cm1234567890revisionabcde',
    ordinal: 1,
    createdAt: '2026-07-27T12:00:00.000Z',
  },
  createdAt: '2026-07-27T12:00:00.000Z',
  updatedAt: '2026-07-27T12:00:00.000Z',
};
const documentContent = {
  ...document,
  permission: 'owner' as const,
  content: '# MyMD\n',
};
const saveResponse = {
  documentId: document.id,
  currentRevision: {
    id: 'cm1234567890revisionnextab',
    ordinal: 2,
    createdAt: '2026-07-27T12:05:00.000Z',
  },
};

class FakeAuthService {
  public authenticate(
    token: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    return Promise.resolve(
      token === 'session-token'
        ? {
            id: 'cm1234567890sessionidxyz',
            user: {
              id: userId,
              email: 'person@example.com',
              emailVerifiedAt: null,
              createdAt: '2026-07-27T12:00:00.000Z',
            },
            csrfTokenHash: hashToken('a'.repeat(43)),
          }
        : null,
    );
  }

  public csrfMatches(session: AuthenticatedSession, token: string): boolean {
    return hashToken(token) === session.csrfTokenHash;
  }
}

class FakeWorkspaceService {
  public listTree = vi.fn().mockResolvedValue({
    folders: [folder],
    documents: [document],
  });
  public listTrash = vi.fn().mockResolvedValue({ items: [] });
  public createFolder = vi.fn().mockResolvedValue(folder);
  public updateFolder = vi.fn().mockResolvedValue(folder);
  public trashFolder = vi.fn().mockResolvedValue(undefined);
  public restoreFolder = vi.fn().mockResolvedValue(folder);
  public permanentlyDeleteFolder = vi.fn().mockResolvedValue(undefined);
  public createDocument = vi.fn().mockResolvedValue(document);
  public getDocument = vi.fn().mockResolvedValue(documentContent);
  public saveDocument = vi.fn().mockResolvedValue(saveResponse);
  public updateDocument = vi.fn().mockResolvedValue(document);
  public trashDocument = vi.fn().mockResolvedValue(undefined);
  public restoreDocument = vi.fn().mockResolvedValue(document);
  public permanentlyDeleteDocument = vi.fn().mockResolvedValue(undefined);
}

class FakeCollaborationService {
  public createTicket = vi.fn().mockResolvedValue({
    ticket: 'a'.repeat(43),
    documentId: document.id,
    permission: 'owner',
    websocketUrl: config.collaborationUrl,
    expiresAt: '2026-07-27T12:01:00.000Z',
  });
}

class FakeCollaborationCheckpointService {
  public checkpoint = vi.fn().mockResolvedValue({
    ...saveResponse,
    contentHash:
      '5a20c83155116d212e04cd1301b39da22c04944de6c80fb6f17c1db0a9b037fc',
  });
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('workspace routes', () => {
  it('requires a session before listing the private workspace', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/tree',
    });

    expect(response.statusCode).toBe(401);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(
      'AUTHENTICATION_REQUIRED',
    );
  });

  it('returns a validated owned workspace tree', async () => {
    const service = new FakeWorkspaceService();
    const app = await createTestApp(service);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/tree',
      headers: authHeaders(false),
    });

    expect(response.statusCode).toBe(200);
    expect(workspaceTreeResponseSchema.parse(response.json())).toEqual({
      folders: [folder],
      documents: [document],
    });
    expect(service.listTree).toHaveBeenCalledWith(userId);
  });

  it('rejects invalid folder input before calling the service', async () => {
    const service = new FakeWorkspaceService();
    const app = await createTestApp(service);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/folders',
      headers: authHeaders(),
      payload: { name: '../private', parentId: null },
    });

    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(service.createFolder).not.toHaveBeenCalled();
  });

  it('creates folders and documents through authenticated CSRF mutations', async () => {
    const service = new FakeWorkspaceService();
    const app = await createTestApp(service);
    const folderResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/folders',
      headers: authHeaders(),
      payload: { name: 'Notes', parentId: null },
    });
    const documentResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: authHeaders(),
      payload: { name: 'Readme.md', folderId: folder.id },
    });

    expect(folderResponse.statusCode).toBe(201);
    expect(folderSchema.parse(folderResponse.json())).toEqual(folder);
    expect(documentResponse.statusCode).toBe(201);
    expect(documentSummarySchema.parse(documentResponse.json())).toEqual(
      document,
    );
    expect(service.createFolder).toHaveBeenCalledWith(
      userId,
      { name: 'Notes', parentId: null },
      expect.any(String),
    );
    expect(service.createDocument).toHaveBeenCalledWith(
      userId,
      { name: 'Readme.md', folderId: folder.id },
      expect.any(String),
    );
  });

  it('requires matching CSRF and explicit confirmation for permanent delete', async () => {
    const service = new FakeWorkspaceService();
    const app = await createTestApp(service);
    const csrfRejected = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}/permanent`,
      headers: { ...authHeaders(), 'x-csrf-token': 'wrong' },
      payload: { confirmation: 'DELETE' },
    });
    const confirmationRejected = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}/permanent`,
      headers: authHeaders(),
      payload: { confirmation: 'yes' },
    });
    const accepted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${document.id}/permanent`,
      headers: authHeaders(),
      payload: { confirmation: 'DELETE' },
    });

    expect(csrfRejected.statusCode).toBe(403);
    expect(confirmationRejected.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(204);
    expect(service.permanentlyDeleteDocument).toHaveBeenCalledOnce();
  });

  it('reads current Markdown and saves from an explicit base revision', async () => {
    const service = new FakeWorkspaceService();
    const app = await createTestApp(service);
    const readResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}`,
      headers: authHeaders(false),
    });
    const saveBody = {
      baseRevisionId: document.currentRevision.id,
      content: '# MyMD\n\nSaved with Vditor.\n',
    };
    const saveResponseResult = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${document.id}/content`,
      headers: authHeaders(),
      payload: saveBody,
    });

    expect(readResponse.statusCode).toBe(200);
    expect(documentContentResponseSchema.parse(readResponse.json())).toEqual(
      documentContent,
    );
    expect(saveResponseResult.statusCode).toBe(200);
    expect(saveDocumentResponseSchema.parse(saveResponseResult.json())).toEqual(
      saveResponse,
    );
    expect(service.getDocument).toHaveBeenCalledWith(userId, document.id);
    expect(service.saveDocument).toHaveBeenCalledWith(
      userId,
      document.id,
      saveBody,
      expect.any(String),
    );
  });

  it('rejects document saves without matching CSRF', async () => {
    const service = new FakeWorkspaceService();
    const app = await createTestApp(service);
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${document.id}/content`,
      headers: authHeaders(false),
      payload: {
        baseRevisionId: document.currentRevision.id,
        content: '# Rejected\n',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(
      'CSRF_INVALID',
    );
    expect(service.saveDocument).not.toHaveBeenCalled();
  });

  it('issues a scoped collaboration ticket with mutation authentication', async () => {
    const collaborationService = new FakeCollaborationService();
    const app = await createTestApp(
      new FakeWorkspaceService(),
      collaborationService,
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/collaboration-ticket`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(collaborationTicketResponseSchema.parse(response.json())).toEqual(
      await collaborationService.createTicket.mock.results[0]?.value,
    );
    expect(collaborationService.createTicket).toHaveBeenCalledWith(
      userId,
      'cm1234567890sessionidxyz',
      document.id,
      config.collaborationUrl,
    );
  });

  it('checkpoints the authoritative collaboration room without client content', async () => {
    const checkpointService = new FakeCollaborationCheckpointService();
    const app = await createTestApp(
      new FakeWorkspaceService(),
      new FakeCollaborationService(),
      checkpointService,
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${document.id}/collaboration-checkpoint`,
      headers: authHeaders(),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      await checkpointService.checkpoint.mock.results[0]?.value,
    );
    expect(checkpointService.checkpoint).toHaveBeenCalledWith(
      userId,
      document.id,
      {},
      expect.any(String),
    );
  });
});

async function createTestApp(
  service = new FakeWorkspaceService(),
  collaborationService = new FakeCollaborationService(),
  collaborationCheckpointService = new FakeCollaborationCheckpointService(),
) {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
  } as unknown as PrismaClient;
  const app = await buildApp({
    config,
    prisma,
    authService: new FakeAuthService() as unknown as AuthService,
    collaborationCheckpointService:
      collaborationCheckpointService as unknown as CollaborationCheckpointService,
    collaborationService:
      collaborationService as unknown as CollaborationService,
    workspaceService: service as unknown as WorkspaceService,
  });
  apps.push(app);
  return app;
}

function authHeaders(withCsrf = true) {
  return {
    origin: config.webOrigin,
    cookie: `mymd_session=session-token; mymd_csrf=${'a'.repeat(43)}`,
    ...(withCsrf ? { 'x-csrf-token': 'a'.repeat(43) } : {}),
  };
}
