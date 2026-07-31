import type { Crepe } from '@milkdown/crepe';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import {
  collaborationCheckpointEventSchema,
  collaborationRestoreEventSchema,
  type CollaborationCheckpointEvent,
  type CollaborationTicketResponse,
} from '@teammd/contracts';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { createTeamMdEditor } from './editor-feature-profile.js';
import { runHistoryShortcut } from './editor-history.js';

export type CollaborationTransport =
  `${WebSocketStatus}` | 'synced' | 'offline';

type CollaborativeEditorOptions = {
  documentId: string;
  editorHost: HTMLElement;
  createTicket: () => Promise<CollaborationTicketResponse>;
  onCheckpoint: (checkpoint: CollaborationCheckpointEvent) => void;
  onRestore: () => void;
  onContentChange: (content: string) => void;
  onError: (message: string) => void;
  onPermissionChange: (
    permission: CollaborationTicketResponse['permission'],
  ) => void;
  onPresenceChange: (participantCount: number) => void;
  onTransportChange: (transport: CollaborationTransport) => void;
};

export type CollaborativeEditor = {
  destroy: () => void;
  getContent: () => string;
  prepareCheckpoint: () => Promise<void>;
  redo: () => boolean;
  undo: () => boolean;
};

export async function createCollaborativeEditor(
  options: CollaborativeEditorOptions,
): Promise<CollaborativeEditor> {
  const initialTicket = await options.createTicket();
  if (initialTicket.stateFormat !== 'milkdown-xml-v1') {
    throw new Error('The collaboration room requires an unsupported editor.');
  }
  let readOnly = initialTicket.permission === 'viewer';
  let nextTicket: CollaborationTicketResponse | null = initialTicket;
  let crepe: Crepe | null = null;
  let currentContent = '';
  let contentTimer: number | undefined;
  let destroyed = false;
  const yDocument = new Y.Doc();
  const xmlFragment = yDocument.getXmlFragment('milkdown');
  const publishContent = (content: string) => {
    if (content === currentContent) return;
    currentContent = content;
    options.onContentChange(content);
  };
  const handleXmlChange = () => {
    window.clearTimeout(contentTimer);
    contentTimer = window.setTimeout(() => {
      if (destroyed || crepe === null) return;
      publishContent(crepe.getMarkdown());
    }, 0);
  };
  xmlFragment.observeDeep(handleXmlChange);
  const initialSync = deferred<void>();
  const syncTimeout = window.setTimeout(() => {
    initialSync.reject(
      new Error('The collaboration room did not synchronize in time.'),
    );
  }, 10_000);
  const provider = new HocuspocusProvider({
    url: initialTicket.websocketUrl,
    name: options.documentId,
    document: yDocument,
    token: async () => {
      const ticket = nextTicket ?? (await options.createTicket());
      nextTicket = null;
      if (ticket.stateFormat !== 'milkdown-xml-v1') {
        throw new Error('The collaboration room changed editor format.');
      }
      readOnly = ticket.permission === 'viewer';
      options.onPermissionChange(ticket.permission);
      crepe?.setReadonly(true);
      return ticket.ticket;
    },
    flushDelay: 100,
    onStatus: ({ status }) => {
      options.onTransportChange(status);
      if (status !== WebSocketStatus.Connected) crepe?.setReadonly(true);
    },
    onSynced: ({ state }) => {
      if (!state) return;
      initialSync.resolve();
      crepe?.setReadonly(readOnly);
      options.onTransportChange('synced');
    },
    onAuthenticationFailed: ({ reason }) => {
      const error = new Error(
        reason || 'The collaboration connection was rejected.',
      );
      initialSync.reject(error);
      options.onError(error.message);
    },
    onAwarenessChange: ({ states }) => {
      options.onPresenceChange(states.length);
    },
    onStateless: ({ payload }) => {
      try {
        const value: unknown = JSON.parse(payload);
        const checkpoint = collaborationCheckpointEventSchema.safeParse(value);
        if (checkpoint.success) {
          options.onCheckpoint(checkpoint.data);
          return;
        }
        collaborationRestoreEventSchema.parse(value);
        options.onRestore();
      } catch {
        options.onError('The collaboration server sent an invalid update.');
      }
    },
  });
  provider.setAwarenessField('user', collaborationIdentity());
  options.onPresenceChange(provider.awareness?.getStates().size ?? 1);

  try {
    await initialSync.promise;
    window.clearTimeout(syncTimeout);
    if (destroyed) throw new Error('The editor was closed before it loaded.');

    const renderedEditor = createTeamMdEditor(options.editorHost);
    renderedEditor.setReadonly(readOnly);
    renderedEditor.on((listener) => {
      listener.markdownUpdated((_context, markdown) => {
        publishContent(markdown);
      });
    });
    renderedEditor.editor.use(collab);
    await renderedEditor.create();
    crepe = renderedEditor;
    renderedEditor.editor.action((context) => {
      const awareness = provider.awareness;
      if (awareness === null) {
        throw new Error('Collaboration awareness is unavailable.');
      }
      context
        .get(collabServiceCtx)
        .bindXmlFragment(xmlFragment)
        .setAwareness(awareness)
        .connect();
    });
    renderedEditor.setReadonly(readOnly);
    publishContent(renderedEditor.getMarkdown());
    options.onTransportChange('synced');
  } catch (error) {
    window.clearTimeout(syncTimeout);
    provider.destroy();
    yDocument.destroy();
    throw error;
  }

  return {
    getContent: () => currentContent,
    undo: () => runHistoryShortcut(options.editorHost, 'undo'),
    redo: () => runHistoryShortcut(options.editorHost, 'redo'),
    prepareCheckpoint: async () => {
      if (readOnly) {
        throw new Error('You no longer have permission to save this document.');
      }
      if (!provider.synced) {
        throw new Error('Reconnect before saving this document.');
      }
      provider.flushPendingUpdates();
      if (!provider.hasUnsyncedChanges) return;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          provider.off('unsyncedChanges', handleUnsyncedChanges);
          reject(
            new Error(
              'Your latest edits have not reached the collaboration server yet.',
            ),
          );
        }, 10_000);
        const handleUnsyncedChanges = ({ number }: { number: number }) => {
          if (number !== 0) return;
          window.clearTimeout(timeout);
          provider.off('unsyncedChanges', handleUnsyncedChanges);
          resolve();
        };
        provider.on('unsyncedChanges', handleUnsyncedChanges);
        if (!provider.hasUnsyncedChanges) handleUnsyncedChanges({ number: 0 });
      });
    },
    destroy: () => {
      destroyed = true;
      window.clearTimeout(syncTimeout);
      window.clearTimeout(contentTimer);
      xmlFragment.unobserveDeep(handleXmlChange);
      provider.destroy();
      if (crepe !== null) void crepe.destroy();
      crepe = null;
      yDocument.destroy();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function collaborationIdentity() {
  const colors = [
    ['#a83c32', '#f8d9d4'],
    ['#19705f', '#d3eee8'],
    ['#76561b', '#f3e5bd'],
    ['#315f89', '#d7e8f5'],
  ] as const;
  const index = Math.floor(Math.random() * colors.length);
  const [color, colorLight] = colors[index] ?? colors[0];
  return { name: 'Collaborator', color, colorLight };
}
