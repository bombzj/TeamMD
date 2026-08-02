import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('../features/workspace/WorkspaceView.js', () => ({
  WorkspaceView: () => <main aria-label="Workspace content" />,
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
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /save|undo|redo/i }),
    ).toBeNull();
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

describe('App authenticated shell', () => {
  it('uses sidebar branding and changes a password through account settings', async () => {
    const csrfToken = 'c'.repeat(43);
    const replacementCsrfToken = 'd'.repeat(43);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            id: 'cm1234567890useraccount',
            email: 'owner@example.com',
            emailVerifiedAt: null,
            createdAt: '2026-07-27T12:00:00.000Z',
          },
          csrfToken,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            id: 'cm1234567890useraccount',
            email: 'owner@example.com',
            emailVerifiedAt: null,
            createdAt: '2026-07-27T12:00:00.000Z',
          },
          csrfToken: replacementCsrfToken,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('TeamMD')).toBeTruthy();
    expect(screen.queryByRole('banner')).toBeNull();
    const accountTrigger = screen.getByRole('button', {
      name: 'Account menu for owner@example.com',
    });

    await user.click(accountTrigger);
    expect(screen.getByRole('menu', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Sign out all devices' }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Settings' }),
    );

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Sign out all devices' }),
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(accountTrigger);

    await user.click(accountTrigger);
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));

    expect(
      screen.getByRole('dialog', { name: 'Change password' }),
    ).toBeTruthy();
    await user.type(
      screen.getByLabelText('Current password'),
      'correct horse battery staple',
    );
    await user.type(
      screen.getByLabelText('New password'),
      'another secure password phrase',
    );
    await user.type(
      screen.getByLabelText('Confirm new password'),
      'a different secure password',
    );
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('alert').textContent).toContain('do not match');
    expect(fetchMock).toHaveBeenCalledOnce();

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(
      screen.getByLabelText('Confirm new password'),
      'another secure password phrase',
    );
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText(
        'Password changed. Other sessions were signed out.',
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/auth/password',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: 'correct horse battery staple',
          newPassword: 'another secure password phrase',
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      }),
    );
  }, 10_000);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
