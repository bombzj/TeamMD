import type {
  CollaborationCheckpointResponse,
  CollaborativeCheckpointRequest,
  RestoreRevisionRequest,
} from '@teammd/contracts';
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
        userEmail: 'System checkpoint',
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

  public async restoreRevision(
    userId: string,
    documentId: string,
    revisionId: string,
    input: RestoreRevisionRequest,
    requestId: string,
  ): Promise<CollaborationCheckpointResponse> {
    const source = await this.workspaceService.getRevision(
      userId,
      documentId,
      revisionId,
    );
    const directConnection = await this.collaboration.openDirectConnection(
      documentId,
      {
        userId,
        userEmail: 'System restore',
        sessionId: 'http-restore',
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
        const result = await this.workspaceService.restoreRevision(
          userId,
          documentId,
          revisionId,
          input,
          requestId,
        );
        const text = room.getText('content');
        room.transact(() => {
          text.delete(0, text.length);
          if (source.content.length > 0) text.insert(0, source.content);
        });
        await this.collaborationService.storeState(
          documentId,
          Y.encodeStateAsUpdate(room),
        );
        const contentHash = createHash('sha256')
          .update(source.content)
          .digest('hex');
        room.broadcastStateless(
          JSON.stringify({
            type: 'document-restored',
            ...result.currentRevision,
            contentHash,
          }),
        );
        this.collaboration.closeConnections(documentId);
        return { ...result, contentHash };
      });
    } finally {
      await directConnection.disconnect({ unloadImmediately: false });
    }
  }
}
