import { Server } from '@hocuspocus/server';
import type { ServerConfig } from '@mymd/config';
import * as Y from 'yjs';

import type {
  CollaborationContext,
  CollaborationService,
} from './collaboration-service.js';

const maximumMarkdownBytes = 2 * 1024 * 1024;
const maximumSocketPayloadBytes = 3 * 1024 * 1024;

export function createCollaborationServer(
  config: ServerConfig,
  collaborationService: CollaborationService,
): Server<CollaborationContext> {
  return new Server<CollaborationContext>({
    address: config.host,
    port: config.collaborationPort,
    quiet: true,
    stopOnSignals: false,
    debounce: 1_000,
    maxDebounce: 5_000,
    unloadImmediately: false,
    timeout: 60_000,
    maxUnauthenticatedQueueSize: 256 * 1024,
    maxUnauthenticatedQueueMessages: 50,
    maxPendingDocuments: 1,
    websocketOptions: { maxPayload: maximumSocketPayloadBytes },
    onConnect({ requestHeaders }) {
      if (requestHeaders.get('origin') !== config.webOrigin) {
        return Promise.reject(new Error('Origin not allowed.'));
      }
      return Promise.resolve();
    },
    async onAuthenticate({ documentName, token, connectionConfig }) {
      const context = await collaborationService.consumeTicket(
        token,
        documentName,
      );
      connectionConfig.readOnly = context.readOnly;
      return context;
    },
    async onLoadDocument({ documentName }) {
      return collaborationService.loadState(documentName);
    },
    async onStoreDocument({ documentName, document }) {
      await collaborationService.storeState(
        documentName,
        Y.encodeStateAsUpdate(document),
      );
    },
    beforeHandleAwareness({ states, context }) {
      for (const state of states.values()) {
        state.user = {
          id: context?.userId ?? 'unknown',
          permission: context?.permission ?? 'viewer',
        };
      }
      return Promise.resolve();
    },
    beforeSync({ document, type, payload }) {
      if (type === 0) return Promise.resolve();
      const candidate = new Y.Doc();
      try {
        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
        Y.applyUpdate(candidate, payload);
        if (
          new TextEncoder().encode(candidate.getText('content').toJSON())
            .byteLength > maximumMarkdownBytes
        ) {
          throw new Error('Markdown content is too large.');
        }
      } finally {
        candidate.destroy();
      }
      return Promise.resolve();
    },
  });
}
