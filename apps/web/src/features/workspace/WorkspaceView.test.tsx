import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../editor/DocumentEditor.js', () => ({
  DocumentEditor: ({ documentId }: { documentId: string }) => (
    <main aria-label="Document editor">
      <h1>Readme.md</h1>
      <span>{documentId}</span>
    </main>
  ),
}));

import { WorkspaceView } from './WorkspaceView.js';

const createdDocument = {
  id: 'cm1234567890documentabcde',
  folderId: null,
  name: 'Readme.md',
  currentRevision: {
    id: 'cm1234567890revisionabcde',
    ordinal: 1,
    createdAt: '2026-07-27T12:00:00.000Z',
  },
  createdAt: '2026-07-27T12:00:00.000Z',
  updatedAt: '2026-07-27T12:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkspaceView', () => {
  it('creates a document and refreshes the file tree', async () => {
    let treeReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === '/api/v1/workspace/tree') {
        treeReads += 1;
        return Promise.resolve(
          jsonResponse(
            treeReads === 1
              ? { folders: [], documents: [] }
              : { folders: [], documents: [createdDocument] },
          ),
        );
      }
      if (url === '/api/v1/documents') {
        return Promise.resolve(jsonResponse(createdDocument, 201));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceView
          view="files"
          createDocumentRequest={0}
          onViewChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Create document' }),
    );
    await user.type(screen.getByLabelText('Name'), 'Readme.md');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Readme.md')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/documents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Readme.md', folderId: null }),
      }),
    );
  });

  it('lists shared documents with permission and opens the editor', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === '/api/v1/shared-with-me') {
        return Promise.resolve(
          jsonResponse({
            documents: [{ ...createdDocument, permission: 'editor' }],
          }),
        );
      }
      if (url === `/api/v1/documents/${createdDocument.id}`) {
        return Promise.resolve(
          jsonResponse({
            ...createdDocument,
            permission: 'editor',
            content: '# Shared\n',
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceView
          view="shared"
          createDocumentRequest={0}
          onViewChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Can edit')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(
      await screen.findByRole('heading', { name: 'Readme.md' }),
    ).toBeTruthy();
  });

  it('closes an open editor when the workspace view changes', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === '/api/v1/workspace/tree') {
        return Promise.resolve(
          jsonResponse({ folders: [], documents: [createdDocument] }),
        );
      }
      if (url === '/api/v1/shared-with-me') {
        return Promise.resolve(jsonResponse({ documents: [] }));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceView
          view="files"
          createDocumentRequest={0}
          onViewChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Readme.md' }));
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    expect(await screen.findByLabelText('Document editor')).toBeTruthy();

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkspaceView
          view="shared"
          createDocumentRequest={0}
          onViewChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Shared with me' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByLabelText('Document editor')).toBeNull(),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
