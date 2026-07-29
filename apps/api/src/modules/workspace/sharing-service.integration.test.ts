import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requireDocumentAccess } from './document-access-policy.js';
import { SharingService } from './sharing-service.js';
import { WorkspaceService } from './workspace-service.js';

dotenv.config({ path: '../../.env.local' });

const prisma = new PrismaClient({ log: ['error'] });
const sharingService = new SharingService(prisma);
const workspaceService = new WorkspaceService(prisma);
const testSuffix = crypto.randomUUID();
const ownerEmail = `sharing-owner-${testSuffix}@example.test`;
const collaboratorEmail = `sharing-collaborator-${testSuffix}@example.test`;
const grantRequestId = `sharing-grant-${testSuffix}`;
const roleChangeRequestId = `sharing-role-change-${testSuffix}`;
const revokeRequestId = `sharing-revoke-${testSuffix}`;
let ownerId: string;
let collaboratorId: string;
let documentId: string;

beforeAll(async () => {
  await prisma.$connect();
  const [owner, collaborator] = await Promise.all([
    prisma.user.create({
      data: {
        email: ownerEmail,
        normalizedEmail: ownerEmail,
        passwordHash: 'integration-test-only',
      },
    }),
    prisma.user.create({
      data: {
        email: collaboratorEmail,
        normalizedEmail: collaboratorEmail,
        passwordHash: 'integration-test-only',
      },
    }),
  ]);
  ownerId = owner.id;
  collaboratorId = collaborator.id;
  const folder = await workspaceService.createFolder(
    ownerId,
    { name: 'Private owner folder', parentId: null },
    'sharing-create-folder',
  );
  const document = await workspaceService.createDocument(
    ownerId,
    { name: 'Shared plan.md', folderId: folder.id },
    'sharing-create-document',
  );
  documentId = document.id;
});

afterAll(async () => {
  if (ownerId) {
    await prisma.document.deleteMany({ where: { ownerId } });
    await prisma.folder.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, collaboratorId] } },
    });
  }
  await prisma.$disconnect();
});

describe('SharingService with MySQL', () => {
  it('grants, changes, and revokes access with owner-only authorization', async () => {
    const granted = await sharingService.grantAccess(
      ownerId,
      documentId,
      collaboratorEmail.toUpperCase(),
      'editor',
      grantRequestId,
    );
    expect(granted).toMatchObject({
      userId: collaboratorId,
      email: collaboratorEmail,
      role: 'editor',
    });

    const shared = await sharingService.listSharedDocuments(collaboratorId);
    expect(shared.documents).toEqual([
      expect.objectContaining({
        id: documentId,
        folderId: null,
        name: 'Shared plan.md',
        permission: 'editor',
      }),
    ]);
    await expect(
      requireDocumentAccess(prisma, collaboratorId, documentId, 'write'),
    ).resolves.toMatchObject({ permission: 'editor' });

    await expect(
      sharingService.listCollaborators(collaboratorId, documentId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });

    const changed = await sharingService.updateRole(
      ownerId,
      documentId,
      collaboratorId,
      'viewer',
      roleChangeRequestId,
    );
    expect(changed.role).toBe('viewer');
    await expect(
      requireDocumentAccess(prisma, collaboratorId, documentId, 'write'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    const collaborators = await sharingService.listCollaborators(
      ownerId,
      documentId,
    );
    expect(collaborators.collaborators).toEqual([
      expect.objectContaining({
        userId: collaboratorId,
        role: 'viewer',
      }),
    ]);

    await sharingService.revokeAccess(
      ownerId,
      documentId,
      collaboratorId,
      revokeRequestId,
    );
    await expect(
      requireDocumentAccess(prisma, collaboratorId, documentId, 'read'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      sharingService.listSharedDocuments(collaboratorId),
    ).resolves.toEqual({ documents: [] });

    const audits = await prisma.auditEvent.findMany({
      where: {
        requestId: {
          in: [grantRequestId, roleChangeRequestId, revokeRequestId],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map(({ action }) => action)).toEqual([
      'DOCUMENT_ACCESS_GRANT',
      'DOCUMENT_ACCESS_ROLE_CHANGE',
      'DOCUMENT_ACCESS_REVOKE',
    ]);
  });

  it('rejects unknown accounts and attempts to share with the owner', async () => {
    await expect(
      sharingService.grantAccess(
        ownerId,
        documentId,
        'missing-account@example.test',
        'editor',
        'sharing-missing-user',
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(
      sharingService.grantAccess(
        ownerId,
        documentId,
        ownerEmail,
        'viewer',
        'sharing-owner-target',
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('creates and revokes an owner-managed read-only public link', async () => {
    const initial = await workspaceService.getDocument(ownerId, documentId);
    await workspaceService.saveDocument(
      ownerId,
      documentId,
      {
        baseRevisionId: initial.currentRevision.id,
        content: '# Public plan\n',
      },
      `sharing-public-save-${testSuffix}`,
    );

    const created = await sharingService.createPublicLink(
      ownerId,
      documentId,
      `sharing-public-create-${testSuffix}`,
    );
    expect(created.token).toHaveLength(43);
    expect(
      await sharingService.getPublicLinkStatus(ownerId, documentId),
    ).toEqual({ enabled: true, createdAt: created.createdAt });
    await expect(
      sharingService.getPublicLinkStatus(collaboratorId, documentId),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    const stored = await prisma.documentPublicLink.findUniqueOrThrow({
      where: { documentId },
    });
    expect(stored.tokenHash).not.toBe(created.token);
    await expect(
      sharingService.resolvePublicDocument(created.token),
    ).resolves.toMatchObject({
      name: 'Shared plan.md',
      content: '# Public plan\n',
      currentRevision: { ordinal: 2 },
    });

    await sharingService.revokePublicLink(
      ownerId,
      documentId,
      `sharing-public-revoke-${testSuffix}`,
    );
    await expect(
      sharingService.resolvePublicDocument(created.token),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 });
  });
});
