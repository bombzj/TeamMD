import type {
  CollaborationCheckpointResponse,
  CollaborativeCheckpointRequest,
} from '@mymd/contracts';
import type { Hocuspocus } from '@hocuspocus/server';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';

import type { WorkspaceService } from '../workspace/workspace-service.js';
import type {
  CollaborationContext,
  CollaborationService,
} from './collaboration-service.js';

export class CollaborationCheckpointService {
  public constructor(
    private readonly collaboration: Hocuspocus<CollaborationContext>,
    private readonly collaborationService: CollaborationService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  public async checkpoint(
    userId: string,
    documentId: string,
    input: CollaborativeCheckpointRequest,
    requestId: string,
  ): Promise<CollaborationCheckpointResponse> {
    const directConnection = await this.collaboration.openDirectConnection(
      documentId,
      {
        userId,
        sessionId: 'http-checkpoint',
        documentId,
        permission: 'editor',
        readOnly: false,
      },
    );
    const room = directConnection.document;
    if (room === null)
      throw new Error('The collaboration room is unavailable.');

    try {
      return await room.saveMutex.runExclusive(async () => {
        const content = room.getText('content').toJSON();
        const contentHash = createHash('sha256').update(content).digest('hex');
        await this.collaborationService.storeState(
          documentId,
          Y.encodeStateAsUpdate(room),
        );
        const baseRevisionId =
          await this.collaborationService.getCheckpointRevisionId(documentId);
        const result = await this.workspaceService.saveDocument(
          userId,
          documentId,
          {
            baseRevisionId,
            content,
            ...(input.saveMessage === undefined
              ? {}
              : { saveMessage: input.saveMessage }),
          },
          requestId,
          true,
        );
        room.broadcastStateless(
          JSON.stringify({
            type: 'checkpoint',
            ...result.currentRevision,
            contentHash,
          }),
        );
        return { ...result, contentHash };
      });
    } finally {
      await directConnection.disconnect({ unloadImmediately: false });
    }
  }
}
