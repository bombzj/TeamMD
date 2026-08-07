import { Hocuspocus } from '@hocuspocus/server';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { WorkspaceService } from '../workspace/workspace-service.js';
import { CollaborationCheckpointService } from './collaboration-checkpoint-service.js';
import type {
  CollaborationContext,
  CollaborationService,
} from './collaboration-service.js';
import { getMilkdownCodec } from './milkdown-codec.js';
import {
  blackboardCollectionHash,
  writeBlackboards,
} from './blackboard-state.js';

const documentId = 'cm1234567890documentabcde';
const userId = 'cm1234567890userabcdefgh';
const baseRevisionId = 'cm1234567890revisionabcde';
const roomContent = `# Authoritative room

Inline $E = mc^2$.

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$
`;
const savedRevision = {
  id: 'cm1234567890revisionnextab',
  ordinal: 2,
  createdAt: '2026-07-28T00:05:00.000Z',
};
const emptyBlackboardHash = createHash('sha256').update('[]').digest('hex');

describe('CollaborationCheckpointService', () => {
  it('saves the authoritative room snapshot and broadcasts its revision', async () => {
    const initialDocument = new Y.Doc();
    initialDocument.getText('content').insert(0, roomContent);
    const initialState = Y.encodeStateAsUpdate(initialDocument);
    const loadState = vi
      .fn<() => Promise<Uint8Array>>()
      .mockResolvedValue(initialState);
    const storeState = vi.fn().mockResolvedValue(undefined);
    const getCheckpointRevisionId = vi.fn().mockResolvedValue(baseRevisionId);
    const saveDocument = vi.fn().mockResolvedValue({
      documentId,
      currentRevision: savedRevision,
    });
    const collaboration = new Hocuspocus<CollaborationContext>({
      onLoadDocument() {
        return loadState();
      },
      async onStoreDocument({ document }) {
        await storeState(Y.encodeStateAsUpdate(document));
      },
    });
    const roomConnection = await collaboration.openDirectConnection(documentId);
    const room = roomConnection.document;
    if (room === null) throw new Error('Test room did not load.');
    const broadcastStateless = vi.spyOn(room, 'broadcastStateless');
    const service = new CollaborationCheckpointService(
      collaboration,
      {
        getStateFormat: vi.fn().mockResolvedValue('legacy-text-v1'),
        storeState,
        getCheckpointRevisionId,
      } as unknown as CollaborationService,
      { saveDocument } as unknown as WorkspaceService,
    );

    const result = await service.checkpoint(
      userId,
      documentId,
      {},
      'request-1',
    );
    const contentHash = createHash('sha256').update(roomContent).digest('hex');

    expect(saveDocument).toHaveBeenCalledWith(
      userId,
      documentId,
      { baseRevisionId, content: roomContent },
      'request-1',
      true,
      [],
    );
    expect(result).toEqual({
      documentId,
      currentRevision: savedRevision,
      contentHash,
      blackboardHash: emptyBlackboardHash,
    });
    expect(broadcastStateless).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'checkpoint',
        ...savedRevision,
        contentHash,
        blackboardHash: emptyBlackboardHash,
      }),
    );

    await roomConnection.disconnect();
    initialDocument.destroy();
  });

  it('restores historical content into the authoritative room and reconnects clients', async () => {
    const historicalContent = '# Restored history\n';
    const initialDocument = new Y.Doc();
    initialDocument.getText('content').insert(0, roomContent);
    const storeState = vi.fn().mockResolvedValue(undefined);
    const restoredRevision = {
      id: 'cm1234567890revisionrestore',
      ordinal: 4,
      createdAt: '2026-07-28T00:10:00.000Z',
    };
    const collaboration = new Hocuspocus<CollaborationContext>({
      onLoadDocument() {
        return Promise.resolve(Y.encodeStateAsUpdate(initialDocument));
      },
    });
    const roomConnection = await collaboration.openDirectConnection(documentId);
    const room = roomConnection.document;
    if (room === null) throw new Error('Test room did not load.');
    const broadcastStateless = vi.spyOn(room, 'broadcastStateless');
    const closeConnections = vi.spyOn(collaboration, 'closeConnections');
    const restoreRevision = vi.fn().mockResolvedValue({
      documentId,
      currentRevision: restoredRevision,
    });
    const service = new CollaborationCheckpointService(
      collaboration,
      {
        getStateFormat: vi.fn().mockResolvedValue('legacy-text-v1'),
        storeState,
      } as unknown as CollaborationService,
      {
        getRevision: vi
          .fn()
          .mockResolvedValue({ content: historicalContent, blackboards: [] }),
        restoreRevision,
      } as unknown as WorkspaceService,
    );

    const result = await service.restoreRevision(
      userId,
      documentId,
      baseRevisionId,
      { baseRevisionId: savedRevision.id },
      'request-restore',
    );
    const contentHash = createHash('sha256')
      .update(historicalContent)
      .digest('hex');

    expect(room.getText('content').toJSON()).toBe(historicalContent);
    expect(storeState).toHaveBeenCalledOnce();
    expect(restoreRevision).toHaveBeenCalledWith(
      userId,
      documentId,
      baseRevisionId,
      { baseRevisionId: savedRevision.id },
      'request-restore',
    );
    expect(result).toEqual({
      documentId,
      currentRevision: restoredRevision,
      contentHash,
      blackboardHash: emptyBlackboardHash,
    });
    expect(broadcastStateless).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'document-restored',
        ...restoredRevision,
        contentHash,
        blackboardHash: emptyBlackboardHash,
      }),
    );
    expect(closeConnections).toHaveBeenCalledWith(documentId);

    await roomConnection.disconnect();
    initialDocument.destroy();
  });

  it('checkpoints and restores Milkdown structured state as canonical Markdown', async () => {
    const codec = await getMilkdownCodec();
    const initialDocument = new Y.Doc();
    Y.applyUpdate(initialDocument, codec.createState(roomContent));
    const storeState = vi.fn().mockResolvedValue(undefined);
    const saveDocument = vi.fn().mockResolvedValue({
      documentId,
      currentRevision: savedRevision,
    });
    const restoredContent = '# Restored structured room\n';
    const collaboration = new Hocuspocus<CollaborationContext>({
      onLoadDocument() {
        return Promise.resolve(Y.encodeStateAsUpdate(initialDocument));
      },
    });
    const roomConnection = await collaboration.openDirectConnection(documentId);
    const room = roomConnection.document;
    if (room === null) throw new Error('Test room did not load.');
    const service = new CollaborationCheckpointService(
      collaboration,
      {
        getStateFormat: vi.fn().mockResolvedValue('milkdown-xml-v1'),
        storeState,
        getCheckpointRevisionId: vi.fn().mockResolvedValue(baseRevisionId),
      } as unknown as CollaborationService,
      {
        saveDocument,
        getRevision: vi
          .fn()
          .mockResolvedValue({ content: restoredContent, blackboards: [] }),
        restoreRevision: vi.fn().mockResolvedValue({
          documentId,
          currentRevision: savedRevision,
        }),
      } as unknown as WorkspaceService,
    );

    await service.checkpoint(userId, documentId, {}, 'request-structured');
    expect(saveDocument).toHaveBeenCalledWith(
      userId,
      documentId,
      { baseRevisionId, content: roomContent },
      'request-structured',
      true,
      [],
    );

    await service.restoreRevision(
      userId,
      documentId,
      baseRevisionId,
      { baseRevisionId: savedRevision.id },
      'request-structured-restore',
    );
    expect(codec.read(room)).toBe(restoredContent);
    expect(room.getText('content').length).toBe(0);

    await roomConnection.disconnect();
    initialDocument.destroy();
  });

  it('checkpoints frozen blackboard backgrounds from the authoritative room', async () => {
    const codec = await getMilkdownCodec();
    const initialDocument = new Y.Doc();
    Y.applyUpdate(initialDocument, codec.createState(roomContent));
    const board = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Board 1',
      order: 0,
      backgroundMarkdown: roomContent,
      backgroundHash: createHash('sha256').update(roomContent).digest('hex'),
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
    writeBlackboards(initialDocument, [board]);
    const saveDocument = vi.fn().mockResolvedValue({
      documentId,
      currentRevision: savedRevision,
    });
    const collaboration = new Hocuspocus<CollaborationContext>({
      onLoadDocument() {
        return Promise.resolve(Y.encodeStateAsUpdate(initialDocument));
      },
    });
    const service = new CollaborationCheckpointService(
      collaboration,
      {
        getStateFormat: vi.fn().mockResolvedValue('milkdown-blackboards-v1'),
        storeState: vi.fn().mockResolvedValue(undefined),
        getCheckpointRevisionId: vi.fn().mockResolvedValue(baseRevisionId),
      } as unknown as CollaborationService,
      { saveDocument } as unknown as WorkspaceService,
    );

    const result = await service.checkpoint(
      userId,
      documentId,
      {},
      'request-blackboard',
    );
    expect(saveDocument).toHaveBeenCalledWith(
      userId,
      documentId,
      { baseRevisionId, content: roomContent },
      'request-blackboard',
      true,
      [board],
    );
    expect(result.blackboardHash).toBe(blackboardCollectionHash([board]));
    initialDocument.destroy();
  });

  it('converts the complete live legacy draft before admitting Milkdown clients', async () => {
    const initialDocument = new Y.Doc();
    initialDocument.getText('content').insert(0, roomContent);
    let convertedState: Uint8Array | undefined;
    const collaboration = new Hocuspocus<CollaborationContext>({
      onLoadDocument() {
        return Promise.resolve(Y.encodeStateAsUpdate(initialDocument));
      },
    });
    const closeConnections = vi.spyOn(collaboration, 'closeConnections');
    const getDocument = vi.fn().mockResolvedValue({ permission: 'owner' });
    const service = new CollaborationCheckpointService(
      collaboration,
      {
        getStateFormat: vi.fn().mockResolvedValue('legacy-text-v1'),
        convertLegacyState: vi.fn((_documentId, state: Uint8Array) => {
          convertedState = state;
          return Promise.resolve(true);
        }),
      } as unknown as CollaborationService,
      { getDocument } as unknown as WorkspaceService,
    );

    await service.migrateToMilkdown(userId, documentId);

    expect(getDocument).toHaveBeenCalledWith(userId, documentId);
    expect(closeConnections).toHaveBeenCalledWith(documentId);
    expect(convertedState).toBeDefined();
    const convertedDocument = new Y.Doc();
    Y.applyUpdate(convertedDocument, convertedState!);
    expect((await getMilkdownCodec()).read(convertedDocument)).toBe(
      roomContent,
    );
    expect(convertedDocument.getText('content').length).toBe(0);

    convertedDocument.destroy();
    initialDocument.destroy();
  });
});
