import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../../lib/api-error.js';
import { WorkspaceService } from './workspace-service.js';

dotenv.config({ path: '../../.env.local' });

const prisma = new PrismaClient({ log: ['error'] });
const workspaceService = new WorkspaceService(prisma);
const testEmail = `workspace-test-${crypto.randomUUID()}@example.test`;
let userId: string;
let editorId: string;
let viewerId: string;

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
  const editor = await prisma.user.create({
    data: {
      email: `editor-${testEmail}`,
      normalizedEmail: `editor-${testEmail}`,
      passwordHash: 'integration-test-only',
    },
  });
  editorId = editor.id;
  const viewer = await prisma.user.create({
    data: {
      email: `viewer-${testEmail}`,
      normalizedEmail: `viewer-${testEmail}`,
      passwordHash: 'integration-test-only',
    },
  });
  viewerId = viewer.id;
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
    await prisma.user.deleteMany({
      where: { id: { in: [userId, editorId, viewerId] } },
    });
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
      { name: 'TeamMD', parentId: parent.id },
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

  it('restores historical content as a new immutable revision', async () => {
    const created = await workspaceService.createDocument(
      userId,
      { name: 'Recovery.md', folderId: null },
      'workspace-recovery-create',
    );
    const second = await workspaceService.saveDocument(
      userId,
      created.id,
      {
        baseRevisionId: created.currentRevision.id,
        content: '# Second revision\n',
      },
      'workspace-recovery-second',
    );
    const third = await workspaceService.saveDocument(
      userId,
      created.id,
      {
        baseRevisionId: second.currentRevision.id,
        content: '# Third revision\n',
      },
      'workspace-recovery-third',
    );

    const restored = await workspaceService.restoreRevision(
      userId,
      created.id,
      created.currentRevision.id,
      {
        baseRevisionId: third.currentRevision.id,
        saveMessage: 'Recover the original draft',
      },
      'workspace-recovery-restore',
    );

    expect(restored.currentRevision.ordinal).toBe(4);
    await expect(
      workspaceService.restoreRevision(
        userId,
        created.id,
        second.currentRevision.id,
        { baseRevisionId: third.currentRevision.id },
        'workspace-recovery-stale',
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      statusCode: 409,
    });

    const stored = await prisma.document.findUniqueOrThrow({
      where: { id: created.id },
      include: { revisions: { orderBy: { ordinal: 'asc' } } },
    });
    expect(stored.currentRevisionId).toBe(restored.currentRevision.id);
    expect(stored.revisions).toHaveLength(4);
    expect(stored.revisions[0]).toMatchObject({ ordinal: 1, content: '' });
    expect(stored.revisions[2]).toMatchObject({
      ordinal: 3,
      content: '# Third revision\n',
    });
    expect(stored.revisions[3]).toMatchObject({
      ordinal: 4,
      content: '',
      restoredFromRevisionId: created.currentRevision.id,
      saveMessage: 'Recover the original draft',
    });
  });

  it('checkpoints and restores frozen blackboard Markdown with its revision', async () => {
    const created = await workspaceService.createDocument(
      userId,
      { name: 'Classroom.md', folderId: null },
      'workspace-blackboard-create',
    );
    await prisma.collaborationState.create({
      data: {
        documentId: created.id,
        checkpointRevisionId: created.currentRevision.id,
        stateFormat: 'MILKDOWN_BLACKBOARDS_V1',
        yjsState: Buffer.from([]),
      },
    });
    const backgroundMarkdown = '# Lesson one\n';
    const blackboard = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Examples',
      order: 0,
      backgroundMarkdown,
      backgroundHash: createHash('sha256')
        .update(backgroundMarkdown)
        .digest('hex'),
      strokes: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          tool: 'pen' as const,
          color: '#112233',
          width: 4,
          points: [{ x: 10, y: 20, pressure: 0.5 }],
        },
      ],
    };
    const saved = await workspaceService.saveDocument(
      userId,
      created.id,
      {
        baseRevisionId: created.currentRevision.id,
        content: backgroundMarkdown,
      },
      'workspace-blackboard-save',
      true,
      [blackboard],
    );

    const historical = await workspaceService.getRevision(
      userId,
      created.id,
      saved.currentRevision.id,
    );
    expect(historical.blackboards).toEqual([blackboard]);

    const restored = await workspaceService.restoreRevision(
      userId,
      created.id,
      saved.currentRevision.id,
      { baseRevisionId: saved.currentRevision.id },
      'workspace-blackboard-restore',
    );
    const restoredRevision = await workspaceService.getRevision(
      userId,
      created.id,
      restored.currentRevision.id,
    );
    expect(restoredRevision.blackboards).toEqual([blackboard]);
  });

  it('allows editors to save, viewers to read, and hides owner hierarchy', async () => {
    const folder = await workspaceService.createFolder(
      userId,
      { name: 'Private owner folder', parentId: null },
      'workspace-access-folder',
    );
    const created = await workspaceService.createDocument(
      userId,
      { name: 'Shared.md', folderId: folder.id },
      'workspace-access-document',
    );
    await prisma.$executeRaw`
      INSERT INTO DocumentAccess
        (documentId, userId, role, grantedById, createdAt, updatedAt)
      VALUES
        (${created.id}, ${editorId}, 'EDITOR', ${userId}, NOW(3), NOW(3)),
        (${created.id}, ${viewerId}, 'VIEWER', ${userId}, NOW(3), NOW(3))
    `;

    const editorDocument = await workspaceService.getDocument(
      editorId,
      created.id,
    );
    expect(editorDocument).toMatchObject({
      id: created.id,
      folderId: null,
      permission: 'editor',
    });
    const editorSave = await workspaceService.saveDocument(
      editorId,
      created.id,
      {
        baseRevisionId: editorDocument.currentRevision.id,
        content: '# Edited together\n',
      },
      'workspace-access-editor-save',
    );
    expect(editorSave.currentRevision.ordinal).toBe(2);

    const viewerDocument = await workspaceService.getDocument(
      viewerId,
      created.id,
    );
    expect(viewerDocument).toMatchObject({
      folderId: null,
      permission: 'viewer',
      content: '# Edited together\n',
    });
    await expect(
      workspaceService.saveDocument(
        viewerId,
        created.id,
        {
          baseRevisionId: viewerDocument.currentRevision.id,
          content: 'viewer mutation',
        },
        'workspace-access-viewer-save',
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 });
  });
});
