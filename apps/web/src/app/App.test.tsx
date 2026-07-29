import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vditor', () => ({
  default: {
    preview: (host: HTMLElement, content: string) => {
      host.textContent = content.replace(/^# /, '').trim();
      return Promise.resolve();
    },
  },
}));

import { App } from './App.js';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('App public document route', () => {
  it('resolves a fragment token without bootstrapping a private session', async () => {
    const token = 'p'.repeat(43);
    window.history.replaceState(null, '', `/public#token=${token}`);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'Published notes',
          currentRevision: {
            id: 'cm1234567890revisionabcd',
            ordinal: 4,
            createdAt: '2026-07-27T12:00:00.000Z',
          },
          content: '# Public copy\n',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Published notes' }),
    ).toBeTruthy();
    expect(screen.getByText('Public copy')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/public/documents/resolve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    );
  });
});
