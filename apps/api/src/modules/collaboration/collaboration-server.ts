import { Server } from '@hocuspocus/server';
import type { ServerConfig } from '@teammd/config';
import type { Socket } from 'node:net';
import * as Y from 'yjs';

import type {
  CollaborationContext,
  CollaborationService,
} from './collaboration-service.js';
import { getMilkdownCodec } from './milkdown-codec.js';
import { validateBlackboardTransition } from './blackboard-state.js';

const maximumMarkdownBytes = 2 * 1024 * 1024;
const maximumSocketPayloadBytes = 3 * 1024 * 1024;
const shutdownGracePeriodMs = 20_000;

/**
 * Hocuspocus closes its document-level connections during destroy(), but its
 * multiplexed WebSocket transport can remain open. Track the underlying TCP
 * sockets so shutdown can release both authenticated and unauthenticated peers
 * after document state has been flushed.
 */
export class TeamMdCollaborationServer<Context> extends Server<Context> {
  readonly #sockets = new Set<Socket>();
  #destroyPromise: Promise<void> | undefined;

  public constructor(
    configuration: ConstructorParameters<typeof Server<Context>>[0],
  ) {
    super(configuration);
    this.httpServer.on('connection', (socket) => {
      this.#sockets.add(socket);
      socket.once('close', () => this.#sockets.delete(socket));
    });
  }

  public override destroy(): Promise<void> {
    this.#destroyPromise ??= this.#runDestroy();
    return this.#destroyPromise;
  }

  async #runDestroy(): Promise<void> {
    try {
      await withDeadline(super.destroy(), shutdownGracePeriodMs);
    } finally {
      // Upgraded sockets are not closed by http.Server.closeAllConnections().
      // Destroying them also makes Hocuspocus clear each client heartbeat.
      for (const socket of this.#sockets) socket.destroy();
      this.#sockets.clear();
      this.httpServer.closeAllConnections();
    }
  }
}

export function createCollaborationServer(
  config: ServerConfig,
  collaborationService: CollaborationService,
): TeamMdCollaborationServer<CollaborationContext> {
  return new TeamMdCollaborationServer<CollaborationContext>({
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
    async onStoreDocument({ documentName, document, lastContext }) {
      await collaborationService.storeState(
        documentName,
        Y.encodeStateAsUpdate(document),
        lastContext.stateFormat,
      );
    },
    beforeHandleAwareness({ states, context }) {
      const identity = collaborationIdentity(
        context?.userId ?? 'unknown',
        context?.userEmail ?? 'Unknown collaborator',
      );
      for (const state of states.values()) {
        state.user = {
          id: context?.userId ?? 'unknown',
          name: identity.name,
          permission: context?.permission ?? 'viewer',
          color: identity.color,
          colorLight: identity.colorLight,
        };
      }
      return Promise.resolve();
    },
    async beforeSync({ context, document, type, payload }) {
      if (type === 0) return Promise.resolve();
      const candidate = new Y.Doc();
      try {
        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
        Y.applyUpdate(candidate, payload);
        const markdown =
          context.stateFormat !== 'legacy-text-v1'
            ? (await getMilkdownCodec()).read(candidate)
            : candidate.getText('content').toJSON();
        if (
          new TextEncoder().encode(markdown).byteLength > maximumMarkdownBytes
        ) {
          throw new Error('Markdown content is too large.');
        }
        if (context.stateFormat === 'milkdown-blackboards-v1') {
          validateBlackboardTransition(document, candidate, markdown);
        }
      } finally {
        candidate.destroy();
      }
      return Promise.resolve();
    },
  });
}

function withDeadline(operation: Promise<void>, milliseconds: number) {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Collaboration shutdown grace period expired.')),
      milliseconds,
    );
    timeout.unref();
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function collaborationIdentity(userId: string, name: string) {
  const colors = [
    ['#a83c32', '#f8d9d4'],
    ['#19705f', '#d3eee8'],
    ['#76561b', '#f3e5bd'],
    ['#315f89', '#d7e8f5'],
  ] as const;
  const index = [...userId].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % colors.length,
    0,
  );
  const [color, colorLight] = colors[index] ?? colors[0];
  return { name, color, colorLight };
}
