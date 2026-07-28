import type {
  DocumentSummaryDto,
  FolderDto,
  WorkspaceTreeResponse,
} from '@mymd/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { DocumentEditor } from '../editor/DocumentEditor.js';
import {
  ApiClientError,
  createDocument,
  createFolder,
  loadTrash,
  loadWorkspaceTree,
  permanentlyDeleteDocument,
  permanentlyDeleteFolder,
  restoreDocument,
  restoreFolder,
  trashDocument,
  trashFolder,
  updateDocument,
  updateFolder,
} from '../../lib/api.js';

type WorkspaceViewProps = {
  view: 'files' | 'trash';
  createDocumentRequest: number;
  onViewChange: (view: 'files' | 'trash') => void;
};

type SelectedItem =
  | { type: 'folder'; item: FolderDto }
  | { type: 'document'; item: DocumentSummaryDto };

type DialogState =
  | { kind: 'create-folder'; parentId: string | null }
  | { kind: 'create-document'; parentId: string | null }
  | { kind: 'rename'; selected: SelectedItem }
  | { kind: 'move'; selected: SelectedItem }
  | { kind: 'delete-permanent'; selected: SelectedItem };

const treeQueryKey = ['workspace', 'tree'] as const;
const trashQueryKey = ['workspace', 'trash'] as const;

export function WorkspaceView({
  view,
  createDocumentRequest,
  onViewChange,
}: WorkspaceViewProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const selectedFolderRef = useRef<string | null>(null);
  selectedFolderRef.current = selectedFolderId(selected);
  const treeQuery = useQuery({
    queryKey: treeQueryKey,
    queryFn: loadWorkspaceTree,
  });
  const trashQuery = useQuery({
    queryKey: trashQueryKey,
    queryFn: loadTrash,
    enabled: view === 'trash',
  });
  const operation = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setNotice(null);
      setDialog(null);
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: treeQueryKey }),
        queryClient.invalidateQueries({ queryKey: trashQueryKey }),
      ]);
    },
    onError: (error) => setNotice(messageFor(error)),
  });

  useEffect(() => {
    if (createDocumentRequest > 0) {
      onViewChange('files');
      setDialog({
        kind: 'create-document',
        parentId: selectedFolderRef.current,
      });
    }
  }, [createDocumentRequest, onViewChange]);

  const openCreate = (kind: 'create-folder' | 'create-document') => {
    setNotice(null);
    setDialog({ kind, parentId: selectedFolderId(selected) });
  };

  if (view === 'trash') {
    return (
      <main className="workspace-main">
        <WorkspaceHeader
          eyebrow="Recovery"
          title="Trash"
          description="Restore items to their original location or remove them permanently."
        />
        {trashQuery.isPending ? (
          <WorkspaceStatus label="Loading trash" />
        ) : trashQuery.isError ? (
          <WorkspaceError
            error={trashQuery.error}
            onRetry={trashQuery.refetch}
          />
        ) : trashQuery.data.items.length === 0 ? (
          <EmptyState
            icon={<Trash2 size={28} strokeWidth={1.5} />}
            title="Trash is empty"
            copy="Items you remove from My files will wait here."
            actionLabel="Return to files"
            onAction={() => onViewChange('files')}
          />
        ) : (
          <section className="trash-list" aria-label="Trashed items">
            {trashQuery.data.items.map((item) => {
              const trashSelection = {
                type: item.type,
                item,
              } as SelectedItem;
              return (
                <article className="trash-row" key={`${item.type}-${item.id}`}>
                  <div className="trash-item-icon" aria-hidden="true">
                    {item.type === 'folder' ? (
                      <Folder size={20} />
                    ) : (
                      <FileText size={20} />
                    )}
                  </div>
                  <div className="trash-copy">
                    <strong>{item.name}</strong>
                    <span>Removed {formatDate(item.trashedAt)}</span>
                  </div>
                  <div className="trash-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        operation.mutate(() =>
                          item.type === 'folder'
                            ? restoreFolder(item.id)
                            : restoreDocument(item.id),
                        )
                      }
                    >
                      <RotateCcw size={16} /> Restore
                    </button>
                    <button
                      className="icon-button danger-icon"
                      type="button"
                      aria-label={`Permanently delete ${item.name}`}
                      title="Delete permanently"
                      onClick={() =>
                        setDialog({
                          kind: 'delete-permanent',
                          selected: trashSelection,
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
        <OperationNotice notice={notice} />
        {dialog?.kind === 'delete-permanent' && (
          <PermanentDeleteDialog
            selected={dialog.selected}
            pending={operation.isPending}
            onCancel={() => setDialog(null)}
            onConfirm={() =>
              operation.mutate(() =>
                dialog.selected.type === 'folder'
                  ? permanentlyDeleteFolder(dialog.selected.item.id)
                  : permanentlyDeleteDocument(dialog.selected.item.id),
              )
            }
          />
        )}
      </main>
    );
  }

  if (openDocumentId !== null) {
    return (
      <DocumentEditor
        documentId={openDocumentId}
        onClose={() => setOpenDocumentId(null)}
      />
    );
  }

  return (
    <main className="workspace-main">
      <WorkspaceHeader
        eyebrow="Workspace"
        title="My files"
        description="Private folders and Markdown documents owned by you."
        actions={
          <>
            <button
              className="secondary-button"
              type="button"
              onClick={() => openCreate('create-folder')}
            >
              <FolderPlus size={17} /> New folder
            </button>
            <button
              className="primary-action compact-action"
              type="button"
              onClick={() => openCreate('create-document')}
            >
              <FilePlus2 size={17} /> New document
            </button>
          </>
        }
      />
      {treeQuery.isPending ? (
        <WorkspaceStatus label="Loading files" />
      ) : treeQuery.isError ? (
        <WorkspaceError error={treeQuery.error} onRetry={treeQuery.refetch} />
      ) : treeQuery.data.folders.length === 0 &&
        treeQuery.data.documents.length === 0 ? (
        <EmptyState
          icon={<FileText size={30} strokeWidth={1.5} />}
          title="A clear page, ready when you are."
          copy="Create your first Markdown document and keep it organized from the start."
          actionLabel="Create document"
          onAction={() => openCreate('create-document')}
        />
      ) : (
        <div className="file-browser">
          <section className="tree-panel" aria-label="File tree">
            <TreeLevel
              tree={treeQuery.data}
              parentId={null}
              depth={0}
              expanded={expanded}
              selected={selected}
              onExpand={(folderId) =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(folderId)) next.delete(folderId);
                  else next.add(folderId);
                  return next;
                })
              }
              onSelect={setSelected}
              onOpenDocument={setOpenDocumentId}
            />
          </section>
          <SelectionPanel
            selected={selected}
            tree={treeQuery.data}
            onCreate={openCreate}
            onRename={() => selected && setDialog({ kind: 'rename', selected })}
            onMove={() => selected && setDialog({ kind: 'move', selected })}
            onOpen={() =>
              selected?.type === 'document' &&
              setOpenDocumentId(selected.item.id)
            }
            onTrash={() => {
              if (!selected) return;
              operation.mutate(() =>
                selected.type === 'folder'
                  ? trashFolder(selected.item.id)
                  : trashDocument(selected.item.id),
              );
            }}
          />
        </div>
      )}
      <OperationNotice notice={notice} />
      {dialog !== null && dialog.kind !== 'delete-permanent' && (
        <ItemDialog
          state={dialog}
          folders={treeQuery.data?.folders ?? []}
          pending={operation.isPending}
          notice={notice}
          onCancel={() => {
            setDialog(null);
            setNotice(null);
          }}
          onSubmit={(action) => operation.mutate(action)}
        />
      )}
    </main>
  );
}

function WorkspaceHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="workspace-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="workspace-actions">{actions}</div>}
    </header>
  );
}

function TreeLevel({
  tree,
  parentId,
  depth,
  expanded,
  selected,
  onExpand,
  onSelect,
  onOpenDocument,
}: {
  tree: WorkspaceTreeResponse;
  parentId: string | null;
  depth: number;
  expanded: Set<string>;
  selected: SelectedItem | null;
  onExpand: (folderId: string) => void;
  onSelect: (item: SelectedItem) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const folders = tree.folders.filter((folder) => folder.parentId === parentId);
  const documents = tree.documents.filter(
    (document) => document.folderId === parentId,
  );
  return (
    <div role={depth === 0 ? 'tree' : 'group'}>
      {folders.map((folder) => {
        const isExpanded = expanded.has(folder.id);
        const hasChildren =
          tree.folders.some((item) => item.parentId === folder.id) ||
          tree.documents.some((item) => item.folderId === folder.id);
        return (
          <div key={folder.id}>
            <div
              className={`tree-row ${selected?.item.id === folder.id ? 'selected' : ''}`}
              style={{ paddingLeft: 10 + depth * 20 }}
              role="treeitem"
              aria-expanded={hasChildren ? isExpanded : undefined}
            >
              <button
                className="tree-toggle"
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${folder.name}`}
                disabled={!hasChildren}
                onClick={() => onExpand(folder.id)}
              >
                {hasChildren &&
                  (isExpanded ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ChevronRight size={15} />
                  ))}
              </button>
              <button
                className="tree-label"
                type="button"
                onDoubleClick={() => hasChildren && onExpand(folder.id)}
                onClick={() => onSelect({ type: 'folder', item: folder })}
              >
                <Folder size={18} /> <span>{folder.name}</span>
              </button>
            </div>
            {isExpanded && (
              <TreeLevel
                tree={tree}
                parentId={folder.id}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onExpand={onExpand}
                onSelect={onSelect}
                onOpenDocument={onOpenDocument}
              />
            )}
          </div>
        );
      })}
      {documents.map((document) => (
        <div
          className={`tree-row ${selected?.item.id === document.id ? 'selected' : ''}`}
          style={{ paddingLeft: 30 + depth * 20 }}
          role="treeitem"
          key={document.id}
        >
          <button
            className="tree-label"
            type="button"
            onDoubleClick={() => onOpenDocument(document.id)}
            onClick={() => onSelect({ type: 'document', item: document })}
          >
            <FileText size={18} /> <span>{document.name}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function SelectionPanel({
  selected,
  tree,
  onCreate,
  onRename,
  onMove,
  onOpen,
  onTrash,
}: {
  selected: SelectedItem | null;
  tree: WorkspaceTreeResponse;
  onCreate: (kind: 'create-folder' | 'create-document') => void;
  onRename: () => void;
  onMove: () => void;
  onOpen: () => void;
  onTrash: () => void;
}) {
  if (selected === null) {
    return (
      <aside className="selection-panel selection-empty">
        <FolderInput size={26} strokeWidth={1.4} />
        <h2>Select an item</h2>
        <p>Choose a folder or document to see its details and actions.</p>
      </aside>
    );
  }
  const parentId =
    selected.type === 'folder'
      ? selected.item.parentId
      : selected.item.folderId;
  const parentName =
    parentId === null
      ? 'My files'
      : (tree.folders.find((folder) => folder.id === parentId)?.name ??
        'Unknown folder');
  return (
    <aside className="selection-panel">
      <div className="selection-icon" aria-hidden="true">
        {selected.type === 'folder' ? (
          <Folder size={24} />
        ) : (
          <FileText size={24} />
        )}
      </div>
      <p className="eyebrow">{selected.type}</p>
      <h2>{selected.item.name}</h2>
      <dl className="item-metadata">
        <div>
          <dt>Location</dt>
          <dd>{parentName}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(selected.item.updatedAt)}</dd>
        </div>
        {selected.type === 'document' && (
          <div>
            <dt>Revision</dt>
            <dd>{selected.item.currentRevision.ordinal}</dd>
          </div>
        )}
      </dl>
      <div className="selection-actions">
        {selected.type === 'folder' && (
          <>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onCreate('create-document')}
            >
              <FilePlus2 size={16} /> New document
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onCreate('create-folder')}
            >
              <FolderPlus size={16} /> New folder
            </button>
          </>
        )}
        {selected.type === 'document' && (
          <button
            className="primary-action compact-action"
            type="button"
            onClick={onOpen}
          >
            <FileText size={16} /> Open editor
          </button>
        )}
        <button className="secondary-button" type="button" onClick={onRename}>
          <Pencil size={16} /> Rename
        </button>
        <button className="secondary-button" type="button" onClick={onMove}>
          <FolderInput size={16} /> Move
        </button>
        <button className="danger-button" type="button" onClick={onTrash}>
          <Trash2 size={16} /> Move to trash
        </button>
      </div>
    </aside>
  );
}

function ItemDialog({
  state,
  folders,
  pending,
  notice,
  onCancel,
  onSubmit,
}: {
  state: Exclude<DialogState, { kind: 'delete-permanent' }>;
  folders: FolderDto[];
  pending: boolean;
  notice: string | null;
  onCancel: () => void;
  onSubmit: (action: () => Promise<unknown>) => void;
}) {
  const selected = 'selected' in state ? state.selected : null;
  const initialName = selected?.item.name ?? '';
  const initialParent =
    state.kind === 'create-folder' || state.kind === 'create-document'
      ? state.parentId
      : state.selected.type === 'folder'
        ? state.selected.item.parentId
        : state.selected.item.folderId;
  const [name, setName] = useState(initialName);
  const [location, setLocation] = useState(initialParent ?? '');
  const isNameDialog = state.kind !== 'move';
  const isLocationDialog = state.kind !== 'rename';
  const title = dialogTitle(state.kind);
  const availableFolders =
    selected?.type === 'folder'
      ? folders.filter(
          (folder) =>
            folder.id !== selected.item.id &&
            !isDescendant(folder.id, selected.item.id, folders),
        )
      : folders;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parentId = location || null;
    if (state.kind === 'create-folder') {
      onSubmit(() => createFolder({ name, parentId }));
    } else if (state.kind === 'create-document') {
      onSubmit(() => createDocument({ name, folderId: parentId }));
    } else if (state.kind === 'rename') {
      onSubmit(() =>
        state.selected.type === 'folder'
          ? updateFolder(state.selected.item.id, { name })
          : updateDocument(state.selected.item.id, { name }),
      );
    } else {
      onSubmit(() =>
        state.selected.type === 'folder'
          ? updateFolder(state.selected.item.id, { parentId })
          : updateDocument(state.selected.item.id, { folderId: parentId }),
      );
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="item-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="Close"
          onClick={onCancel}
        >
          <X size={18} />
        </button>
        <p className="eyebrow">Organize</p>
        <h2 id="dialog-title">{title}</h2>
        <form onSubmit={submit}>
          {isNameDialog && (
            <label className="field-label">
              Name
              <input
                autoFocus
                name="workspace-item-name"
                value={name}
                maxLength={255}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          {isLocationDialog && (
            <label className="field-label">
              Location
              <select
                name="workspace-item-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              >
                <option value="">My files</option>
                {availableFolders.map((folder) => (
                  <option value={folder.id} key={folder.id}>
                    {folderPath(folder, folders)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {notice && <p className="form-error">{notice}</p>}
          <div className="dialog-actions">
            <button className="text-button" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="primary-action compact-action"
              type="submit"
              disabled={pending}
            >
              {pending ? 'Working...' : dialogAction(state.kind)}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PermanentDeleteDialog({
  selected,
  pending,
  onCancel,
  onConfirm,
}: {
  selected: SelectedItem;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="item-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
      >
        <p className="eyebrow danger-text">Permanent action</p>
        <h2 id="delete-title">Delete {selected.item.name}?</h2>
        <p className="dialog-copy">
          This cannot be undone. Documents in a deleted folder and their
          revision history will also be removed.
        </p>
        <div className="dialog-actions">
          <button className="text-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={pending}
            onClick={onConfirm}
          >
            <Trash2 size={16} />{' '}
            {pending ? 'Deleting...' : 'Delete permanently'}
          </button>
        </div>
      </section>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  copy,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className="empty-workspace">
      <div className="empty-document-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{copy}</p>
      <button className="primary-action" type="button" onClick={onAction}>
        <PlusIcon /> {actionLabel}
      </button>
    </section>
  );
}

function PlusIcon() {
  return <FilePlus2 size={18} />;
}

function WorkspaceStatus({ label }: { label: string }) {
  return (
    <div className="workspace-status" role="status">
      <span className="loading-rule" /> {label}
    </div>
  );
}

function WorkspaceError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => unknown;
}) {
  return (
    <div className="workspace-error" role="alert">
      <strong>Unable to load this view.</strong>
      <span>{messageFor(error)}</span>
      <button
        className="secondary-button"
        type="button"
        onClick={() => onRetry()}
      >
        Try again
      </button>
    </div>
  );
}

function OperationNotice({ notice }: { notice: string | null }) {
  return notice ? (
    <div className="workspace-notice" role="alert">
      {notice}
    </div>
  ) : null;
}

function selectedFolderId(selected: SelectedItem | null): string | null {
  if (selected === null) return null;
  return selected.type === 'folder' ? selected.item.id : selected.item.folderId;
}

function folderPath(folder: FolderDto, folders: FolderDto[]): string {
  const path = [folder.name];
  let parentId = folder.parentId;
  const visited = new Set([folder.id]);
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = folders.find((item) => item.id === parentId);
    if (!parent) break;
    path.unshift(parent.name);
    parentId = parent.parentId;
  }
  return path.join(' / ');
}

function isDescendant(
  candidateId: string,
  ancestorId: string,
  folders: FolderDto[],
): boolean {
  let current = folders.find((folder) => folder.id === candidateId);
  const visited = new Set<string>();
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    if (visited.has(current.parentId)) return false;
    visited.add(current.parentId);
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return false;
}

function dialogTitle(
  kind: Exclude<DialogState, { kind: 'delete-permanent' }>['kind'],
): string {
  if (kind === 'create-folder') return 'Create folder';
  if (kind === 'create-document') return 'Create document';
  if (kind === 'rename') return 'Rename item';
  return 'Move item';
}

function dialogAction(
  kind: Exclude<DialogState, { kind: 'delete-permanent' }>['kind'],
): string {
  if (kind === 'create-folder' || kind === 'create-document') return 'Create';
  if (kind === 'rename') return 'Rename';
  return 'Move';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return 'Something went wrong. Try again.';
}
