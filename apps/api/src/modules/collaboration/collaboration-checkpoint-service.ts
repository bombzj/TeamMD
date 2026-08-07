import type {
  CollaborationCheckpointResponse,
  CollaborationStateFormat,
  CollaborativeCheckpointRequest,
  RestoreRevisionRequest,
} from '@teammd/contracts';
import type { Hocuspocus } from '@hocuspocus/server';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';

import { ApiError } from '../../lib/api-error.js';
import type { WorkspaceService } from '../workspace/workspace-service.js';
import type {
  CollaborationContext,
  CollaborationService,
} from './collaboration-service.js';
import { getMilkdownCodec } from './milkdown-codec.js';
import {
  blackboardCollectionHash,
  readBlackboards,
  writeBlackboards,
} from './blackboard-state.js';

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
    const stateFormat =
      await this.collaborationService.getStateFormat(documentId);
    const directConnection = await this.collaboration.openDirectConnection(
      documentId,
      {
        userId,
        userEmail: 'System checkpoint',
        sessionId: 'http-checkpoint',
        documentId,
        permission: 'editor',
        readOnly: false,
        stateFormat,
      },
    );
    const room = directConnection.document;
    if (room === null)
      throw new Error('The collaboration room is unavailable.');

    try {
      return await room.saveMutex.runExclusive(async () => {
        const content = await readMarkdown(room, stateFormat);
        const contentHash = createHash('sha256').update(content).digest('hex');
        const blackboards =
          stateFormat === 'milkdown-blackboards-v1'
            ? readBlackboards(room)
            : [];
        const blackboardHash = blackboardCollectionHash(blackboards);
        await this.collaborationService.storeState(
          documentId,
          Y.encodeStateAsUpdate(room),
          stateFormat,
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
          blackboards,
        );
        room.broadcastStateless(
          JSON.stringify({
            type: 'checkpoint',
            ...result.currentRevision,
            contentHash,
            blackboardHash,
          }),
        );
        return { ...result, contentHash, blackboardHash };
      });
    } finally {
      await directConnection.disconnect({ unloadImmediately: false });
    }
  }

  public async migrateToMilkdown(
    userId: string,
    documentId: string,
  ): Promise<void> {
    await this.workspaceService.getDocument(userId, documentId);
    if (
      (await this.collaborationService.getStateFormat(documentId)) !==
      'legacy-text-v1'
    ) {
      return;
    }
    const directConnection = await this.collaboration.openDirectConnection(
      documentId,
      {
        userId,
        userEmail: 'System format migration',
        sessionId: 'http-format-migration',
        documentId,
        permission: 'viewer',
        readOnly: true,
        stateFormat: 'legacy-text-v1',
      },
    );
    const room = directConnection.document;
    if (room === null)
      throw new Error('The collaboration room is unavailable.');

    let converted = false;
    try {
      converted = await room.saveMutex.runExclusive(async () => {
        if (
          (await this.collaborationService.getStateFormat(documentId)) !==
          'legacy-text-v1'
        ) {
          return false;
        }
        const markdown = room.getText('content').toJSON();
        const codec = await getMilkdownCodec();
        const state = codec.createState(markdown);
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, state);
          if (
            !codec.isSemanticallyEquivalent(markdown, codec.read(candidate))
          ) {
            throw new ApiError(
              409,
              'COLLABORATION_PROTOCOL_MISMATCH',
              'This document cannot be migrated without changing its Markdown.',
              { stateFormat: 'legacy-text-v1' },
            );
          }
        } finally {
          candidate.destroy();
        }
        return this.collaborationService.convertLegacyState(documentId, state);
      });
      if (converted) this.collaboration.closeConnections(documentId);
    } finally {
      await directConnection.disconnect({ unloadImmediately: true });
    }
  }

  public async migrateToBlackboards(
    userId: string,
    documentId: string,
  ): Promise<void> {
    await this.migrateToMilkdown(userId, documentId);
    if (
      (await this.collaborationService.getStateFormat(documentId)) ===
      'milkdown-blackboards-v1'
    ) {
      return;
    }
    const directConnection = await this.collaboration.openDirectConnection(
      documentId,
      {
        userId,
        userEmail: 'System blackboard migration',
        sessionId: 'http-blackboard-migration',
        documentId,
        permission: 'viewer',
        readOnly: true,
        stateFormat: 'milkdown-xml-v1',
      },
    );
    const room = directConnection.document;
    if (room === null)
      throw new Error('The collaboration room is unavailable.');

    let converted = false;
    try {
      converted = await room.saveMutex.runExclusive(async () => {
        if (
          (await this.collaborationService.getStateFormat(documentId)) !==
          'milkdown-xml-v1'
        ) {
          return false;
        }
        return this.collaborationService.convertMilkdownState(
          documentId,
          Y.encodeStateAsUpdate(room),
        );
      });
      if (converted) this.collaboration.closeConnections(documentId);
    } finally {
      await directConnection.disconnect({ unloadImmediately: true });
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
    const stateFormat =
      await this.collaborationService.getStateFormat(documentId);
    const directConnection = await this.collaboration.openDirectConnection(
      documentId,
      {
        userId,
        userEmail: 'System restore',
        sessionId: 'http-restore',
        documentId,
        permission: 'editor',
        readOnly: false,
        stateFormat,
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
        await writeMarkdown(room, stateFormat, source.content);
        if (stateFormat === 'milkdown-blackboards-v1') {
          writeBlackboards(room, source.blackboards);
        }
        await this.collaborationService.storeState(
          documentId,
          Y.encodeStateAsUpdate(room),
          stateFormat,
        );
        const contentHash = createHash('sha256')
          .update(source.content)
          .digest('hex');
        const blackboardHash = blackboardCollectionHash(source.blackboards);
        room.broadcastStateless(
          JSON.stringify({
            type: 'document-restored',
            ...result.currentRevision,
            contentHash,
            blackboardHash,
          }),
        );
        this.collaboration.closeConnections(documentId);
        return { ...result, contentHash, blackboardHash };
      });
    } finally {
      await directConnection.disconnect({ unloadImmediately: false });
    }
  }
}

async function readMarkdown(
  document: Y.Doc,
  stateFormat: CollaborationStateFormat,
): Promise<string> {
  if (stateFormat === 'legacy-text-v1') {
    return document.getText('content').toJSON();
  }
  return (await getMilkdownCodec()).read(document);
}

async function writeMarkdown(
  document: Y.Doc,
  stateFormat: CollaborationStateFormat,
  markdown: string,
): Promise<void> {
  if (stateFormat === 'legacy-text-v1') {
    const text = document.getText('content');
    document.transact(() => {
      text.delete(0, text.length);
      if (markdown.length > 0) text.insert(0, markdown);
    });
    return;
  }
  (await getMilkdownCodec()).write(document, markdown);
}
