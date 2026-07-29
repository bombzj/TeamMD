import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const collaboration = vi.hoisted(() => ({
  content: '',
  options: null as null | {
    readOnly: boolean;
    onContentChange: (content: string) => void;
    onPermissionChange: (permission: 'owner' | 'editor' | 'viewer') => void;
    onTransportChange: (transport: 'synced') => void;
  },
  prepareCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

type MockEditorOptions = {
  initialContent: string;
  readOnly: boolean;
  onContentChange: (content: string) => void;
  onPermissionChange: (permission: 'owner' | 'editor' | 'viewer') => void;
  onTransportChange: (transport: 'synced') => void;
};

vi.mock('./collaborative-editor.js', () => ({
  createCollaborativeEditor: vi.fn((options: MockEditorOptions) => {
    collaboration.content = options.initialContent;
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
    await waitFor(() => expect(collaboration.options?.readOnly).toBe(true));
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
