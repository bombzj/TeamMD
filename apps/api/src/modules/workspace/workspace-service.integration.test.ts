import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../../lib/api-error.js';
import { WorkspaceService } from './workspace-service.js';

dotenv.config({ path: '../../.env.local' });

const prisma = new PrismaClient({ log: ['error'] });
const workspaceService = new WorkspaceService(prisma);
const testEmail = `workspace-test-${crypto.randomUUID()}@example.test`;
let userId: string;

beforeAll(async () => {
  await prisma.$connect();
  const user = await prisma.user.create({
    data: {
      email: testEmail,
      normalizedEmail: testEmail,
      passwordHash: 'integration-test-only',
    },
  });
  userId = user.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.document.deleteMany({ where: { ownerId: userId } });
    for (let depth = 0; depth < 20; depth += 1) {
      const result = await prisma.folder.deleteMany({
        where: { ownerId: userId, children: { none: {} } },
      });
      if (result.count === 0) break;
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe('WorkspaceService with MySQL', () => {
  it('creates a document and immutable empty head in one transaction', async () => {
    const created = await workspaceService.createDocument(
      userId,
      { name: 'Readme.md', folderId: null },
      'workspace-create-document',
    );
    const stored = await prisma.document.findUniqueOrThrow({
      where: { id: created.id },
      include: { revisions: true },
    });

    expect(stored.currentRevisionId).toBe(created.currentRevision.id);
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]).toMatchObject({
      ordinal: 1,
      content: '',
      byteSize: 0,
      contentHash:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });

    await expect(
      workspaceService.createDocument(
        userId,
        { name: 'README.MD', folderId: null },
        'workspace-duplicate-document',
      ),
    ).rejects.toMatchObject({ code: 'NAME_CONFLICT', statusCode: 409 });
  });

  it('lists nested active items and rejects moving a folder below itself', async () => {
    const parent = await workspaceService.createFolder(
      userId,
      { name: 'Projects', parentId: null },
      'workspace-create-parent',
    );
    const child = await workspaceService.createFolder(
      userId,
      { name: 'MyMD', parentId: parent.id },
      'workspace-create-child',
    );
    await workspaceService.createDocument(
      userId,
      { name: 'Plan.md', folderId: child.id },
      'workspace-create-nested-document',
    );

    const tree = await workspaceService.listTree(userId);
    expect(tree.folders.map((folder) => folder.id)).toEqual(
      expect.arrayContaining([parent.id, child.id]),
    );
    expect(tree.documents.some((document) => document.name === 'Plan.md')).toBe(
      true,
    );

    const cycleMove = workspaceService.updateFolder(
      userId,
      parent.id,
      { parentId: child.id },
      'workspace-cycle',
    );
    await expect(cycleMove).rejects.toBeInstanceOf(ApiError);
    await expect(cycleMove).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  });

  it('creates immutable saves and rejects a stale base without advancing', async () => {
    const created = await workspaceService.createDocument(
      userId,
      { name: 'Editor.md', folderId: null },
      'workspace-editor-create',
    );
    const initial = await workspaceService.getDocument(userId, created.id);
    const saved = await workspaceService.saveDocument(
      userId,
      created.id,
      {
        baseRevisionId: initial.currentRevision.id,
        content: '# Vditor\n\nExplicit saves keep every draft.\n',
        saveMessage: 'Write introduction',
      },
      'workspace-editor-save',
    );

    expect(saved.currentRevision.ordinal).toBe(2);
    await expect(
      workspaceService.saveDocument(
        userId,
        created.id,
        {
          baseRevisionId: initial.currentRevision.id,
          content: 'stale content',
        },
        'workspace-editor-stale-save',
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      statusCode: 409,
      details: {
        submittedBaseRevisionId: initial.currentRevision.id,
        currentRevision: { id: saved.currentRevision.id, ordinal: 2 },
      },
    });

    const stored = await prisma.document.findUniqueOrThrow({
      where: { id: created.id },
      include: { revisions: { orderBy: { ordinal: 'asc' } } },
    });
    expect(stored.currentRevisionId).toBe(saved.currentRevision.id);
    expect(stored.revisions).toHaveLength(2);
    expect(stored.revisions[0]?.content).toBe('');
    expect(stored.revisions[1]).toMatchObject({
      ordinal: 2,
      content: '# Vditor\n\nExplicit saves keep every draft.\n',
      saveMessage: 'Write introduction',
    });
  });
});
