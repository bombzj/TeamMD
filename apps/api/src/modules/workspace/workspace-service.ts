import type {
  CreateDocumentRequest,
  CreateFolderRequest,
  DocumentContentResponse,
  DocumentSummaryDto,
  FolderDto,
  SaveDocumentRequest,
  SaveDocumentResponse,
  TrashResponse,
  UpdateDocumentRequest,
  UpdateFolderRequest,
  WorkspaceTreeResponse,
} from '@mymd/contracts';
import {
  Prisma,
  type Document,
  type DocumentRevision,
  type Folder,
  type PrismaClient,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import { ApiError } from '../../lib/api-error.js';

const rootParentKey = '__root__';
const maximumFolderDepth = 20;
const maximumMarkdownBytes = 2 * 1024 * 1024;
const emptyContentHash = createHash('sha256').update('').digest('hex');

type FolderState = Pick<Folder, 'id' | 'parentId' | 'trashedAt'>;
type DocumentWithRevision = Document & {
  currentRevision: DocumentRevision;
};

export class WorkspaceService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listTree(userId: string): Promise<WorkspaceTreeResponse> {
    const [folders, documents] = await this.prisma.$transaction([
      this.prisma.folder.findMany({
        where: { ownerId: userId },
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.document.findMany({
        where: { ownerId: userId, trashedAt: null },
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const visibleFolders = folders.filter((folder) =>
      isFolderVisible(folder.id, folderById),
    );
    const visibleFolderIds = new Set(visibleFolders.map((folder) => folder.id));
    const visibleDocuments = documents.filter(
      (document) =>
        document.folderId === null || visibleFolderIds.has(document.folderId),
    );
    const revisions = await this.findCurrentRevisions(visibleDocuments);

    return {
      folders: visibleFolders.map(toFolderDto),
      documents: visibleDocuments.map((document) =>
        toDocumentDto(withCurrentRevision(document, revisions)),
      ),
    };
  }

  public async listTrash(userId: string): Promise<TrashResponse> {
    const [folders, documents] = await this.prisma.$transaction([
      this.prisma.folder.findMany({
        where: { ownerId: userId, trashedAt: { not: null } },
        orderBy: { trashedAt: 'desc' },
      }),
      this.prisma.document.findMany({
        where: { ownerId: userId, trashedAt: { not: null } },
        orderBy: { trashedAt: 'desc' },
      }),
    ]);
    const revisions = await this.findCurrentRevisions(documents);

    return {
      items: [
        ...folders.map((folder) => ({
          ...toFolderDto(folder),
          type: 'folder' as const,
          trashedAt: folder.trashedAt!.toISOString(),
        })),
        ...documents.map((document) => ({
          ...toDocumentDto(withCurrentRevision(document, revisions)),
          type: 'document' as const,
          trashedAt: document.trashedAt!.toISOString(),
        })),
      ].sort((left, right) => right.trashedAt.localeCompare(left.trashedAt)),
    };
  }

  public async createFolder(
    userId: string,
    input: CreateFolderRequest,
    requestId: string,
  ): Promise<FolderDto> {
    const name = prepareName(input.name);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const folders = await loadFolderStates(transaction, userId);
        assertActiveDestination(folders, input.parentId);
        if (folderDepth(input.parentId, folders) + 1 > maximumFolderDepth) {
          throw depthError();
        }
        const folder = await transaction.folder.create({
          data: {
            ownerId: userId,
            parentId: input.parentId,
            name: name.display,
            normalizedName: name.normalized,
            parentKey: parentKey(input.parentId),
            activeNameKey: name.normalized,
          },
        });
        await createAuditEvent(
          transaction,
          userId,
          'FOLDER_CREATE',
          requestId,
          { folderId: folder.id },
        );
        return toFolderDto(folder);
      });
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  public async updateFolder(
    userId: string,
    folderId: string,
    input: UpdateFolderRequest,
    requestId: string,
  ): Promise<FolderDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const folders = await loadFolderStates(transaction, userId);
        const folder = await transaction.folder.findFirst({
          where: { id: folderId, ownerId: userId },
        });
        if (folder === null || !isFolderVisible(folder.id, folders)) {
          throw notFound('Folder');
        }
        const nextParentId =
          input.parentId === undefined ? folder.parentId : input.parentId;
        if (nextParentId === folder.id) throw cycleError();
        assertActiveDestination(folders, nextParentId);
        if (hasAncestor(nextParentId, folder.id, folders)) throw cycleError();

        const nextDepth = folderDepth(nextParentId, folders);
        const subtreeHeight = getSubtreeHeight(folder.id, folders);
        if (nextDepth + subtreeHeight > maximumFolderDepth) {
          throw depthError();
        }
        const name = prepareName(input.name ?? folder.name);
        const updated = await transaction.folder.update({
          where: { id: folder.id },
          data: {
            parentId: nextParentId,
            parentKey: parentKey(nextParentId),
            name: name.display,
            normalizedName: name.normalized,
            activeNameKey: name.normalized,
          },
        });
        await createAuditEvent(
          transaction,
          userId,
          'FOLDER_UPDATE',
          requestId,
          { folderId },
        );
        return toFolderDto(updated);
      });
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  public async trashFolder(
    userId: string,
    folderId: string,
    requestId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const folders = await loadFolderStates(transaction, userId);
      if (!isFolderVisible(folderId, folders)) throw notFound('Folder');
      await transaction.folder.update({
        where: { id: folderId },
        data: { trashedAt: new Date(), activeNameKey: null },
      });
      await createAuditEvent(transaction, userId, 'FOLDER_TRASH', requestId, {
        folderId,
      });
    });
  }

  public async restoreFolder(
    userId: string,
    folderId: string,
    requestId: string,
  ): Promise<FolderDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const folders = await loadFolderStates(transaction, userId);
        const folder = await transaction.folder.findFirst({
          where: { id: folderId, ownerId: userId, trashedAt: { not: null } },
        });
        if (folder === null) throw notFound('Folder');
        assertActiveDestination(folders, folder.parentId);
        const restored = await transaction.folder.update({
          where: { id: folder.id },
          data: { trashedAt: null, activeNameKey: folder.normalizedName },
        });
        await createAuditEvent(
          transaction,
          userId,
          'FOLDER_RESTORE',
          requestId,
          { folderId },
        );
        return toFolderDto(restored);
      });
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  public async permanentlyDeleteFolder(
    userId: string,
    folderId: string,
    requestId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const folder = await transaction.folder.findFirst({
        where: { id: folderId, ownerId: userId, trashedAt: { not: null } },
      });
      if (folder === null) throw notFound('Folder');
      const folders = await loadFolderStates(transaction, userId);
      const subtreeIds = getSubtreeIds(folder.id, folders);
      await transaction.document.deleteMany({
        where: { ownerId: userId, folderId: { in: subtreeIds } },
      });
      const depthById = new Map(
        subtreeIds.map((id) => [id, folderDepth(id, folders)]),
      );
      for (const id of subtreeIds.sort(
        (left, right) => depthById.get(right)! - depthById.get(left)!,
      )) {
        await transaction.folder.delete({ where: { id } });
      }
      await createAuditEvent(
        transaction,
        userId,
        'FOLDER_DELETE_PERMANENT',
        requestId,
        { folderId },
      );
    });
  }

  public async createDocument(
    userId: string,
    input: CreateDocumentRequest,
    requestId: string,
  ): Promise<DocumentSummaryDto> {
    const name = prepareName(input.name);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const folders = await loadFolderStates(transaction, userId);
        assertActiveDestination(folders, input.folderId);
        const document = await transaction.document.create({
          data: {
            ownerId: userId,
            folderId: input.folderId,
            name: name.display,
            normalizedName: name.normalized,
            parentKey: parentKey(input.folderId),
            activeNameKey: name.normalized,
          },
        });
        const revision = await transaction.documentRevision.create({
          data: {
            documentId: document.id,
            ordinal: 1,
            authorId: userId,
            content: '',
            byteSize: 0,
            contentHash: emptyContentHash,
          },
        });
        const updated = await transaction.document.update({
          where: { id: document.id },
          data: { currentRevisionId: revision.id },
        });
        await createAuditEvent(
          transaction,
          userId,
          'DOCUMENT_CREATE',
          requestId,
          { documentId: document.id, revisionId: revision.id },
        );
        return toDocumentDto({ ...updated, currentRevision: revision });
      });
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  public async updateDocument(
    userId: string,
    documentId: string,
    input: UpdateDocumentRequest,
    requestId: string,
  ): Promise<DocumentSummaryDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const document = await transaction.document.findFirst({
          where: { id: documentId, ownerId: userId, trashedAt: null },
        });
        if (document === null) throw notFound('Document');
        const folders = await loadFolderStates(transaction, userId);
        if (
          document.folderId !== null &&
          !isFolderVisible(document.folderId, folders)
        ) {
          throw notFound('Document');
        }
        const nextFolderId =
          input.folderId === undefined ? document.folderId : input.folderId;
        assertActiveDestination(folders, nextFolderId);
        const name = prepareName(input.name ?? document.name);
        const revision = await requireCurrentRevision(
          transaction,
          document.currentRevisionId,
        );
        const updated = await transaction.document.update({
          where: { id: document.id },
          data: {
            folderId: nextFolderId,
            parentKey: parentKey(nextFolderId),
            name: name.display,
            normalizedName: name.normalized,
            activeNameKey: name.normalized,
          },
        });
        await createAuditEvent(
          transaction,
          userId,
          'DOCUMENT_UPDATE',
          requestId,
          { documentId },
        );
        return toDocumentDto({ ...updated, currentRevision: revision });
      });
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  public async getDocument(
    userId: string,
    documentId: string,
  ): Promise<DocumentContentResponse> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: userId, trashedAt: null },
    });
    if (document === null) throw notFound('Document');
    const folders = await this.prisma.folder.findMany({
      where: { ownerId: userId },
      select: { id: true, parentId: true, trashedAt: true },
    });
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    if (
      document.folderId !== null &&
      !isFolderVisible(document.folderId, folderById)
    ) {
      throw notFound('Document');
    }
    const revision = await requireCurrentRevision(
      this.prisma,
      document.currentRevisionId,
    );

    return {
      ...toDocumentDto({ ...document, currentRevision: revision }),
      permission: 'owner',
      content: revision.content,
    };
  }

  public async saveDocument(
    userId: string,
    documentId: string,
    input: SaveDocumentRequest,
    requestId: string,
  ): Promise<SaveDocumentResponse> {
    const byteSize = Buffer.byteLength(input.content, 'utf8');
    if (byteSize > maximumMarkdownBytes) {
      throw new ApiError(
        413,
        'VALIDATION_ERROR',
        'Markdown content must not exceed 2 MiB.',
      );
    }
    const contentHash = createHash('sha256')
      .update(input.content)
      .digest('hex');

    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM Document
        WHERE id = ${documentId} AND ownerId = ${userId}
        FOR UPDATE
      `;
      if (locked.length === 0) throw notFound('Document');

      const document = await transaction.document.findFirst({
        where: { id: documentId, ownerId: userId, trashedAt: null },
      });
      if (document === null) throw notFound('Document');
      const folders = await loadFolderStates(transaction, userId);
      if (
        document.folderId !== null &&
        !isFolderVisible(document.folderId, folders)
      ) {
        throw notFound('Document');
      }
      const currentRevision = await requireCurrentRevision(
        transaction,
        document.currentRevisionId,
      );
      if (currentRevision.id !== input.baseRevisionId) {
        throw revisionConflict(input.baseRevisionId, currentRevision);
      }

      const revision = await transaction.documentRevision.create({
        data: {
          documentId,
          ordinal: currentRevision.ordinal + 1,
          authorId: userId,
          content: input.content,
          byteSize,
          contentHash,
          ...(input.saveMessage === undefined
            ? {}
            : { saveMessage: input.saveMessage }),
        },
      });
      await transaction.document.update({
        where: { id: documentId },
        data: { currentRevisionId: revision.id },
      });
      await createAuditEvent(transaction, userId, 'DOCUMENT_SAVE', requestId, {
        documentId,
        revisionId: revision.id,
        ordinal: revision.ordinal,
      });
      return {
        documentId,
        currentRevision: toRevisionSummary(revision),
      };
    });
  }

  public async trashDocument(
    userId: string,
    documentId: string,
    requestId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const document = await transaction.document.findFirst({
        where: { id: documentId, ownerId: userId, trashedAt: null },
      });
      if (document === null) throw notFound('Document');
      const folders = await loadFolderStates(transaction, userId);
      if (
        document.folderId !== null &&
        !isFolderVisible(document.folderId, folders)
      ) {
        throw notFound('Document');
      }
      await transaction.document.update({
        where: { id: document.id },
        data: { trashedAt: new Date(), activeNameKey: null },
      });
      await createAuditEvent(transaction, userId, 'DOCUMENT_TRASH', requestId, {
        documentId,
      });
    });
  }

  public async restoreDocument(
    userId: string,
    documentId: string,
    requestId: string,
  ): Promise<DocumentSummaryDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const document = await transaction.document.findFirst({
          where: { id: documentId, ownerId: userId, trashedAt: { not: null } },
        });
        if (document === null) throw notFound('Document');
        const folders = await loadFolderStates(transaction, userId);
        assertActiveDestination(folders, document.folderId);
        const revision = await requireCurrentRevision(
          transaction,
          document.currentRevisionId,
        );
        const restored = await transaction.document.update({
          where: { id: document.id },
          data: { trashedAt: null, activeNameKey: document.normalizedName },
        });
        await createAuditEvent(
          transaction,
          userId,
          'DOCUMENT_RESTORE',
          requestId,
          { documentId },
        );
        return toDocumentDto({ ...restored, currentRevision: revision });
      });
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  public async permanentlyDeleteDocument(
    userId: string,
    documentId: string,
    requestId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.document.deleteMany({
        where: { id: documentId, ownerId: userId, trashedAt: { not: null } },
      });
      if (result.count === 0) throw notFound('Document');
      await createAuditEvent(
        transaction,
        userId,
        'DOCUMENT_DELETE_PERMANENT',
        requestId,
        { documentId },
      );
    });
  }

  private async findCurrentRevisions(
    documents: Document[],
  ): Promise<Map<string, DocumentRevision>> {
    const revisionIds = documents.flatMap((document) =>
      document.currentRevisionId === null ? [] : [document.currentRevisionId],
    );
    const revisions = await this.prisma.documentRevision.findMany({
      where: { id: { in: revisionIds } },
    });
    return new Map(revisions.map((revision) => [revision.id, revision]));
  }
}

async function loadFolderStates(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<Map<string, FolderState>> {
  const folders = await transaction.folder.findMany({
    where: { ownerId: userId },
    select: { id: true, parentId: true, trashedAt: true },
  });
  return new Map(folders.map((folder) => [folder.id, folder]));
}

function assertActiveDestination(
  folders: Map<string, FolderState>,
  parentId: string | null,
): void {
  if (parentId !== null && !isFolderVisible(parentId, folders)) {
    throw notFound('Folder');
  }
}

function isFolderVisible(
  folderId: string,
  folders: Map<string, FolderState>,
): boolean {
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId !== null) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const folder: FolderState | undefined = folders.get(currentId);
    if (folder === undefined || folder.trashedAt !== null) return false;
    currentId = folder.parentId;
  }
  return true;
}

function hasAncestor(
  folderId: string | null,
  ancestorId: string,
  folders: Map<string, FolderState>,
): boolean {
  let currentId = folderId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (currentId === ancestorId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = folders.get(currentId)?.parentId ?? null;
  }
  return false;
}

function folderDepth(
  folderId: string | null,
  folders: Map<string, FolderState>,
): number {
  let depth = 0;
  let currentId = folderId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (visited.has(currentId)) throw cycleError();
    visited.add(currentId);
    const folder: FolderState | undefined = folders.get(currentId);
    if (folder === undefined) throw notFound('Folder');
    depth += 1;
    currentId = folder.parentId;
  }
  return depth;
}

function getSubtreeHeight(
  rootId: string,
  folders: Map<string, FolderState>,
): number {
  const childIds = new Map<string, string[]>();
  for (const folder of folders.values()) {
    if (folder.parentId !== null) {
      const siblings = childIds.get(folder.parentId) ?? [];
      siblings.push(folder.id);
      childIds.set(folder.parentId, siblings);
    }
  }
  const visit = (id: string, path: Set<string>): number => {
    if (path.has(id)) throw cycleError();
    const nextPath = new Set(path).add(id);
    return Math.max(
      1,
      ...(childIds.get(id) ?? []).map(
        (childId) => 1 + visit(childId, nextPath),
      ),
    );
  };
  return visit(rootId, new Set());
}

function getSubtreeIds(
  rootId: string,
  folders: Map<string, FolderState>,
): string[] {
  const ids = [rootId];
  for (let index = 0; index < ids.length; index += 1) {
    for (const folder of folders.values()) {
      if (folder.parentId === ids[index] && !ids.includes(folder.id)) {
        ids.push(folder.id);
      }
    }
  }
  return ids;
}

async function requireCurrentRevision(
  transaction: Pick<Prisma.TransactionClient, 'documentRevision'>,
  revisionId: string | null,
): Promise<DocumentRevision> {
  if (revisionId === null) throw integrityError();
  const revision = await transaction.documentRevision.findUnique({
    where: { id: revisionId },
  });
  if (revision === null) throw integrityError();
  return revision;
}

function withCurrentRevision(
  document: Document,
  revisions: Map<string, DocumentRevision>,
): DocumentWithRevision {
  if (document.currentRevisionId === null) throw integrityError();
  const currentRevision = revisions.get(document.currentRevisionId);
  if (currentRevision === undefined) throw integrityError();
  return { ...document, currentRevision };
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

function prepareName(value: string): { display: string; normalized: string } {
  const display = value.trim().normalize('NFC');
  const normalized = display.normalize('NFKC').toLocaleLowerCase('en-US');
  if (normalized.length > 255) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The name is too long.');
  }
  return { display, normalized };
}

function parentKey(parentId: string | null): string {
  return parentId ?? rootParentKey;
}

function toFolderDto(folder: Folder): FolderDto {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

function toDocumentDto(document: DocumentWithRevision): DocumentSummaryDto {
  return {
    id: document.id,
    folderId: document.folderId,
    name: document.name,
    currentRevision: toRevisionSummary(document.currentRevision),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toRevisionSummary(revision: DocumentRevision) {
  return {
    id: revision.id,
    ordinal: revision.ordinal,
    createdAt: revision.createdAt.toISOString(),
  };
}

function mapNameConflict(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return new ApiError(
      409,
      'NAME_CONFLICT',
      'An item with that name already exists in this location.',
    );
  }
  return error;
}

function notFound(resource: 'Folder' | 'Document'): ApiError {
  return new ApiError(404, 'RESOURCE_NOT_FOUND', `${resource} not found.`);
}

function cycleError(): ApiError {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'A folder cannot be moved into its own subtree.',
  );
}

function depthError(): ApiError {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    `Folders may be nested at most ${maximumFolderDepth} levels deep.`,
  );
}

function revisionConflict(
  submittedBaseRevisionId: string,
  currentRevision: DocumentRevision,
): ApiError {
  return new ApiError(
    409,
    'REVISION_CONFLICT',
    'The document has a newer revision.',
    {
      submittedBaseRevisionId,
      currentRevision: toRevisionSummary(currentRevision),
    },
  );
}

function integrityError(): ApiError {
  return new ApiError(
    500,
    'INTERNAL_ERROR',
    'The document revision state is invalid.',
  );
}
