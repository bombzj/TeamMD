import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import type { ServerConfig } from '@teammd/config';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { createCollaborationServer } from './collaboration-server.js';
import type {
  CollaborationContext,
  CollaborationService,
} from './collaboration-service.js';
import { getMilkdownCodec } from './milkdown-codec.js';

const roomName = 'cm1234567890documentabcde';
const webOrigin = 'http://localhost:5173';
type AwarenessState = Record<string, unknown>;
type AwarenessUser = {
  id: string;
  name: string;
  permission: string;
};
const config: ServerConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  webOrigin,
  databaseUrl: 'mysql://unused',
  collaborationPort: 0,
  collaborationUrl: 'ws://127.0.0.1:0',
  sessionTtlDays: 30,
  secureCookies: false,
};

class OriginWebSocket extends WebSocket {
  public constructor(address: string | URL) {
    super(address, { origin: webOrigin });
  }
}

class InMemoryCollaborationService {
  public state = emptyState();
  public stateFormat: CollaborationContext['stateFormat'] = 'legacy-text-v1';

  public consumeTicket(
    ticket: string,
    documentId: string,
  ): Promise<CollaborationContext> {
    if (
      documentId !== roomName ||
      !['writer-a', 'writer-b', 'viewer'].includes(ticket)
    ) {
      return Promise.reject(new Error('Invalid test ticket.'));
    }
    const readOnly = ticket === 'viewer';
    return Promise.resolve({
      userId: ticket,
      userEmail: `${ticket}@example.test`,
      sessionId: `session-${ticket}`,
      documentId,
      permission: readOnly ? 'viewer' : 'editor',
      readOnly,
      stateFormat: this.stateFormat,
    });
  }

  public loadState(documentId: string): Promise<Uint8Array> {
    if (documentId !== roomName) throw new Error('Unknown test room.');
    return Promise.resolve(this.state);
  }

  public storeState(documentId: string, state: Uint8Array): Promise<void> {
    if (documentId !== roomName) throw new Error('Unknown test room.');
    this.state = state;
    return Promise.resolve();
  }
}

const providers: HocuspocusProvider[] = [];

afterEach(() => {
  providers.splice(0).forEach((provider) => provider.destroy());
});

describe('collaboration gateway', () => {
  it('converges writers, rejects viewer updates, and stores the room state', async () => {
    const service = new InMemoryCollaborationService();
    const server = createCollaborationServer(
      config,
      service as unknown as CollaborationService,
    );
    await server.listen(0);

    try {
      const writerA = createProvider(server.webSocketURL, 'writer-a');
      const writerB = createProvider(server.webSocketURL, 'writer-b');
      await Promise.all([
        waitForSync(writerA, 'writer A sync'),
        waitForSync(writerB, 'writer B sync'),
      ]);

      writerA.setAwarenessField('user', { name: 'Spoofed client name' });
      await waitForAwareness(
        writerB,
        (state) => readAwarenessUser(state)?.name === 'writer-a@example.test',
        'trusted writer A identity',
      );
      const writerAState = [...writerB.awareness!.getStates().values()].find(
        (state: AwarenessState) => readAwarenessUser(state)?.id === 'writer-a',
      );
      expect(
        writerAState === undefined
          ? undefined
          : readAwarenessUser(writerAState),
      ).toMatchObject({
        id: 'writer-a',
        name: 'writer-a@example.test',
        permission: 'editor',
      });

      writerA.document.getText('content').insert(0, 'Alpha ');
      writerB.document.getText('content').insert(0, 'Beta ');
      await Promise.all([
        waitForDocument(
          writerA.document,
          hasBothWriterEdits,
          'writer A convergence',
        ),
        waitForDocument(
          writerB.document,
          hasBothWriterEdits,
          'writer B convergence',
        ),
      ]);
      const converged = writerA.document.getText('content').toJSON();
      expect(writerB.document.getText('content').toJSON()).toBe(converged);

      const viewer = createProvider(server.webSocketURL, 'viewer');
      await waitForSync(viewer, 'viewer sync');
      const viewerUpdateSent = waitForOutgoingUpdate(viewer, 'viewer update');
      viewer.document.getText('content').insert(0, 'FORBIDDEN ');
      await viewerUpdateSent;
      const room = await server.hocuspocus.openDirectConnection(roomName);
      expect(writerA.document.getText('content').toJSON()).toBe(converged);
      expect(writerB.document.getText('content').toJSON()).toBe(converged);
      expect(room.document?.getText('content').toJSON()).toBe(converged);
      await room.disconnect({ unloadImmediately: false });

      server.hocuspocus.flushPendingStores();
      await server.hocuspocus
        .openDirectConnection(roomName)
        .then(async (connection) => connection.disconnect());
      const restored = new Y.Doc();
      Y.applyUpdate(restored, service.state);
      expect(restored.getText('content').toJSON()).toBe(converged);
      restored.destroy();
    } finally {
      providers.splice(0).forEach((provider) => provider.destroy());
      await server.destroy();
    }
  });

  it('converges and persists Milkdown XML state across writers', async () => {
    const codec = await getMilkdownCodec();
    const service = new InMemoryCollaborationService();
    service.stateFormat = 'milkdown-xml-v1';
    service.state = codec.createState(`# Structured room

\`\`\`mermaid
flowchart LR
  Source --> Preview
\`\`\`
`);
    const server = createCollaborationServer(
      config,
      service as unknown as CollaborationService,
    );
    await server.listen(0);

    try {
      const writerA = createProvider(server.webSocketURL, 'writer-a');
      const writerB = createProvider(server.webSocketURL, 'writer-b');
      await Promise.all([
        waitForSync(writerA, 'structured writer A sync'),
        waitForSync(writerB, 'structured writer B sync'),
      ]);
      const fragmentA = writerA.document.getXmlFragment('milkdown');
      const fragmentB = writerB.document.getXmlFragment('milkdown');
      const sourceA = getMermaidSource(fragmentA);
      const sourceB = getMermaidSource(fragmentB);
      sourceA.insert(sourceA.length, '\n  Preview --> WriterA');
      sourceB.insert(sourceB.length, '\n  Preview --> WriterB');
      await Promise.all([
        waitForXml(
          fragmentA,
          () => hasBothMermaidEdits(sourceA.toJSON()),
          'writer A Mermaid convergence',
        ),
        waitForXml(
          fragmentB,
          () => hasBothMermaidEdits(sourceB.toJSON()),
          'writer B Mermaid convergence',
        ),
      ]);
      const convergedMarkdown = codec.read(writerA.document);
      expect(codec.read(writerB.document)).toBe(convergedMarkdown);
      expect(convergedMarkdown).toContain('```mermaid');
      expect(convergedMarkdown).not.toContain('<svg');

      server.hocuspocus.flushPendingStores();
      await server.hocuspocus
        .openDirectConnection(roomName)
        .then(async (connection) => connection.disconnect());
      const restored = new Y.Doc();
      Y.applyUpdate(restored, service.state);
      expect(codec.read(restored)).toBe(convergedMarkdown);
      expect(codec.read(restored)).not.toContain('<svg');
      expect(restored.getText('content').length).toBe(0);
      restored.destroy();
    } finally {
      providers.splice(0).forEach((provider) => provider.destroy());
      await server.destroy();
    }
  });
});

function createProvider(url: string, ticket: string): HocuspocusProvider {
  const websocketProvider = new HocuspocusProviderWebsocket({
    url,
    WebSocketPolyfill: OriginWebSocket,
  });
  const provider = new HocuspocusProvider({
    name: roomName,
    document: new Y.Doc(),
    token: ticket,
    websocketProvider,
  });
  provider.attach();
  providers.push(provider);
  return provider;
}

function waitForSync(
  provider: HocuspocusProvider,
  label: string,
): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return withTimeout<void>(label, (resolve) => {
    provider.on('synced', () => resolve());
  });
}

function waitForDocument(
  document: Y.Doc,
  predicate: (content: string) => boolean,
  label: string,
): Promise<void> {
  if (predicate(document.getText('content').toJSON())) return Promise.resolve();
  return withTimeout<void>(label, (resolve) => {
    const handleUpdate = () => {
      if (!predicate(document.getText('content').toJSON())) return;
      document.off('update', handleUpdate);
      resolve();
    };
    document.on('update', handleUpdate);
  });
}

function waitForXml(
  fragment: Y.XmlFragment,
  predicate: () => boolean,
  label: string,
): Promise<void> {
  if (predicate()) return Promise.resolve();
  return withTimeout<void>(label, (resolve) => {
    const handleUpdate = () => {
      if (!predicate()) return;
      fragment.unobserveDeep(handleUpdate);
      resolve();
    };
    fragment.observeDeep(handleUpdate);
  });
}

function getMermaidSource(fragment: Y.XmlFragment): Y.XmlText {
  const codeBlock = fragment
    .toArray()
    .find(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement &&
        node.nodeName === 'code_block' &&
        node.getAttribute('language') === 'mermaid',
    );
  const source = codeBlock?.toArray()[0];
  if (!(source instanceof Y.XmlText)) {
    throw new Error('Mermaid source was not stored as Y.XmlText.');
  }
  return source;
}

function waitForAwareness(
  provider: HocuspocusProvider,
  predicate: (state: AwarenessState) => boolean,
  label: string,
): Promise<void> {
  const awareness = provider.awareness;
  if (awareness === null) throw new Error('Awareness is unavailable.');
  if ([...awareness.getStates().values()].some(predicate)) {
    return Promise.resolve();
  }
  return withTimeout<void>(label, (resolve) => {
    const handleChange = () => {
      if (![...awareness.getStates().values()].some(predicate)) return;
      awareness.off('change', handleChange);
      resolve();
    };
    awareness.on('change', handleChange);
  });
}

function readAwarenessUser(state: AwarenessState): AwarenessUser | undefined {
  const user = state.user;
  if (typeof user !== 'object' || user === null) return undefined;
  const candidate = user as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.permission !== 'string'
  ) {
    return undefined;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    permission: candidate.permission,
  };
}

function waitForOutgoingUpdate(
  provider: HocuspocusProvider,
  label: string,
): Promise<void> {
  return withTimeout<void>(label, (resolve) => {
    provider.on(
      'outgoingMessage',
      ({ message }: { message: { type?: number } }) => {
        if (message.type === 0) resolve();
      },
    );
  });
}

function withTimeout<T>(
  label: string,
  subscribe: (resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}.`)),
      5_000,
    );
    subscribe((value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}

function hasBothWriterEdits(content: string): boolean {
  return content.includes('Alpha ') && content.includes('Beta ');
}

function hasBothMermaidEdits(content: string): boolean {
  return (
    content.includes('Preview --> WriterA') &&
    content.includes('Preview --> WriterB')
  );
}

function emptyState(): Uint8Array {
  const document = new Y.Doc();
  const state = Y.encodeStateAsUpdate(document);
  document.destroy();
  return state;
}
