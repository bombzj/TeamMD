import type { DocumentContentResponse } from '@teammd/contracts';
import { Prisma, type Document, type Folder } from '@prisma/client';

import { ApiError } from '../../lib/api-error.js';

type DocumentPermission = DocumentContentResponse['permission'];
type DocumentAccessClient = Pick<
  Prisma.TransactionClient,
  'document' | 'folder'
>;
type FolderState = Pick<Folder, 'id' | 'parentId' | 'trashedAt'>;

export async function requireDocumentAccess(
  transaction: DocumentAccessClient,
  userId: string,
  documentId: string,
  operation: 'read' | 'write',
): Promise<{ document: Document; permission: DocumentPermission }> {
  const document = await transaction.document.findFirst({
    where: {
      id: documentId,
      trashedAt: null,
      OR: [
        { ownerId: userId },
        {
          accesses: {
            some: {
              userId,
              ...(operation === 'write' ? { role: 'EDITOR' } : {}),
            },
          },
        },
      ],
    },
    include: {
      accesses: {
        where: { userId },
        select: { role: true },
      },
    },
  });
  if (document === null) throw documentNotFound();

  const folders = await transaction.folder.findMany({
    where: { ownerId: document.ownerId },
    select: { id: true, parentId: true, trashedAt: true },
  });
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  if (
    document.folderId !== null &&
    !isFolderVisible(document.folderId, folderById)
  ) {
    throw documentNotFound();
  }

  if (document.ownerId === userId) {
    return { document, permission: 'owner' };
  }
  const role = document.accesses[0]?.role;
  if (role === 'EDITOR') return { document, permission: 'editor' };
  if (role === 'VIEWER' && operation === 'read') {
    return { document, permission: 'viewer' };
  }
  throw documentNotFound();
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
    const folder = folders.get(currentId);
    if (folder === undefined || folder.trashedAt !== null) return false;
    currentId = folder.parentId;
  }
  return true;
}

function documentNotFound(): ApiError {
  return new ApiError(404, 'RESOURCE_NOT_FOUND', 'Document not found.');
}
