import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  collaborationCheckpointEventSchema,
  type CollaborationCheckpointEvent,
  type CollaborationTicketResponse,
} from '@mymd/contracts';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import Vditor from 'vditor';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';

export type CollaborationTransport = `${WebSocketStatus}` | 'synced';

type CollaborativeEditorOptions = {
  documentId: string;
  editorHost: HTMLElement;
  previewHost: HTMLDivElement;
  readOnly: boolean;
  initialContent: string;
  createTicket: () => Promise<CollaborationTicketResponse>;
  onCheckpoint: (checkpoint: CollaborationCheckpointEvent) => void;
  onContentChange: (content: string) => void;
  onError: (message: string) => void;
  onTransportChange: (transport: CollaborationTransport) => void;
};

export type CollaborativeEditor = {
  destroy: () => void;
  getContent: () => string;
  prepareCheckpoint: () => Promise<void>;
};

export async function createCollaborativeEditor(
  options: CollaborativeEditorOptions,
): Promise<CollaborativeEditor> {
  const initialTicket = await options.createTicket();
  let nextTicket: CollaborationTicketResponse | null = initialTicket;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const yDocument = new Y.Doc();
  const yText = yDocument.getText('content');
  const editing = new Compartment();
  let view: EditorView | null = null;
  const provider = new HocuspocusProvider({
    url: initialTicket.websocketUrl,
    name: options.documentId,
    document: yDocument,
    token: async () => {
      const ticket = nextTicket ?? (await options.createTicket());
      nextTicket = null;
      return ticket.ticket;
    },
    flushDelay: 100,
    onStatus: ({ status }) => {
      options.onTransportChange(status);
      if (status !== WebSocketStatus.Connected && view !== null) {
        view.dispatch({
          effects: editing.reconfigure(editingExtensions(true)),
        });
      }
    },
    onSynced: ({ state }) => {
      if (!state) return;
      view?.dispatch({
        effects: editing.reconfigure(editingExtensions(options.readOnly)),
      });
      options.onTransportChange('synced');
      options.onContentChange(yText.toJSON());
    },
    onAuthenticationFailed: ({ reason }) => {
      options.onError(reason || 'The collaboration connection was rejected.');
    },
    onStateless: ({ payload }) => {
      try {
        const checkpoint = collaborationCheckpointEventSchema.parse(
          JSON.parse(payload),
        );
        options.onCheckpoint(checkpoint);
      } catch {
        options.onError('The collaboration server sent an invalid update.');
      }
    },
  });
  provider.setAwarenessField('user', collaborationIdentity());

  const undoManager = options.readOnly ? false : new Y.UndoManager(yText);
  const state = EditorState.create({
    doc: yText.toJSON(),
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      markdown(),
      keymap.of([...defaultKeymap, ...yUndoManagerKeymap, indentWithTab]),
      EditorView.lineWrapping,
      editing.of(editingExtensions(true)),
      yCollab(yText, provider.awareness, { undoManager }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ],
  });
  view = new EditorView({ state, parent: options.editorHost });

  const renderPreview = (content: string) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (destroyed) return;
      void Vditor.preview(options.previewHost, content, {
        cdn: '/vditor',
        mode: 'light',
        markdown: { sanitize: true },
      });
    }, 180);
  };
  const contentChanged = () => {
    const content = yText.toJSON();
    options.onContentChange(content);
    renderPreview(content);
  };
  yText.observe(contentChanged);
  renderPreview(options.initialContent);

  return {
    getContent: () => yText.toJSON(),
    prepareCheckpoint: async () => {
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
      clearTimeout(previewTimer);
      yText.unobserve(contentChanged);
      view?.destroy();
      view = null;
      provider.destroy();
      yDocument.destroy();
    },
  };
}

function editingExtensions(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
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
