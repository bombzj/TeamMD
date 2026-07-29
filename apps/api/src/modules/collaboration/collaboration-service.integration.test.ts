import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { hashToken } from '../../lib/tokens.js';
import { WorkspaceService } from '../workspace/workspace-service.js';
import { CollaborationService } from './collaboration-service.js';

dotenv.config({ path: '../../.env.local' });

const prisma = new PrismaClient();
const collaborationService = new CollaborationService(prisma);
const workspaceService = new WorkspaceService(prisma);
const testEmail = `collaboration-test-${crypto.randomUUID()}@example.test`;
let ownerId: string;
let viewerId: string;
let ownerSessionId: string;
let viewerSessionId: string;

beforeAll(async () => {
  await prisma.$connect();
  const [owner, viewer] = await Promise.all([
    prisma.user.create({
      data: {
        email: testEmail,
        normalizedEmail: testEmail,
        passwordHash: 'integration-test-only',
      },
    }),
    prisma.user.create({
      data: {
        email: `viewer-${testEmail}`,
        normalizedEmail: `viewer-${testEmail}`,
        passwordHash: 'integration-test-only',
      },
    }),
  ]);
  ownerId = owner.id;
  viewerId = viewer.id;
  const expiresAt = new Date(Date.now() + 60_000);
  const [ownerSession, viewerSession] = await Promise.all([
    prisma.session.create({
      data: {
        userId: owner.id,
        tokenHash: hashToken(crypto.randomUUID()),
        csrfTokenHash: hashToken(crypto.randomUUID()),
        sessionEpoch: owner.sessionEpoch,
        expiresAt,
      },
    }),
    prisma.session.create({
      data: {
        userId: viewer.id,
        tokenHash: hashToken(crypto.randomUUID()),
        csrfTokenHash: hashToken(crypto.randomUUID()),
        sessionEpoch: viewer.sessionEpoch,
        expiresAt,
      },
    }),
  ]);
  ownerSessionId = ownerSession.id;
  viewerSessionId = viewerSession.id;
});

afterAll(async () => {
  await prisma.documentRevision.deleteMany({
    where: { authorId: { in: [ownerId, viewerId] } },
  });
  await prisma.document.deleteMany({ where: { ownerId } });
  await prisma.session.deleteMany({
    where: { userId: { in: [ownerId, viewerId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ownerId, viewerId] } },
  });
  await prisma.$disconnect();
});

describe('CollaborationService with MySQL', () => {
  it('consumes scoped tickets once and restores persisted Yjs state', async () => {
    const created = await workspaceService.createDocument(
      ownerId,
      { name: 'Together.md', folderId: null },
      'collaboration-create-document',
    );
    await prisma.documentAccess.create({
      data: {
        documentId: created.id,
        userId: viewerId,
        role: 'VIEWER',
        grantedById: ownerId,
      },
    });

    const ownerTicket = await collaborationService.createTicket(
      ownerId,
      ownerSessionId,
      created.id,
      'ws://127.0.0.1:3001',
    );
    const ownerContext = await collaborationService.consumeTicket(
      ownerTicket.ticket,
      created.id,
    );
    expect(ownerContext).toMatchObject({
      userId: ownerId,
      userEmail: testEmail,
      documentId: created.id,
      permission: 'owner',
      readOnly: false,
    });
    await expect(
      collaborationService.consumeTicket(ownerTicket.ticket, created.id),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });

    const viewerTicket = await collaborationService.createTicket(
      viewerId,
      viewerSessionId,
      created.id,
      'ws://127.0.0.1:3001',
    );
    await expect(
      collaborationService.consumeTicket(viewerTicket.ticket, 'other-room'),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    const viewerContext = await collaborationService.consumeTicket(
      viewerTicket.ticket,
      created.id,
    );
    expect(viewerContext).toMatchObject({
      userEmail: `viewer-${testEmail}`,
      permission: 'viewer',
      readOnly: true,
    });

    const initialState = await collaborationService.loadState(created.id);
    const document = new Y.Doc();
    Y.applyUpdate(document, initialState);
    const markdown = document.getText('content');
    expect(markdown.toJSON()).toBe('');
    markdown.insert(0, '# Concurrent Markdown\n');
    await collaborationService.storeState(
      created.id,
      Y.encodeStateAsUpdate(document),
    );

    const restored = new Y.Doc();
    Y.applyUpdate(restored, await collaborationService.loadState(created.id));
    expect(restored.getText('content').toJSON()).toBe(
      '# Concurrent Markdown\n',
    );
  });
});
