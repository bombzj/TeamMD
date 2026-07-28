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

const documentId = 'cm1234567890documentabcde';
const userId = 'cm1234567890userabcdefgh';
const baseRevisionId = 'cm1234567890revisionabcde';
const roomContent = '# Authoritative room\n';
const savedRevision = {
  id: 'cm1234567890revisionnextab',
  ordinal: 2,
  createdAt: '2026-07-28T00:05:00.000Z',
};

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
    );
    expect(result).toEqual({
      documentId,
      currentRevision: savedRevision,
      contentHash,
    });
    expect(broadcastStateless).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'checkpoint',
        ...savedRevision,
        contentHash,
      }),
    );

    await roomConnection.disconnect();
    initialDocument.destroy();
  });
});
