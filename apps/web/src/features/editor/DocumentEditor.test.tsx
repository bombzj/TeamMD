import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

type MockBlackboard = {
  id: string;
  name: string;
  order: number;
  backgroundMarkdown: string;
  backgroundHash: string;
  strokes: [];
};

const collaboration = vi.hoisted(() => ({
  blackboards: [] as MockBlackboard[],
  content: '',
  creationCount: 0,
  creationError: null as Error | null,
  initialContent: null as string | null,
  options: null as null | {
    onContentChange: (content: string) => void;
    onBlackboardsChange: (blackboards: MockBlackboard[]) => void;
    onRestore: () => void;
    onPermissionChange: (permission: 'owner' | 'editor' | 'viewer') => void;
    onPresenceChange: (participantCount: number) => void;
    onTransportChange: (transport: 'synced') => void;
  },
  prepareCheckpoint: vi.fn().mockResolvedValue(undefined),
  redoBlackboard: vi.fn().mockReturnValue(true),
  reorderBlackboard: vi.fn(),
  redo: vi.fn().mockReturnValue(true),
  undoBlackboard: vi.fn().mockReturnValue(true),
  undo: vi.fn().mockReturnValue(true),
}));

type MockEditorOptions = {
  onContentChange: (content: string) => void;
  onBlackboardsChange: (blackboards: MockBlackboard[]) => void;
  onRestore: () => void;
  onPermissionChange: (permission: 'owner' | 'editor' | 'viewer') => void;
  onPresenceChange: (participantCount: number) => void;
  onTransportChange: (transport: 'synced') => void;
};

vi.mock('./collaborative-editor.js', () => ({
  createCollaborativeEditor: vi.fn((options: MockEditorOptions) => {
    if (collaboration.creationError !== null) {
      return Promise.reject(collaboration.creationError);
    }
    collaboration.creationCount += 1;
    if (collaboration.content.length === 0) {
      collaboration.content =
        collaboration.initialContent ?? documentResponse.content;
    }
    collaboration.options = options;
    options.onTransportChange('synced');
    options.onBlackboardsChange(collaboration.blackboards);
    options.onContentChange(collaboration.content);
    return Promise.resolve({
      destroy: vi.fn(),
      getContent: () => collaboration.content,
      getBlackboards: () => collaboration.blackboards,
      createBlackboard: (name: string, backgroundMarkdown: string) => {
        const id = crypto.randomUUID();
        collaboration.blackboards = [
          ...collaboration.blackboards,
          {
            id,
            name,
            order: collaboration.blackboards.length,
            backgroundMarkdown,
            backgroundHash: sha256(backgroundMarkdown),
            strokes: [],
          },
        ];
        options.onBlackboardsChange(collaboration.blackboards);
        return Promise.resolve(id);
      },
      renameBlackboard: vi.fn(),
      deleteBlackboard: vi.fn(),
      clearBlackboard: vi.fn(),
      addBlackboardStroke: vi.fn(),
      deleteBlackboardStroke: vi.fn(),
      deleteBlackboardStrokes: vi.fn(),
      moveBlackboardStroke: vi.fn(),
      moveBlackboardStrokes: vi.fn(),
      reorderBlackboard: collaboration.reorderBlackboard,
      undoBlackboard: collaboration.undoBlackboard,
      redoBlackboard: collaboration.redoBlackboard,
      prepareCheckpoint: collaboration.prepareCheckpoint,
      redo: collaboration.redo,
      undo: collaboration.undo,
    });
  }),
}));

vi.mock('./standalone-editor.js', () => ({
  createStandaloneEditor: vi.fn(
    (options: { onContentChange: (content: string) => void }) => {
      collaboration.content = documentResponse.content;
      collaboration.options = {
        onContentChange: options.onContentChange,
        onBlackboardsChange: vi.fn(),
        onRestore: vi.fn(),
        onPermissionChange: vi.fn(),
        onPresenceChange: vi.fn(),
        onTransportChange: vi.fn(),
      };
      return Promise.resolve({
        destroy: vi.fn(),
        getContent: () => collaboration.content,
        prepareCheckpoint: collaboration.prepareCheckpoint,
        redo: collaboration.redo,
        undo: collaboration.undo,
      });
    },
  ),
}));

vi.mock('./MarkdownPreview.js', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { DocumentEditor } from './DocumentEditor.js';

const documentId = 'cm1234567890documentabcde';
const documentResponse = {
  id: documentId,
  folderId: null,
  name: 'Readme.md',
  permission: 'owner' as const,
  content: '# Initial\n',
  currentRevision: {
    id: 'cm1234567890revisionabcde',
    ordinal: 1,
    createdAt: '2026-07-28T00:00:00.000Z',
  },
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

beforeCrypto();

afterEach(() => {
  cleanup();
  collaboration.content = '';
  collaboration.blackboards = [];
  collaboration.creationCount = 0;
  collaboration.creationError = null;
  collaboration.initialContent = null;
  collaboration.options = null;
  collaboration.prepareCheckpoint.mockClear();
  collaboration.redoBlackboard.mockClear();
  collaboration.reorderBlackboard.mockClear();
  collaboration.redo.mockClear();
  collaboration.undoBlackboard.mockClear();
  collaboration.undo.mockClear();
  vi.unstubAllGlobals();
  beforeCrypto();
});

describe('DocumentEditor', () => {
  it('falls back to revision editing and legacy save without collaboration', async () => {
    collaboration.creationError = new Error('Collaboration unavailable');
    const updatedContent = '# Updated without collaboration\n';
    const nextRevision = {
      id: 'cm1234567890revisionoffline',
      ordinal: 2,
      createdAt: '2026-07-31T00:00:00.000Z',
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(jsonResponse(documentResponse));
      }
      if (url.endsWith('/content')) {
        return Promise.resolve(
          jsonResponse({ documentId, currentRevision: nextRevision }),
        );
      }
      return Promise.reject(
        new Error(`Unexpected request: ${url} ${String(init?.method)}`),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderEditor();

    expect(await screen.findByText('Collaboration off')).toBeTruthy();
    act(() => {
      collaboration.content = updatedContent;
      collaboration.options?.onContentChange(updatedContent);
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/documents/${documentId}/content`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          baseRevisionId: documentResponse.currentRevision.id,
          content: updatedContent,
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/collaboration-checkpoint'),
      expect.anything(),
    );
    expect(await screen.findAllByText('Revision 2')).toHaveLength(2);
  });

  it('checkpoints the authoritative room without sending client Markdown', async () => {
    const updatedContent = '# Updated together\n';
    const initialHistoryRevision = {
      id: documentResponse.currentRevision.id,
      ordinal: 1,
      createdAt: documentResponse.currentRevision.createdAt,
      author: {
        id: 'cm1234567890authorabcdef',
        email: 'author@example.com',
      },
      byteSize: documentResponse.content.length,
      saveMessage: null,
      restoredFromRevisionId: null,
    };
    const nextRevisionSummary = {
      id: 'cm1234567890revisionnextab',
      ordinal: 2,
      createdAt: '2026-07-28T00:05:00.000Z',
    };
    const nextHistoryRevision = {
      ...nextRevisionSummary,
      author: initialHistoryRevision.author,
      byteSize: updatedContent.length,
      saveMessage: null,
      restoredFromRevisionId: null,
    };
    let saved = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(jsonResponse(documentResponse));
      }
      if (url.endsWith('/collaboration-ticket')) {
        return Promise.resolve(jsonResponse(collaborationTicket()));
      }
      if (url.endsWith('/collaboration-checkpoint')) {
        saved = true;
        return Promise.resolve(
          jsonResponse({
            documentId,
            contentHash: sha256('# Canonical server serialization\n'),
            blackboardHash: sha256('[]'),
            currentRevision: nextRevisionSummary,
          }),
        );
      }
      if (url.endsWith('/revisions')) {
        return Promise.resolve(
          jsonResponse({
            revisions: saved
              ? [nextHistoryRevision, initialHistoryRevision]
              : [initialHistoryRevision],
          }),
        );
      }
      return Promise.reject(
        new Error(`Unexpected request: ${url} ${String(init?.method)}`),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderEditor();

    expect(
      await screen.findByRole('heading', { name: 'Readme.md' }),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(
      await screen.findByRole('button', { name: /Revision 1/ }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close history' }));
    act(() => {
      collaboration.content = updatedContent;
      collaboration.options?.onContentChange(updatedContent);
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(collaboration.prepareCheckpoint).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled'),
      ).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(
      await screen.findByRole('button', { name: /Revision 2/ }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/documents/${documentId}/collaboration-checkpoint`,
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/content'),
      expect.anything(),
    );
  });

  it('opens shared viewer documents without a Save command', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === `/api/v1/documents/${documentId}`) {
          return Promise.resolve(
            jsonResponse({ ...documentResponse, permission: 'viewer' }),
          );
        }
        if (url.endsWith('/collaboration-ticket')) {
          return Promise.resolve(
            jsonResponse({ ...collaborationTicket(), permission: 'viewer' }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
    renderEditor();

    expect(await screen.findByText('Shared document · View only')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Save')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull();
  });

  it('enters and exits full screen without recreating the editor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === `/api/v1/documents/${documentId}`) {
          return Promise.resolve(jsonResponse(documentResponse));
        }
        if (url.endsWith('/collaboration-ticket')) {
          return Promise.resolve(jsonResponse(collaborationTicket()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
    const user = userEvent.setup();
    renderEditor();

    await screen.findByRole('heading', { name: 'Readme.md' });
    expect(collaboration.creationCount).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Enter full screen' }));

    expect(
      screen
        .getByRole('button', { name: 'Exit full screen' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      document.querySelector('.document-editor-shell.full-screen'),
    ).not.toBeNull();
    expect(document.body.classList.contains('editor-full-screen-open')).toBe(
      true,
    );
    expect(collaboration.creationCount).toBe(1);

    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('button', { name: 'Enter full screen' }),
    ).toBeTruthy();
    expect(document.body.classList.contains('editor-full-screen-open')).toBe(
      false,
    );
    expect(collaboration.creationCount).toBe(1);
  });

  it('provides visible undo and redo controls for editors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === `/api/v1/documents/${documentId}`) {
          return Promise.resolve(jsonResponse(documentResponse));
        }
        if (url.endsWith('/collaboration-ticket')) {
          return Promise.resolve(jsonResponse(collaborationTicket()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
    const user = userEvent.setup();
    renderEditor();

    await screen.findByRole('heading', { name: 'Readme.md' });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Redo' }));

    expect(collaboration.undo).toHaveBeenCalledOnce();
    expect(collaboration.redo).toHaveBeenCalledOnce();
  });

  it('marks the first edit in an authoritative empty room as unsaved', async () => {
    collaboration.initialContent = '';
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === `/api/v1/documents/${documentId}`) {
          return Promise.resolve(
            jsonResponse({ ...documentResponse, content: '' }),
          );
        }
        if (url.endsWith('/collaboration-ticket')) {
          return Promise.resolve(jsonResponse(collaborationTicket()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
    renderEditor();

    const saveButton = await screen.findByRole('button', { name: 'Save' });
    expect(saveButton.hasAttribute('disabled')).toBe(true);
    act(() => {
      collaboration.content = '# Pasted content\n';
      collaboration.options?.onContentChange(collaboration.content);
    });

    expect(saveButton.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Not saved to history')).toBeTruthy();
  });

  it('shows and copies the current canonical Markdown without replacing the editor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === `/api/v1/documents/${documentId}`) {
          return Promise.resolve(jsonResponse(documentResponse));
        }
        if (url.endsWith('/collaboration-ticket')) {
          return Promise.resolve(jsonResponse(collaborationTicket()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderEditor();
    await screen.findByRole('heading', { name: 'Readme.md' });
    const updatedContent = '# Current draft\n\n$1 \\le N$\n';
    act(() => {
      collaboration.content = updatedContent;
      collaboration.options?.onContentChange(updatedContent);
    });

    await user.click(
      screen.getByRole('button', { name: 'Show Markdown source' }),
    );
    expect(screen.getByLabelText('Markdown source').textContent).toContain(
      updatedContent,
    );
    expect(collaboration.creationCount).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Copy Markdown' }));

    expect(writeText).toHaveBeenCalledWith(updatedContent);
    expect(collaboration.creationCount).toBe(1);
  });

  it('lets owners grant an existing account editor access', async () => {
    const collaborator = {
      userId: 'cm1234567890collaboratorab',
      email: 'collaborator@example.test',
      role: 'editor',
      createdAt: '2026-07-28T00:03:00.000Z',
      updatedAt: '2026-07-28T00:03:00.000Z',
    };
    let collaborators: (typeof collaborator)[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(jsonResponse(documentResponse));
      }
      if (url.endsWith('/collaboration-ticket')) {
        return Promise.resolve(jsonResponse(collaborationTicket()));
      }
      if (url.endsWith('/collaborators') && init?.method === 'POST') {
        collaborators = [collaborator];
        return Promise.resolve(jsonResponse(collaborator, 201));
      }
      if (url.endsWith('/collaborators')) {
        return Promise.resolve(jsonResponse({ collaborators }));
      }
      return Promise.reject(
        new Error(`Unexpected request: ${url} ${String(init?.method)}`),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole('button', { name: 'Share' }));
    await user.type(
      screen.getByLabelText('Registered email'),
      collaborator.email,
    );
    await user.click(screen.getByRole('button', { name: 'Share document' }));

    expect(await screen.findByText(collaborator.email)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/documents/${documentId}/collaborators`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: collaborator.email, role: 'editor' }),
      }),
    );
  });

  it('becomes read-only when a reconnect ticket downgrades permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === `/api/v1/documents/${documentId}`) {
          return Promise.resolve(jsonResponse(documentResponse));
        }
        if (url.endsWith('/collaboration-ticket')) {
          return Promise.resolve(jsonResponse(collaborationTicket()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
    renderEditor();

    expect(await screen.findByRole('button', { name: 'Share' })).toBeTruthy();
    act(() => collaboration.options?.onPermissionChange('viewer'));

    expect(await screen.findByText('Shared document · View only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('shows the number of people currently in the collaboration room', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === `/api/v1/documents/${documentId}`) {
          return Promise.resolve(jsonResponse(documentResponse));
        }
        if (url.endsWith('/collaboration-ticket')) {
          return Promise.resolve(jsonResponse(collaborationTicket()));
        }
        return Promise.reject(new Error(`Unexpected request: ${url}`));
      }),
    );
    renderEditor();

    expect(await screen.findByText('Only you')).toBeTruthy();
    act(() => collaboration.options?.onPresenceChange(2));

    expect(await screen.findByText('2 here')).toBeTruthy();
  });

  it('saves an optional checkpoint message', async () => {
    const updatedContent = '# Updated\n';
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(jsonResponse(documentResponse));
      }
      if (url.endsWith('/collaboration-ticket')) {
        return Promise.resolve(jsonResponse(collaborationTicket()));
      }
      if (url.endsWith('/collaboration-checkpoint')) {
        return Promise.resolve(
          jsonResponse({
            documentId,
            contentHash: sha256(updatedContent),
            blackboardHash: sha256('[]'),
            currentRevision: {
              id: 'cm1234567890revisionnextab',
              ordinal: 2,
              createdAt: '2026-07-28T00:05:00.000Z',
            },
          }),
        );
      }
      return Promise.reject(
        new Error(`Unexpected request: ${url} ${String(init?.method)}`),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Readme.md' });
    act(() => {
      collaboration.content = updatedContent;
      collaboration.options?.onContentChange(updatedContent);
    });
    await user.click(
      screen.getByRole('button', { name: 'Save with checkpoint message' }),
    );
    await user.type(
      await screen.findByLabelText('Checkpoint message'),
      'Finish intro',
    );
    await user.click(screen.getByRole('button', { name: 'Save checkpoint' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/documents/${documentId}/collaboration-checkpoint`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ saveMessage: 'Finish intro' }),
        }),
      ),
    );
  });

  it('previews and restores an immutable historical revision', async () => {
    const historyRevision = {
      id: documentResponse.currentRevision.id,
      ordinal: 1,
      createdAt: documentResponse.currentRevision.createdAt,
      author: {
        id: 'cm1234567890authorabcdef',
        email: 'author@example.com',
      },
      byteSize: 10,
      saveMessage: 'Initial draft',
      restoredFromRevisionId: null,
    };
    const currentRevision = {
      id: 'cm1234567890revisionnextab',
      ordinal: 2,
      createdAt: '2026-07-28T00:05:00.000Z',
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(
          jsonResponse({ ...documentResponse, currentRevision }),
        );
      }
      if (url.endsWith('/collaboration-ticket')) {
        return Promise.resolve(jsonResponse(collaborationTicket()));
      }
      if (url.endsWith(`/revisions/${historyRevision.id}/restore`)) {
        return Promise.resolve(
          jsonResponse({
            documentId,
            currentRevision: {
              id: 'cm1234567890revisionrestore',
              ordinal: 3,
              createdAt: '2026-07-28T00:10:00.000Z',
            },
            contentHash: 'a'.repeat(64),
            blackboardHash: sha256('[]'),
          }),
        );
      }
      if (url.endsWith(`/revisions/${historyRevision.id}`)) {
        return Promise.resolve(
          jsonResponse({
            ...historyRevision,
            content: '# Earlier\n',
            blackboards: [],
          }),
        );
      }
      if (url.endsWith('/revisions')) {
        return Promise.resolve(jsonResponse({ revisions: [historyRevision] }));
      }
      return Promise.reject(
        new Error(`Unexpected request: ${url} ${String(init?.method)}`),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Readme.md' });
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /Revision 1/ }));
    expect(await screen.findByText(/Earlier/)).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Restore revision 1' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Restore as new revision' }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/documents/${documentId}/revisions/${historyRevision.id}/restore`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ baseRevisionId: currentRevision.id }),
        }),
      ),
    );
  });

  it('recreates the collaborative document after a remote restore', async () => {
    let documentLoads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        documentLoads += 1;
        if (documentLoads === 2) {
          collaboration.content = '# Restored remotely\n';
        }
        return Promise.resolve(
          jsonResponse(
            documentLoads === 1
              ? documentResponse
              : {
                  ...documentResponse,
                  content: '# Restored remotely\n',
                  currentRevision: {
                    id: 'cm1234567890revisionrestore',
                    ordinal: 2,
                    createdAt: '2026-07-28T00:10:00.000Z',
                  },
                },
          ),
        );
      }
      if (url.endsWith('/collaboration-ticket')) {
        return Promise.resolve(jsonResponse(collaborationTicket()));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor();

    await screen.findByRole('heading', { name: 'Readme.md' });
    expect(collaboration.creationCount).toBe(1);
    act(() => collaboration.options?.onRestore());

    await waitFor(() => expect(documentLoads).toBe(2));
    await waitFor(() => expect(collaboration.creationCount).toBe(2));
    expect(collaboration.content).toBe('# Restored remotely\n');
    expect(screen.getByText('Saved to history')).toBeTruthy();
    expect(screen.getAllByText('Revision 2')).toHaveLength(2);
  });

  it('creates and revokes a read-only public link', async () => {
    const token = 'p'.repeat(43);
    let publicLink: {
      enabled: boolean;
      createdAt: string | null;
      token?: string;
    } = {
      enabled: false,
      createdAt: null,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(jsonResponse(documentResponse));
      }
      if (url.endsWith('/collaboration-ticket')) {
        return Promise.resolve(jsonResponse(collaborationTicket()));
      }
      if (url.endsWith('/collaborators')) {
        return Promise.resolve(jsonResponse({ collaborators: [] }));
      }
      if (url.endsWith('/public-link') && init?.method === 'POST') {
        publicLink = {
          enabled: true,
          createdAt: '2026-07-27T12:00:00.000Z',
        };
        return Promise.resolve(
          jsonResponse({ token, createdAt: publicLink.createdAt }),
        );
      }
      if (url.endsWith('/public-link') && init?.method === 'DELETE') {
        publicLink = { enabled: false, createdAt: null };
        return Promise.resolve(jsonResponse(publicLink));
      }
      if (url.endsWith('/public-link')) {
        return Promise.resolve(jsonResponse(publicLink));
      }
      return Promise.reject(
        new Error(`Unexpected request: ${url} ${String(init?.method)}`),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Readme.md' });
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(
      await screen.findByRole('button', { name: 'Create public link' }),
    );

    expect(
      await screen.findByDisplayValue(
        `${window.location.origin}/public#token=${token}`,
      ),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Revoke public link' }),
    );
    expect(await screen.findByText('Public link is off.')).toBeTruthy();
  });

  it('creates separate blackboards from frozen copies of the current Markdown', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(jsonResponse(documentResponse));
      }
      if (url.endsWith('/collaboration-ticket')) {
        return Promise.resolve(jsonResponse(collaborationTicket()));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Readme.md' });
    await user.click(screen.getByRole('button', { name: 'Show blackboards' }));
    await user.click(screen.getByRole('button', { name: 'Create blackboard' }));
    expect(
      await screen.findByRole('tab', { name: 'Blackboard 1' }),
    ).toBeTruthy();
    expect(collaboration.blackboards[0]?.backgroundMarkdown).toBe(
      '# Initial\n',
    );

    act(() => {
      collaboration.content = '# Later lesson\n';
      collaboration.options?.onContentChange(collaboration.content);
    });
    await user.click(screen.getByRole('button', { name: 'New blackboard' }));
    expect(
      await screen.findByRole('tab', { name: 'Blackboard 2' }),
    ).toBeTruthy();
    expect(collaboration.blackboards[0]?.backgroundMarkdown).toBe(
      '# Initial\n',
    );
    expect(collaboration.blackboards[1]?.backgroundMarkdown).toBe(
      '# Later lesson\n',
    );

    await user.click(screen.getByRole('tab', { name: 'Blackboard 1' }));
    await user.click(
      screen.getByRole('button', { name: 'Move blackboard right' }),
    );
    expect(collaboration.reorderBlackboard).toHaveBeenCalledWith(
      collaboration.blackboards[0]?.id,
      1,
    );
    await user.click(screen.getByRole('button', { name: 'Undo blackboard' }));
    await user.click(screen.getByRole('button', { name: 'Redo blackboard' }));
    expect(collaboration.undoBlackboard).toHaveBeenCalledTimes(1);
    expect(collaboration.redoBlackboard).toHaveBeenCalledTimes(1);
  });
});

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DocumentEditor documentId={documentId} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

function collaborationTicket() {
  return {
    ticket: 'a'.repeat(43),
    documentId,
    permission: 'owner',
    stateFormat: 'milkdown-blackboards-v1',
    websocketUrl: 'ws://localhost:3001/',
    expiresAt: '2026-07-28T00:01:00.000Z',
  };
}

function beforeCrypto() {
  let uuidSequence = 0;
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => {
      uuidSequence += 1;
      return `11111111-1111-4111-8111-${uuidSequence.toString().padStart(12, '0')}`;
    }),
    subtle: {
      digest: vi.fn((_algorithm: string, data: ArrayBuffer) => {
        const hash = createHash('sha256').update(new Uint8Array(data)).digest();
        return Promise.resolve(
          hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength),
        );
      }),
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe() {}
      public disconnect() {}
    },
  );
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(
      () =>
        ({
          beginPath: vi.fn(),
          clearRect: vi.fn(),
          lineTo: vi.fn(),
          moveTo: vi.fn(),
          restore: vi.fn(),
          save: vi.fn(),
          setTransform: vi.fn(),
          stroke: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    ),
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
