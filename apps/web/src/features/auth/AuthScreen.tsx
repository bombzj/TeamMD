import type { AuthResponse } from '@mymd/contracts';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { ApiClientError, login, registerAccount } from '../../lib/api.js';

type Mode = 'login' | 'register';

export function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (auth: AuthResponse) => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const input = {
      email: readTextField(form, 'email'),
      password: readTextField(form, 'password'),
    };
    try {
      const auth =
        mode === 'login' ? await login(input) : await registerAccount(input);
      onAuthenticated(auth);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Unable to reach MyMD. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode);
    setError(null);
  };

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-labelledby="product-name">
        <div className="story-content">
          <div className="wordmark" id="product-name">
            MyMD
          </div>
          <div className="story-rule" />
          <p className="story-kicker">A Markdown workspace</p>
          <h1>
            Write together.
            <br />
            Keep every draft.
          </h1>
          <p className="story-copy">
            A focused home for notes, documents, and shared thinking, with
            Markdown at the center and a history you can trust.
          </p>
        </div>
        <blockquote>
          <span>“</span>
          Plain text should feel anything but plain.
        </blockquote>
      </section>

      <section
        className="auth-panel"
        aria-label={mode === 'login' ? 'Sign in' : 'Create account'}
      >
        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="Account action">
            <button
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'selected' : ''}
              onClick={() => changeMode('login')}
              type="button"
            >
              Sign in
            </button>
            <button
              role="tab"
              aria-selected={mode === 'register'}
              className={mode === 'register' ? 'selected' : ''}
              onClick={() => changeMode('register')}
              type="button"
            >
              Create account
            </button>
          </div>

          <div className="auth-heading">
            <p className="eyebrow">
              {mode === 'login' ? 'Welcome back' : 'Start your workspace'}
            </p>
            <h2>
              {mode === 'login' ? 'Continue writing.' : 'Make room for ideas.'}
            </h2>
          </div>

          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              placeholder="you@example.com"
            />

            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                required
                minLength={12}
                maxLength={128}
                placeholder="At least 12 characters"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}

            <button
              className="submit-button"
              type="submit"
              disabled={submitting}
            >
              <span>
                {submitting
                  ? 'Please wait'
                  : mode === 'login'
                    ? 'Sign in'
                    : 'Create account'}
              </span>
              <ArrowRight size={18} />
            </button>
          </form>

          <p className="auth-note">
            {mode === 'register'
              ? 'By continuing, you agree to keep shared work respectful and secure.'
              : 'Your session stays in a secure, revocable cookie.'}
          </p>
        </div>
      </section>
    </main>
  );
}

function readTextField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
