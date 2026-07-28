import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const vditorState = vi.hoisted(() => ({
  instances: [] as Array<{
    input: (value: string) => void;
    getValue: () => string;
  }>,
}));

vi.mock('vditor', () => ({
  default: class FakeVditor {
    private value: string;

    public constructor(
      _host: HTMLElement,
      options: {
        value?: string;
        input?: (value: string) => void;
        after?: () => void;
      },
    ) {
      this.value = options.value ?? '';
      vditorState.instances.push({
        input: (value) => {
          this.value = value;
          options.input?.(value);
        },
        getValue: () => this.value,
      });
      queueMicrotask(() => options.after?.());
    }

    public getValue() {
      return this.value;
    }

    public setValue(value: string) {
      this.value = value;
    }

    public destroy() {}
  },
}));

import { DocumentEditor } from './DocumentEditor.js';

const documentId = 'cm1234567890documentabcde';
const revisionId = 'cm1234567890revisionabcde';
const documentResponse = {
  id: documentId,
  folderId: null,
  name: 'Readme.md',
  permission: 'owner',
  content: '# Initial\n',
  currentRevision: {
    id: revisionId,
    ordinal: 1,
    createdAt: '2026-07-28T00:00:00.000Z',
  },
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vditorState.instances.length = 0;
  vi.unstubAllGlobals();
});

describe('DocumentEditor', () => {
  it('saves Vditor content from the loaded base revision', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        return Promise.resolve(jsonResponse(documentResponse));
      }
      if (url === `/api/v1/documents/${documentId}/content`) {
        return Promise.resolve(
          jsonResponse({
            documentId,
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
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentEditor documentId={documentId} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Readme.md' }),
    ).toBeTruthy();
    await waitFor(() => expect(vditorState.instances).toHaveLength(1));
    act(() => {
      vditorState.instances[0]?.input('# Updated with Vditor\n');
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByText('Revision 2')).toBeTruthy();
    expect(vditorState.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/documents/${documentId}/content`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          baseRevisionId: revisionId,
          content: '# Updated with Vditor\n',
        }),
      }),
    );
  });

  it('preserves a local draft on conflict until the server version is reloaded', async () => {
    let documentLoads = 0;
    const latestDocument = {
      ...documentResponse,
      content: '# Server version\n',
      currentRevision: {
        id: 'cm1234567890revisionnextab',
        ordinal: 2,
        createdAt: '2026-07-28T00:05:00.000Z',
      },
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === `/api/v1/documents/${documentId}`) {
        documentLoads += 1;
        return Promise.resolve(
          jsonResponse(documentLoads === 1 ? documentResponse : latestDocument),
        );
      }
      if (url === `/api/v1/documents/${documentId}/content`) {
        return Promise.resolve(
          jsonResponse(
            {
              error: {
                code: 'REVISION_CONFLICT',
                message: 'The document has a newer revision.',
                requestId: 'request-conflict',
                details: { submittedBaseRevisionId: revisionId },
              },
            },
            409,
          ),
        );
      }
      return Promise.reject(
        new Error(`Unexpected request: ${url} ${String(init?.method)}`),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentEditor documentId={documentId} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Readme.md' }),
    ).toBeTruthy();
    await waitFor(() => expect(vditorState.instances).toHaveLength(1));
    act(() => {
      vditorState.instances[0]?.input('# Local draft\n');
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('A newer revision is already saved.'),
    ).toBeTruthy();
    expect(vditorState.instances[0]?.getValue()).toBe('# Local draft\n');
    expect(screen.getByText('Local draft')).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'Reload server version' }),
    );
    expect(await screen.findByText('Server version loaded')).toBeTruthy();
    expect(vditorState.instances[0]?.getValue()).toBe('# Server version\n');
    expect(screen.getByText('Revision 2')).toBeTruthy();
    expect(vditorState.instances).toHaveLength(1);
  });
});

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
