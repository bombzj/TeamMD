import {
  collaborationCheckpointEventSchema,
  type CollaborationCheckpointEvent,
  type DocumentContentResponse,
} from '@mymd/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Cloud,
  CloudOff,
  Eye,
  Save,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  ApiClientError,
  checkpointCollaboration,
  createCollaborationTicket,
  loadDocument,
} from '../../lib/api.js';
import {
  createCollaborativeEditor,
  type CollaborativeEditor,
  type CollaborationTransport,
} from './collaborative-editor.js';

type DocumentEditorProps = {
  documentId: string;
  onClose: () => void;
};

export function DocumentEditor({ documentId, onClose }: DocumentEditorProps) {
  const queryClient = useQueryClient();
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CollaborativeEditor | null>(null);
  const savedContentRef = useRef('');
  const initialDocumentRef = useRef<DocumentContentResponse | null>(null);
  const initialDocumentIdRef = useRef(documentId);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [revisionOrdinal, setRevisionOrdinal] = useState(0);
  const [transport, setTransport] =
    useState<CollaborationTransport>('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const documentQuery = useQuery({
    queryKey: ['documents', documentId],
    queryFn: () => loadDocument(documentId),
  });

  if (initialDocumentIdRef.current !== documentId) {
    initialDocumentIdRef.current = documentId;
    initialDocumentRef.current = null;
  }
  if (initialDocumentRef.current === null && documentQuery.data !== undefined) {
    initialDocumentRef.current = documentQuery.data;
  }
  const readOnly = documentQuery.data?.permission === 'viewer';

  const applyCheckpoint = (checkpoint: CollaborationCheckpointEvent) => {
    const currentContent = editorRef.current?.getContent() ?? '';
    void contentMatchesHash(currentContent, checkpoint.contentHash).then(
      (matches) => {
        if (!matches) return;
        savedContentRef.current = currentContent;
        setDirty(editorRef.current?.getContent() !== currentContent);
        queryClient.setQueryData<DocumentContentResponse>(
          ['documents', documentId],
          (current) =>
            current === undefined
              ? current
              : {
                  ...current,
                  content: currentContent,
                  currentRevision: {
                    id: checkpoint.id,
                    ordinal: checkpoint.ordinal,
                    createdAt: checkpoint.createdAt,
                  },
                },
        );
      },
    );
    setRevisionOrdinal(checkpoint.ordinal);
    setNotice('Saved');
    queryClient.setQueryData<DocumentContentResponse>(
      ['documents', documentId],
      (current) =>
        current === undefined
          ? current
          : {
              ...current,
              currentRevision: {
                id: checkpoint.id,
                ordinal: checkpoint.ordinal,
                createdAt: checkpoint.createdAt,
              },
            },
    );
    void queryClient.invalidateQueries({ queryKey: ['workspace', 'tree'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const editor = editorRef.current;
      if (editor === null) throw new Error('The editor is not ready.');
      await editor.prepareCheckpoint();
      return checkpointCollaboration(documentId);
    },
    onSuccess: (result) => {
      applyCheckpoint(
        collaborationCheckpointEventSchema.parse({
          type: 'checkpoint',
          ...result.currentRevision,
          contentHash: result.contentHash,
        }),
      );
    },
    onError: (error) => setNotice(messageFor(error)),
  });

  useEffect(() => {
    const initial = initialDocumentRef.current;
    const editorHost = editorHostRef.current;
    const previewHost = previewHostRef.current;
    if (initial === null || editorHost === null || previewHost === null) return;
    let active = true;
    let editor: CollaborativeEditor | null = null;

    savedContentRef.current = initial.content;
    setContent(initial.content);
    setDirty(false);
    setRevisionOrdinal(initial.currentRevision.ordinal);
    setTransport('connecting');
    setNotice(null);

    void createCollaborativeEditor({
      documentId,
      editorHost,
      previewHost,
      readOnly: initial.permission === 'viewer',
      initialContent: initial.content,
      createTicket: () => createCollaborationTicket(documentId),
      onCheckpoint: applyCheckpoint,
      onContentChange: (nextContent) => {
        if (!active) return;
        setContent(nextContent);
        setDirty(nextContent !== savedContentRef.current);
        setNotice(null);
      },
      onError: (message) => {
        if (active) setNotice(message);
      },
      onTransportChange: (nextTransport) => {
        if (!active) return;
        setTransport(nextTransport);
      },
    }).then(
      (createdEditor) => {
        if (!active) {
          createdEditor.destroy();
          return;
        }
        editor = createdEditor;
        editorRef.current = createdEditor;
      },
      (error) => {
        if (active) setNotice(messageFor(error));
      },
    );

    return () => {
      active = false;
      editorRef.current = null;
      editor?.destroy();
    };
  }, [documentId, documentQuery.isSuccess]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (
          dirty &&
          transport === 'synced' &&
          !readOnly &&
          !saveMutation.isPending
        ) {
          saveMutation.mutate();
        }
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [dirty, readOnly, saveMutation, transport]);

  const close = () => {
    if (dirty && !window.confirm('Leave with changes not saved to history?')) {
      return;
    }
    onClose();
  };

  if (documentQuery.isPending) {
    return <EditorStatus label="Loading document" />;
  }
  if (documentQuery.isError) {
    return (
      <EditorStatus
        label={messageFor(documentQuery.error)}
        action={
          <button className="secondary-button" onClick={onClose}>
            Back to files
          </button>
        }
      />
    );
  }

  const canSave =
    dirty && transport === 'synced' && !readOnly && !saveMutation.isPending;

  return (
    <main className="document-editor-shell">
      <header className="editor-heading">
        <div className="editor-title-row">
          <button
            className="icon-button"
            type="button"
            aria-label="Back to files"
            title="Back to files"
            onClick={close}
          >
            <ArrowLeft size={19} />
          </button>
          <div>
            <p className="eyebrow">
              {readOnly
                ? 'Shared document · View only'
                : 'Shared Markdown document'}
            </p>
            <h1>{documentQuery.data.name}</h1>
          </div>
        </div>
        <div className="editor-save-area">
          <TransportState transport={transport} />
          <span className={`save-state ${dirty ? 'dirty' : ''}`}>
            {!dirty && notice === 'Saved' ? <Check size={15} /> : null}
            {saveMutation.isPending
              ? 'Saving...'
              : dirty
                ? 'Not saved to history'
                : `Revision ${revisionOrdinal}`}
          </span>
          {!readOnly && (
            <button
              className="primary-action compact-action"
              type="button"
              disabled={!canSave}
              onClick={() => saveMutation.mutate()}
            >
              <Save size={17} /> {saveMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </header>
      {notice !== null && notice !== 'Saved' && (
        <div className="editor-error" role="alert">
          {notice}
        </div>
      )}
      <section
        className="editor-canvas"
        aria-label="Collaborative Markdown editor"
      >
        <div className="editor-pane">
          <div className="pane-heading">
            <Users size={15} /> Editor
          </div>
          <div ref={editorHostRef} className="codemirror-host" />
        </div>
        <div className="preview-pane">
          <div className="pane-heading">
            <Eye size={15} /> Preview
          </div>
          <div ref={previewHostRef} className="vditor-preview vditor-reset" />
        </div>
      </section>
      <footer className="editor-footer">
        <span>Revision {revisionOrdinal}</span>
        <span>{content.length.toLocaleString()} characters</span>
        <span>
          {readOnly ? 'View only' : dirty ? 'Shared draft' : 'Saved to history'}
        </span>
      </footer>
    </main>
  );
}

function TransportState({ transport }: { transport: CollaborationTransport }) {
  const connected = transport === 'synced' || transport === 'connected';
  const label =
    transport === 'synced'
      ? 'Synced'
      : transport === 'connected'
        ? 'Synchronizing'
        : transport === 'connecting'
          ? 'Connecting'
          : 'Offline';
  return (
    <span className={`transport-state ${connected ? 'connected' : ''}`}>
      {connected ? <Cloud size={15} /> : <CloudOff size={15} />}
      {label}
    </span>
  );
}

function EditorStatus({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="workspace-status" role="status">
      <span className="loading-rule" />
      {label}
      {action}
    </main>
  );
}

async function contentMatchesHash(
  content: string,
  expectedHash: string,
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  const actualHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return actualHash === expectedHash;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The document could not be loaded.';
}
