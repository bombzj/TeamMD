import type { AuthResponse } from '@teammd/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthScreen } from './AuthScreen.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthScreen', () => {
  it('creates an account and returns the authenticated user', async () => {
    const onAuthenticated = vi.fn<(auth: AuthResponse) => void>();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 'cm1234567890abcdefghijklm',
            email: 'person@example.com',
            emailVerifiedAt: null,
            createdAt: '2026-07-27T12:00:00.000Z',
          },
          csrfToken: 'a'.repeat(43),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    await user.click(screen.getByRole('tab', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Email'), 'person@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'correct horse battery staple',
    );
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/register',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(onAuthenticated).toHaveBeenCalledOnce();
    expect(onAuthenticated.mock.calls[0]?.[0].user.email).toBe(
      'person@example.com',
    );
  });
});
