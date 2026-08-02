import {
  collaborationCheckpointEventSchema,
  type CollaborationCheckpointEvent,
  type CollaboratorRole,
  type DocumentContentResponse,
  type RevisionHistoryItem,
} from '@teammd/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Cloud,
  CloudOff,
  Code2,
  Copy,
  History,
  Link,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  ApiClientError,
  checkpointCollaboration,
  createCollaborationTicket,
  createPublicLink,
  loadCollaborators,
  loadDocument,
  loadPublicLinkStatus,
  loadRevision,
  loadRevisions,
  revokeCollaborator,
  revokePublicLink,
  restoreRevision,
  saveDocument,
  shareDocument,
  updateCollaboratorRole,
} from '../../lib/api.js';
import {
  createCollaborativeEditor,
  type CollaborativeEditor,
  type CollaborationTransport,
} from './collaborative-editor.js';
import { MarkdownPreview } from './MarkdownPreview.js';
import { createStandaloneEditor } from './standalone-editor.js';

type DocumentEditorProps = {
  documentId: string;
  onClose: () => void;
};

export function DocumentEditor({ documentId, onClose }: DocumentEditorProps) {
  const queryClient = useQueryClient();
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CollaborativeEditor | null>(null);
  const restoringEditorRef = useRef(false);
  const savedContentRef = useRef('');
  const standaloneBaseRevisionIdRef = useRef<string | null>(null);
  const initialDocumentRef = useRef<DocumentContentResponse | null>(null);
  const initialDocumentIdRef = useRef(documentId);
  const [content, setContent] = useState('');
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [revisionOrdinal, setRevisionOrdinal] = useState(0);
  const [transport, setTransport] =
    useState<CollaborationTransport>('connecting');
  const [participantCount, setParticipantCount] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(false);
  const [markdownCopied, setMarkdownCopied] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [saveMessageOpen, setSaveMessageOpen] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [permission, setPermission] = useState<
    DocumentContentResponse['permission'] | null
  >(null);
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
  const effectivePermission = permission ?? documentQuery.data?.permission;
  const readOnly = effectivePermission === 'viewer';

  const applyCheckpoint = async (
    checkpoint: CollaborationCheckpointEvent,
    acknowledgedContent?: string,
  ) => {
    const currentContent = editorRef.current?.getContent() ?? '';
    const savedContent = acknowledgedContent ?? currentContent;
    const matches =
      acknowledgedContent !== undefined ||
      (await contentMatchesHash(currentContent, checkpoint.contentHash));
    if (matches) {
      savedContentRef.current = savedContent;
      setDirty(editorRef.current?.getContent() !== savedContent);
      queryClient.setQueryData<DocumentContentResponse>(
        ['documents', documentId],
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                content: savedContent,
                currentRevision: {
                  id: checkpoint.id,
                  ordinal: checkpoint.ordinal,
                  createdAt: checkpoint.createdAt,
                },
              },
      );
    }
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
    await queryClient.invalidateQueries({
      queryKey: ['documents', documentId, 'revisions'],
    });
  };

  const saveMutation = useMutation({
    mutationFn: async (saveMessage?: string) => {
      const editor = editorRef.current;
      if (editor === null) throw new Error('The editor is not ready.');
      if (transport === 'offline') {
        return {
          mode: 'offline' as const,
          result: await saveDocument(documentId, {
            baseRevisionId: standaloneBaseRevisionIdRef.current!,
            content: editor.getContent(),
            ...(saveMessage ? { saveMessage } : {}),
          }),
        };
      }
      await editor.prepareCheckpoint();
      const acknowledgedContent = editor.getContent();
      return {
        mode: 'collaborative' as const,
        result: await checkpointCollaboration(documentId, saveMessage),
        acknowledgedContent,
      };
    },
    onSuccess: async (saveResult) => {
      if (saveResult.mode === 'offline') {
        const currentContent = editorRef.current?.getContent() ?? '';
        savedContentRef.current = currentContent;
        setContent(currentContent);
        setDirty(false);
        standaloneBaseRevisionIdRef.current =
          saveResult.result.currentRevision.id;
        setRevisionOrdinal(saveResult.result.currentRevision.ordinal);
        setNotice('Saved');
        queryClient.setQueryData<DocumentContentResponse>(
          ['documents', documentId],
          (current) =>
            current === undefined
              ? current
              : {
                  ...current,
                  content: currentContent,
                  currentRevision: saveResult.result.currentRevision,
                },
        );
        void queryClient.invalidateQueries({ queryKey: ['workspace', 'tree'] });
        await queryClient.invalidateQueries({
          queryKey: ['documents', documentId, 'revisions'],
        });
        return;
      }
      await applyCheckpoint(
        collaborationCheckpointEventSchema.parse({
          type: 'checkpoint',
          ...saveResult.result.currentRevision,
          contentHash: saveResult.result.contentHash,
        }),
        saveResult.acknowledgedContent,
      );
    },
    onError: (error) => setNotice(messageFor(error)),
  });

  useEffect(() => {
    const initial = initialDocumentRef.current;
    const editorHost = editorHostRef.current;
    if (initial === null || editorHost === null) return;
    let active = true;
    let editor: CollaborativeEditor | null = null;
    let receivedAuthoritativeContent = false;

    savedContentRef.current = initial.content;
    setContent(initial.content);
    setDirty(false);
    setRevisionOrdinal(initial.currentRevision.ordinal);
    setPermission(initial.permission);
    setTransport('connecting');
    setParticipantCount(1);
    setNotice(null);

    void createCollaborativeEditor({
      documentId,
      editorHost,
      createTicket: () => createCollaborationTicket(documentId),
      onCheckpoint: (checkpoint) => void applyCheckpoint(checkpoint),
      onRestore: () => {
        if (!active) return;
        restoringEditorRef.current = true;
        initialDocumentRef.current = null;
        void loadDocument(documentId)
          .then((restoredDocument) => {
            if (!active) return;
            queryClient.setQueryData(
              ['documents', documentId],
              restoredDocument,
            );
            setEditorGeneration((current) => current + 1);
          })
          .catch((error: unknown) => {
            if (active) setNotice(messageFor(error));
          });
      },
      onContentChange: (nextContent) => {
        if (!active) return;
        setContent(nextContent);
        if (!receivedAuthoritativeContent || restoringEditorRef.current) {
          receivedAuthoritativeContent = true;
          restoringEditorRef.current = false;
          savedContentRef.current = nextContent;
          setDirty(false);
          setNotice('Saved');
          return;
        }
        setDirty(nextContent !== savedContentRef.current);
        setNotice(null);
      },
      onError: (message) => {
        if (active) setNotice(message);
      },
      onPermissionChange: (nextPermission) => {
        if (!active) return;
        setPermission(nextPermission);
        queryClient.setQueryData<DocumentContentResponse>(
          ['documents', documentId],
          (current) =>
            current === undefined
              ? current
              : { ...current, permission: nextPermission },
        );
      },
      onPresenceChange: (nextParticipantCount) => {
        if (active) setParticipantCount(Math.max(1, nextParticipantCount));
      },
      onTransportChange: (nextTransport) => {
        if (!active) return;
        setTransport(nextTransport);
      },
    }).then(
      (createdEditor) => {
        if (!active) {
          void createdEditor.destroy();
          return;
        }
        editor = createdEditor;
        editorRef.current = createdEditor;
      },
      (error) => {
        if (!active) return;
        void createStandaloneEditor({
          content: initial.content,
          editorHost,
          readOnly: initial.permission === 'viewer',
          onContentChange: (nextContent) => {
            if (!active) return;
            setContent(nextContent);
            setDirty(nextContent !== savedContentRef.current);
            setNotice(null);
          },
        }).then(
          (standaloneEditor) => {
            if (!active) {
              void standaloneEditor.destroy();
              return;
            }
            editor = standaloneEditor;
            editorRef.current = standaloneEditor;
            standaloneBaseRevisionIdRef.current = initial.currentRevision.id;
            setTransport('offline');
            setParticipantCount(1);
            setNotice(
              'Collaboration unavailable. Editing saved revisions only.',
            );
          },
          (standaloneError) => {
            if (active) setNotice(messageFor(standaloneError ?? error));
          },
        );
      },
    );

    return () => {
      active = false;
      editorRef.current = null;
      if (editor !== null) void editor.destroy();
    };
  }, [documentId, documentQuery.isSuccess, editorGeneration]);

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
          (transport === 'synced' || transport === 'offline') &&
          !readOnly &&
          !saveMutation.isPending
        ) {
          saveMutation.mutate(undefined);
        }
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [dirty, readOnly, saveMutation, transport]);

  useEffect(() => {
    if (!fullScreen) return;
    document.body.classList.add('editor-full-screen-open');
    const exitFullScreen = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullScreen(false);
    };
    window.addEventListener('keydown', exitFullScreen);
    return () => {
      document.body.classList.remove('editor-full-screen-open');
      window.removeEventListener('keydown', exitFullScreen);
    };
  }, [fullScreen]);

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
    dirty &&
    (transport === 'synced' || transport === 'offline') &&
    !readOnly &&
    !saveMutation.isPending;

  const copyMarkdown = async () => {
    const markdown = editorRef.current?.getContent() ?? content;
    try {
      await navigator.clipboard.writeText(markdown);
      setMarkdownCopied(true);
      window.setTimeout(() => setMarkdownCopied(false), 1_500);
    } catch {
      setNotice('Could not copy Markdown.');
    }
  };

  return (
    <main
      className={`document-editor-shell${fullScreen ? ' full-screen' : ''}`}
    >
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
            {readOnly ? (
              <p className="eyebrow">Shared document · View only</p>
            ) : null}
            <h1>{documentQuery.data.name}</h1>
          </div>
        </div>
        <div className="editor-save-area">
          <TransportState transport={transport} />
          <PresenceState participantCount={participantCount} />
          <span className={`save-state ${dirty ? 'dirty' : ''}`}>
            {!dirty && notice === 'Saved' ? <Check size={15} /> : null}
            {saveMutation.isPending
              ? 'Saving...'
              : dirty
                ? 'Not saved to history'
                : `Revision ${revisionOrdinal}`}
          </span>
          <button
            className="icon-button editor-full-screen-button"
            type="button"
            aria-label={fullScreen ? 'Exit full screen' : 'Enter full screen'}
            aria-pressed={fullScreen}
            title={fullScreen ? 'Exit full screen (Esc)' : 'Enter full screen'}
            onClick={() => setFullScreen((current) => !current)}
          >
            {fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={
              sourceVisible ? 'Show rendered editor' : 'Show Markdown source'
            }
            aria-pressed={sourceVisible}
            title={
              sourceVisible ? 'Show rendered editor' : 'Show Markdown source'
            }
            onClick={() => setSourceVisible((current) => !current)}
          >
            <Code2 size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Copy Markdown"
            title={markdownCopied ? 'Markdown copied' : 'Copy Markdown'}
            onClick={() => void copyMarkdown()}
          >
            {markdownCopied ? <Check size={18} /> : <Copy size={18} />}
          </button>
          {!readOnly && (
            <div className="editor-history-controls" aria-label="Edit history">
              <button
                className="icon-button"
                type="button"
                aria-label="Undo"
                title="Undo (Ctrl/Cmd+Z)"
                onClick={() => editorRef.current?.undo()}
              >
                <Undo2 size={18} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Redo"
                title="Redo (Ctrl/Cmd+Shift+Z)"
                onClick={() => editorRef.current?.redo()}
              >
                <Redo2 size={18} />
              </button>
            </div>
          )}
          {!readOnly && (
            <div className="save-button-group">
              <button
                className="primary-action compact-action"
                type="button"
                disabled={!canSave}
                onClick={() => saveMutation.mutate(undefined)}
              >
                <Save size={17} />
                {saveMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                className="primary-action save-message-button"
                type="button"
                disabled={!canSave}
                aria-label="Save with checkpoint message"
                title="Save with checkpoint message"
                onClick={() => setSaveMessageOpen(true)}
              >
                <MessageSquarePlus size={17} />
              </button>
            </div>
          )}
          {!readOnly && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setHistoryOpen(true)}
            >
              <History size={17} /> History
            </button>
          )}
          {effectivePermission === 'owner' && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSharingOpen(true)}
            >
              <Users size={17} /> Share
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
        hidden={sourceVisible}
      >
        <div ref={editorHostRef} className="milkdown-host" />
      </section>
      {sourceVisible && (
        <section className="editor-source" aria-label="Markdown source">
          <div className="editor-source-heading">
            <span>Markdown source</span>
            <span>Read only</span>
          </div>
          <pre>
            <code>{content}</code>
          </pre>
        </section>
      )}
      <footer className="editor-footer">
        <span>Revision {revisionOrdinal}</span>
        <span>{content.length.toLocaleString()} characters</span>
        <span>
          {readOnly ? 'View only' : dirty ? 'Shared draft' : 'Saved to history'}
        </span>
      </footer>
      {sharingOpen && (
        <SharingDialog
          documentId={documentId}
          documentName={documentQuery.data.name}
          onClose={() => setSharingOpen(false)}
        />
      )}
      {saveMessageOpen && (
        <SaveMessageDialog
          pending={saveMutation.isPending}
          onClose={() => setSaveMessageOpen(false)}
          onSave={(saveMessage) => {
            setSaveMessageOpen(false);
            saveMutation.mutate(saveMessage);
          }}
        />
      )}
      {historyOpen && (
        <HistoryDialog
          documentId={documentId}
          documentName={documentQuery.data.name}
          currentRevisionId={documentQuery.data.currentRevision.id}
          canRestore={!dirty && transport === 'synced'}
          onClose={() => setHistoryOpen(false)}
          onRestored={(checkpoint) => {
            void applyCheckpoint(
              collaborationCheckpointEventSchema.parse({
                type: 'checkpoint',
                ...checkpoint.currentRevision,
                contentHash: checkpoint.contentHash,
              }),
            );
            setHistoryOpen(false);
          }}
        />
      )}
    </main>
  );
}

function SaveMessageDialog({
  pending,
  onClose,
  onSave,
}: {
  pending: boolean;
  onClose: () => void;
  onSave: (saveMessage: string) => void;
}) {
  const [saveMessage, setSaveMessage] = useState('');
  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        className="item-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-message-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(saveMessage.trim());
        }}
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="Close checkpoint message"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <p className="eyebrow">Revision note</p>
        <h2 id="save-message-title">Describe this checkpoint</h2>
        <label className="field-label">
          Checkpoint message
          <input
            autoFocus
            required
            maxLength={500}
            value={saveMessage}
            onChange={(event) => setSaveMessage(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-action compact-action"
            type="submit"
            disabled={pending || saveMessage.trim().length === 0}
          >
            <Save size={17} /> Save checkpoint
          </button>
        </div>
      </form>
    </div>
  );
}

function HistoryDialog({
  documentId,
  documentName,
  currentRevisionId,
  canRestore,
  onClose,
  onRestored,
}: {
  documentId: string;
  documentName: string;
  currentRevisionId: string;
  canRestore: boolean;
  onClose: () => void;
  onRestored: (result: Awaited<ReturnType<typeof restoreRevision>>) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedRevision, setSelectedRevision] =
    useState<RevisionHistoryItem | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const revisionsQuery = useQuery({
    queryKey: ['documents', documentId, 'revisions'],
    queryFn: () => loadRevisions(documentId),
  });
  const revisionQuery = useQuery({
    queryKey: ['documents', documentId, 'revisions', selectedRevision?.id],
    queryFn: () => loadRevision(documentId, selectedRevision!.id),
    enabled: selectedRevision !== null,
  });
  const restoreMutation = useMutation({
    mutationFn: () =>
      restoreRevision(documentId, selectedRevision!.id, {
        baseRevisionId: currentRevisionId,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['documents', documentId, 'revisions'],
      });
      onRestored(result);
    },
    onError: (error) => {
      setConfirmingRestore(false);
      setNotice(messageFor(error));
    },
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="item-dialog history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="Close history"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <p className="eyebrow">Immutable checkpoints</p>
        <h2 id="history-title">History for {documentName}</h2>
        <div className="history-layout">
          <div className="revision-list" aria-label="Revision history">
            {revisionsQuery.isPending ? (
              <p className="sharing-status">Loading history...</p>
            ) : revisionsQuery.isError ? (
              <p className="form-error">{messageFor(revisionsQuery.error)}</p>
            ) : (
              revisionsQuery.data.revisions.map((revision) => (
                <button
                  className={`revision-row ${selectedRevision?.id === revision.id ? 'active' : ''}`}
                  type="button"
                  key={revision.id}
                  aria-label={`Revision ${revision.ordinal}, ${revision.saveMessage ?? 'No message'}`}
                  onClick={() => {
                    setSelectedRevision(revision);
                    setConfirmingRestore(false);
                    setNotice(null);
                  }}
                >
                  <strong>Revision {revision.ordinal}</strong>
                  <span>{revision.saveMessage ?? 'No message'}</span>
                  <small>
                    {revision.author.email} ·{' '}
                    {formatRevisionDate(revision.createdAt)}
                  </small>
                </button>
              ))
            )}
          </div>
          <div className="revision-preview">
            {selectedRevision === null ? (
              <p className="history-empty">Select a revision to inspect it.</p>
            ) : revisionQuery.isPending ? (
              <p className="history-empty">Loading revision...</p>
            ) : revisionQuery.isError ? (
              <p className="form-error">{messageFor(revisionQuery.error)}</p>
            ) : (
              <>
                <MarkdownPreview content={revisionQuery.data.content} />
                {selectedRevision.id !== currentRevisionId && (
                  <div className="history-actions">
                    {confirmingRestore ? (
                      <>
                        <span>This creates a new revision.</span>
                        <button
                          className="primary-action compact-action"
                          type="button"
                          disabled={restoreMutation.isPending}
                          onClick={() => restoreMutation.mutate()}
                        >
                          <RotateCcw size={16} /> Restore as new revision
                        </button>
                      </>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={!canRestore}
                        title={
                          canRestore
                            ? undefined
                            : 'Save or discard the shared draft and reconnect before restoring.'
                        }
                        onClick={() => setConfirmingRestore(true)}
                      >
                        <RotateCcw size={16} /> Restore revision{' '}
                        {selectedRevision.ordinal}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {notice && <p className="form-error">{notice}</p>}
      </section>
    </div>
  );
}

function SharingDialog({
  documentId,
  documentName,
  onClose,
}: {
  documentId: string;
  documentName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CollaboratorRole>('editor');
  const [notice, setNotice] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const collaboratorsQuery = useQuery({
    queryKey: ['documents', documentId, 'collaborators'],
    queryFn: () => loadCollaborators(documentId),
  });
  const publicLinkQuery = useQuery({
    queryKey: ['documents', documentId, 'public-link'],
    queryFn: () => loadPublicLinkStatus(documentId),
  });
  const refresh = async () => {
    setNotice(null);
    await queryClient.invalidateQueries({
      queryKey: ['documents', documentId, 'collaborators'],
    });
  };
  const grantMutation = useMutation({
    mutationFn: () => shareDocument(documentId, { email, role }),
    onSuccess: async () => {
      setEmail('');
      await refresh();
    },
    onError: (error) => setNotice(messageFor(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      collaboratorId,
      nextRole,
    }: {
      collaboratorId: string;
      nextRole: CollaboratorRole;
    }) => updateCollaboratorRole(documentId, collaboratorId, nextRole),
    onSuccess: refresh,
    onError: (error) => setNotice(messageFor(error)),
  });
  const revokeMutation = useMutation({
    mutationFn: (collaboratorId: string) =>
      revokeCollaborator(documentId, collaboratorId),
    onSuccess: refresh,
    onError: (error) => setNotice(messageFor(error)),
  });
  const createPublicLinkMutation = useMutation({
    mutationFn: () => createPublicLink(documentId),
    onSuccess: async (result) => {
      setPublicUrl(
        `${window.location.origin}/public#token=${encodeURIComponent(result.token)}`,
      );
      setNotice(null);
      await queryClient.invalidateQueries({
        queryKey: ['documents', documentId, 'public-link'],
      });
    },
    onError: (error) => setNotice(messageFor(error)),
  });
  const revokePublicLinkMutation = useMutation({
    mutationFn: () => revokePublicLink(documentId),
    onSuccess: async () => {
      setPublicUrl(null);
      setNotice(null);
      await queryClient.invalidateQueries({
        queryKey: ['documents', documentId, 'public-link'],
      });
    },
    onError: (error) => setNotice(messageFor(error)),
  });
  const pending =
    grantMutation.isPending ||
    updateMutation.isPending ||
    revokeMutation.isPending ||
    createPublicLinkMutation.isPending ||
    revokePublicLinkMutation.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    grantMutation.mutate();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="item-dialog sharing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sharing-dialog-title"
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="Close sharing"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <p className="eyebrow">Access</p>
        <h2 id="sharing-dialog-title">Share {documentName}</h2>
        <form className="sharing-form" onSubmit={submit}>
          <label className="field-label sharing-email">
            Registered email
            <input
              autoFocus
              type="email"
              value={email}
              maxLength={320}
              required
              placeholder="collaborator@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field-label sharing-role">
            Role
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as CollaboratorRole)
              }
            >
              <option value="editor">Can edit</option>
              <option value="viewer">View only</option>
            </select>
          </label>
          <button
            className="primary-action compact-action sharing-submit"
            type="submit"
            aria-label="Share document"
            disabled={pending}
          >
            <Users size={16} /> Share
          </button>
        </form>
        <p className="sharing-hint">
          The person must already have a TeamMD account with this email.
        </p>
        {notice && (
          <p className="form-error" role="alert">
            {notice}
          </p>
        )}
        <div className="collaborator-list" aria-label="People with access">
          {collaboratorsQuery.isPending ? (
            <p className="sharing-status">Loading people with access...</p>
          ) : collaboratorsQuery.isError ? (
            <p className="form-error">{messageFor(collaboratorsQuery.error)}</p>
          ) : collaboratorsQuery.data.collaborators.length === 0 ? (
            <p className="sharing-status">Only you have access.</p>
          ) : (
            collaboratorsQuery.data.collaborators.map((collaborator) => (
              <div className="collaborator-row" key={collaborator.userId}>
                <div className="collaborator-copy">
                  <strong>{collaborator.email}</strong>
                  <span>Added {formatSharingDate(collaborator.createdAt)}</span>
                </div>
                <select
                  aria-label={`Role for ${collaborator.email}`}
                  value={collaborator.role}
                  disabled={pending}
                  onChange={(event) =>
                    updateMutation.mutate({
                      collaboratorId: collaborator.userId,
                      nextRole: event.target.value as CollaboratorRole,
                    })
                  }
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">View only</option>
                </select>
                <button
                  className="icon-button danger-icon"
                  type="button"
                  disabled={pending}
                  aria-label={`Remove ${collaborator.email}`}
                  title="Remove access"
                  onClick={() => revokeMutation.mutate(collaborator.userId)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))
          )}
        </div>
        <section
          className="public-link-section"
          aria-labelledby="public-link-title"
        >
          <div>
            <p className="eyebrow">Read-only access</p>
            <h3 id="public-link-title">Public link</h3>
          </div>
          {publicLinkQuery.isPending ? (
            <p className="sharing-status">Loading public-link status...</p>
          ) : publicLinkQuery.isError ? (
            <p className="form-error">{messageFor(publicLinkQuery.error)}</p>
          ) : publicLinkQuery.data.enabled ? (
            <>
              <p className="sharing-hint">
                Anyone with the link can read the current saved revision.
                Drafts, history, collaborators, and folder details stay private.
              </p>
              {publicUrl === null ? (
                <p className="sharing-status">
                  The existing secret link cannot be displayed again. Create a
                  new one to rotate it.
                </p>
              ) : (
                <div className="public-link-copy">
                  <input aria-label="Public link" readOnly value={publicUrl} />
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Copy public link"
                    title="Copy public link"
                    onClick={() =>
                      void navigator.clipboard?.writeText(publicUrl)
                    }
                  >
                    <Copy size={17} />
                  </button>
                </div>
              )}
              <div className="public-link-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => createPublicLinkMutation.mutate()}
                >
                  <Link size={16} /> Create new link
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={pending}
                  onClick={() => revokePublicLinkMutation.mutate()}
                >
                  <Trash2 size={16} /> Revoke public link
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="sharing-status">Public link is off.</p>
              <button
                className="secondary-button public-link-create"
                type="button"
                disabled={pending}
                onClick={() => createPublicLinkMutation.mutate()}
              >
                <Link size={16} /> Create public link
              </button>
            </>
          )}
        </section>
      </section>
    </div>
  );
}

function TransportState({ transport }: { transport: CollaborationTransport }) {
  const connected = transport === 'synced' || transport === 'connected';
  const label =
    transport === 'synced'
      ? 'Synced'
      : transport === 'offline'
        ? 'Collaboration off'
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

function PresenceState({ participantCount }: { participantCount: number }) {
  return (
    <span
      className="presence-state"
      aria-label={`${participantCount} ${participantCount === 1 ? 'person' : 'people'} in this document`}
    >
      <Users size={15} />
      {participantCount === 1 ? 'Only you' : `${participantCount} here`}
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

function formatSharingDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

function formatRevisionDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
