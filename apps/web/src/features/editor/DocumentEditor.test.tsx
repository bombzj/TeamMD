import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const collaboration = vi.hoisted(() => ({
  content: '',
  creationCount: 0,
  options: null as null | {
    onContentChange: (content: string) => void;
    onRestore: () => void;
    onPermissionChange: (permission: 'owner' | 'editor' | 'viewer') => void;
    onPresenceChange: (participantCount: number) => void;
    onTransportChange: (transport: 'synced') => void;
  },
  prepareCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

type MockEditorOptions = {
  onContentChange: (content: string) => void;
  onRestore: () => void;
  onPermissionChange: (permission: 'owner' | 'editor' | 'viewer') => void;
  onPresenceChange: (participantCount: number) => void;
  onTransportChange: (transport: 'synced') => void;
};

vi.mock('./collaborative-editor.js', () => ({
  createCollaborativeEditor: vi.fn((options: MockEditorOptions) => {
    collaboration.creationCount += 1;
    if (collaboration.content.length === 0) {
      collaboration.content = documentResponse.content;
    }
    collaboration.options = options;
    options.onTransportChange('synced');
    options.onContentChange(collaboration.content);
    return Promise.resolve({
      destroy: vi.fn(),
      getContent: () => collaboration.content,
      prepareCheckpoint: collaboration.prepareCheckpoint,
    });
  }),
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
  collaboration.creationCount = 0;
  collaboration.options = null;
  collaboration.prepareCheckpoint.mockClear();
  vi.unstubAllGlobals();
  beforeCrypto();
});

describe('DocumentEditor', () => {
  it('checkpoints the authoritative room without sending client Markdown', async () => {
    const updatedContent = '# Updated together\n';
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
    const user = userEvent.setup();
    renderEditor();

    expect(
      await screen.findByRole('heading', { name: 'Readme.md' }),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Synced')).toBeTruthy());
    act(() => {
      collaboration.content = updatedContent;
      collaboration.options?.onContentChange(updatedContent);
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(collaboration.prepareCheckpoint).toHaveBeenCalledOnce();
    expect(await screen.findAllByText('Revision 2')).toHaveLength(2);
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
          }),
        );
      }
      if (url.endsWith(`/revisions/${historyRevision.id}`)) {
        return Promise.resolve(
          jsonResponse({
            ...historyRevision,
            content: '# Earlier\n',
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
    stateFormat: 'legacy-text-v1',
    websocketUrl: 'ws://localhost:3001/',
    expiresAt: '2026-07-28T00:01:00.000Z',
  };
}

function beforeCrypto() {
  vi.stubGlobal('crypto', {
    subtle: {
      digest: vi.fn((_algorithm: string, data: ArrayBuffer) => {
        const hash = createHash('sha256').update(new Uint8Array(data)).digest();
        return Promise.resolve(
          hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength),
        );
      }),
    },
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
