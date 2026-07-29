import type {
  CollaboratorDto,
  CollaboratorRole,
  SharedDocumentSummary,
} from '@mymd/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';

import { ApiError } from '../../lib/api-error.js';
import { normalizeEmail } from '../auth/auth-service.js';
import { requireDocumentAccess } from './document-access-policy.js';

export class SharingService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listSharedDocuments(
    userId: string,
  ): Promise<{ documents: SharedDocumentSummary[] }> {
    const accesses = await this.prisma.documentAccess.findMany({
      where: { userId, document: { trashedAt: null } },
      include: { document: true },
      orderBy: { updatedAt: 'desc' },
      take: 1_000,
    });

    const visibleAccesses = [];
    for (const access of accesses) {
      try {
        await requireDocumentAccess(
          this.prisma,
          userId,
          access.documentId,
          'read',
        );
        visibleAccesses.push(access);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND') {
          continue;
        }
        throw error;
      }
    }

    const revisionIds = visibleAccesses.flatMap(({ document }) =>
      document.currentRevisionId === null ? [] : [document.currentRevisionId],
    );
    const revisions = await this.prisma.documentRevision.findMany({
      where: { id: { in: revisionIds } },
    });
    const revisionById = new Map(
      revisions.map((revision) => [revision.id, revision]),
    );

    return {
      documents: visibleAccesses.map(({ document, role }) => {
        const currentRevision =
          document.currentRevisionId === null
            ? undefined
            : revisionById.get(document.currentRevisionId);
        if (currentRevision === undefined) throw integrityError();
        return {
          id: document.id,
          folderId: null,
          name: document.name,
          permission: toContractRole(role),
          currentRevision: {
            id: currentRevision.id,
            ordinal: currentRevision.ordinal,
            createdAt: currentRevision.createdAt.toISOString(),
          },
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
        };
      }),
    };
  }

  public async listCollaborators(
    ownerId: string,
    documentId: string,
  ): Promise<{ collaborators: CollaboratorDto[] }> {
    await requireOwner(this.prisma, ownerId, documentId);
    const accesses = await this.prisma.documentAccess.findMany({
      where: { documentId },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { collaborators: accesses.map(toCollaboratorDto) };
  }

  public async grantAccess(
    ownerId: string,
    documentId: string,
    email: string,
    role: CollaboratorRole,
    requestId: string,
  ): Promise<CollaboratorDto> {
    return this.prisma.$transaction(async (transaction) => {
      await requireOwner(transaction, ownerId, documentId);
      const recipient = await transaction.user.findFirst({
        where: {
          normalizedEmail: normalizeEmail(email),
          disabledAt: null,
        },
      });
      if (recipient === null) {
        throw new ApiError(
          404,
          'RESOURCE_NOT_FOUND',
          'No active account uses that email address.',
        );
      }
      if (recipient.id === ownerId) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'The document owner already has full access.',
        );
      }

      const access = await transaction.documentAccess.upsert({
        where: { documentId_userId: { documentId, userId: recipient.id } },
        create: {
          documentId,
          userId: recipient.id,
          role: toDatabaseRole(role),
          grantedById: ownerId,
        },
        update: { role: toDatabaseRole(role), grantedById: ownerId },
      });
      await createAuditEvent(
        transaction,
        ownerId,
        'DOCUMENT_ACCESS_GRANT',
        requestId,
        { documentId, recipientId: recipient.id, role },
      );
      return toCollaboratorDto({ ...access, user: recipient });
    });
  }

  public async updateRole(
    ownerId: string,
    documentId: string,
    collaboratorId: string,
    role: CollaboratorRole,
    requestId: string,
  ): Promise<CollaboratorDto> {
    return this.prisma.$transaction(async (transaction) => {
      await requireOwner(transaction, ownerId, documentId);
      const existing = await transaction.documentAccess.findUnique({
        where: {
          documentId_userId: { documentId, userId: collaboratorId },
        },
        include: { user: true },
      });
      if (existing === null) throw collaboratorNotFound();
      const access = await transaction.documentAccess.update({
        where: {
          documentId_userId: { documentId, userId: collaboratorId },
        },
        data: { role: toDatabaseRole(role), grantedById: ownerId },
      });
      await createAuditEvent(
        transaction,
        ownerId,
        'DOCUMENT_ACCESS_ROLE_CHANGE',
        requestId,
        { documentId, recipientId: collaboratorId, role },
      );
      return toCollaboratorDto({ ...access, user: existing.user });
    });
  }

  public async revokeAccess(
    ownerId: string,
    documentId: string,
    collaboratorId: string,
    requestId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await requireOwner(transaction, ownerId, documentId);
      const result = await transaction.documentAccess.deleteMany({
        where: { documentId, userId: collaboratorId },
      });
      if (result.count === 0) throw collaboratorNotFound();
      await createAuditEvent(
        transaction,
        ownerId,
        'DOCUMENT_ACCESS_REVOKE',
        requestId,
        { documentId, recipientId: collaboratorId },
      );
    });
  }
}

async function requireOwner(
  transaction: Prisma.TransactionClient | PrismaClient,
  ownerId: string,
  documentId: string,
): Promise<void> {
  const access = await requireDocumentAccess(
    transaction,
    ownerId,
    documentId,
    'read',
  );
  if (access.permission !== 'owner') throw documentNotFound();
}

function toCollaboratorDto(access: {
  userId: string;
  role: 'EDITOR' | 'VIEWER';
  createdAt: Date;
  updatedAt: Date;
  user: { email: string };
}): CollaboratorDto {
  return {
    userId: access.userId,
    email: access.user.email,
    role: toContractRole(access.role),
    createdAt: access.createdAt.toISOString(),
    updatedAt: access.updatedAt.toISOString(),
  };
}

function toContractRole(role: 'EDITOR' | 'VIEWER'): CollaboratorRole {
  return role === 'EDITOR' ? 'editor' : 'viewer';
}

function toDatabaseRole(role: CollaboratorRole): 'EDITOR' | 'VIEWER' {
  return role === 'editor' ? 'EDITOR' : 'VIEWER';
}

async function createAuditEvent(
  transaction: Prisma.TransactionClient,
  actorId: string,
  action: string,
  requestId: string,
  metadata: Prisma.InputJsonObject,
): Promise<void> {
  await transaction.auditEvent.create({
    data: { actorId, action, result: 'SUCCESS', requestId, metadata },
  });
}

function documentNotFound(): ApiError {
  return new ApiError(404, 'RESOURCE_NOT_FOUND', 'Document not found.');
}

function collaboratorNotFound(): ApiError {
  return new ApiError(404, 'RESOURCE_NOT_FOUND', 'Collaborator not found.');
}

function integrityError(): ApiError {
  return new ApiError(
    500,
    'INTERNAL_ERROR',
    'The document revision state is invalid.',
  );
}
