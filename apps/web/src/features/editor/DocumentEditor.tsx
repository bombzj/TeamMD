import type { DocumentContentResponse } from '@mymd/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type Vditor from 'vditor';

import { ApiClientError, loadDocument, saveDocument } from '../../lib/api.js';

type DocumentEditorProps = {
  documentId: string;
  onClose: () => void;
};

export function DocumentEditor({ documentId, onClose }: DocumentEditorProps) {
  const queryClient = useQueryClient();
  const editorRef = useRef<Vditor | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const baseRevisionIdRef = useRef('');
  const savedContentRef = useRef('');
  const initialDocumentRef = useRef<DocumentContentResponse | null>(null);
  const initialDocumentIdRef = useRef(documentId);
  const [dirty, setDirty] = useState(false);
  const [revisionOrdinal, setRevisionOrdinal] = useState(0);
  const [conflict, setConflict] = useState(false);
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
  const saveMutation = useMutation({
    mutationFn: async () => {
      const editor = editorRef.current;
      if (editor === null) throw new Error('The editor is not ready.');
      return saveDocument(documentId, {
        baseRevisionId: baseRevisionIdRef.current,
        content: editor.getValue(),
      });
    },
    onSuccess: async (result) => {
      const content = editorRef.current?.getValue() ?? savedContentRef.current;
      baseRevisionIdRef.current = result.currentRevision.id;
      savedContentRef.current = content;
      setRevisionOrdinal(result.currentRevision.ordinal);
      setDirty(false);
      setConflict(false);
      setNotice('Saved');
      queryClient.setQueryData<DocumentContentResponse>(
        ['documents', documentId],
        (current) =>
          current === undefined
            ? current
            : { ...current, content, currentRevision: result.currentRevision },
      );
      await queryClient.invalidateQueries({ queryKey: ['workspace', 'tree'] });
    },
    onError: (error) => {
      if (
        error instanceof ApiClientError &&
        error.code === 'REVISION_CONFLICT'
      ) {
        setConflict(true);
        setNotice(null);
        return;
      }
      setNotice(messageFor(error));
    },
  });

  useEffect(() => {
    const initial = initialDocumentRef.current;
    if (initial === null || hostRef.current === null) return;
    let active = true;
    let editor: Vditor | null = null;
    baseRevisionIdRef.current = initial.currentRevision.id;
    savedContentRef.current = initial.content;
    setRevisionOrdinal(initial.currentRevision.ordinal);

    void import('vditor').then(({ default: VditorConstructor }) => {
      if (!active || hostRef.current === null) return;
      editor = new VditorConstructor(hostRef.current, {
        value: initial.content,
        cdn: '/vditor',
        cache: { enable: false },
        lang: 'en_US',
        mode: 'ir',
        minHeight: 420,
        placeholder: 'Start writing in Markdown...',
        toolbar: [
          'headings',
          'bold',
          'italic',
          'strike',
          'link',
          '|',
          'list',
          'ordered-list',
          'check',
          'quote',
          'code',
          'inline-code',
          'table',
          '|',
          'undo',
          'redo',
          '|',
          'preview',
          'fullscreen',
        ],
        preview: {
          markdown: { sanitize: true },
          theme: { current: 'light' },
        },
        input: (value) => {
          setDirty(value !== savedContentRef.current);
          setNotice(null);
        },
        after: () => {
          if (editor !== null) editorRef.current = editor;
        },
      });
    });

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
        if (dirty && !saveMutation.isPending) saveMutation.mutate();
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [dirty, saveMutation]);

  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };

  const reloadServerVersion = async () => {
    const latest = await loadDocument(documentId);
    editorRef.current?.setValue(latest.content, true);
    queryClient.setQueryData(['documents', documentId], latest);
    baseRevisionIdRef.current = latest.currentRevision.id;
    savedContentRef.current = latest.content;
    setRevisionOrdinal(latest.currentRevision.ordinal);
    setDirty(false);
    setConflict(false);
    setNotice('Server version loaded');
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
            <p className="eyebrow">Markdown document</p>
            <h1>{documentQuery.data.name}</h1>
          </div>
        </div>
        <div className="editor-save-area">
          <span className={`save-state ${dirty ? 'dirty' : ''}`}>
            {notice === 'Saved' ? <Check size={15} /> : null}
            {notice ??
              (dirty ? 'Unsaved changes' : `Revision ${revisionOrdinal}`)}
          </span>
          <button
            className="primary-action compact-action"
            type="button"
            disabled={
              !dirty || saveMutation.isPending || editorRef.current === null
            }
            onClick={() => saveMutation.mutate()}
          >
            <Save size={17} /> {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </header>
      {conflict && (
        <section className="revision-conflict" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>A newer revision is already saved.</strong>
            <p>
              Your local draft is still here. Reload the server version to
              continue from the latest revision.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void reloadServerVersion()}
          >
            Reload server version
          </button>
        </section>
      )}
      {notice !== null &&
        notice !== 'Saved' &&
        notice !== 'Server version loaded' && (
          <div className="editor-error" role="alert">
            {notice}
          </div>
        )}
      <section className="editor-canvas" aria-label="Markdown editor">
        <div ref={hostRef} />
      </section>
      <footer className="editor-footer">
        <span>Revision {revisionOrdinal}</span>
        <span>{dirty ? 'Local draft' : 'Saved to history'}</span>
      </footer>
    </main>
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

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return 'The document could not be loaded.';
}
