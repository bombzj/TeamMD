import type { AuthResponse } from '@teammd/contracts';
import {
  ChevronUp,
  Folder,
  LogOut,
  MonitorX,
  Plus,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { AuthScreen } from '../features/auth/AuthScreen.js';
import { PublicDocumentView } from '../features/public-document/PublicDocumentView.js';
import { WorkspaceView } from '../features/workspace/WorkspaceView.js';
import {
  ApiClientError,
  changePassword,
  loadCurrentUser,
  logout,
  logoutAllSessions,
} from '../lib/api.js';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; auth: AuthResponse };

export function App() {
  const [publicToken] = useState(readPublicToken);
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    if (publicToken !== null) return;
    let active = true;
    void loadCurrentUser()
      .then((auth) => {
        if (active) {
          setAuthState(
            auth ? { status: 'authenticated', auth } : { status: 'anonymous' },
          );
        }
      })
      .catch(() => {
        if (active) setAuthState({ status: 'anonymous' });
      });
    return () => {
      active = false;
    };
  }, [publicToken]);

  if (publicToken !== null) {
    return <PublicDocumentView token={publicToken} />;
  }

  if (authState.status === 'loading') {
    return (
      <main className="loading-screen" aria-label="Loading TeamMD">
        <div className="wordmark">TeamMD</div>
        <div className="loading-rule" />
      </main>
    );
  }

  if (authState.status === 'anonymous') {
    return (
      <AuthScreen
        onAuthenticated={(auth) =>
          setAuthState({ status: 'authenticated', auth })
        }
      />
    );
  }

  return (
    <WorkspaceShell
      auth={authState.auth}
      onLogout={async () => {
        await logout();
        setAuthState({ status: 'anonymous' });
      }}
      onLogoutAll={async () => {
        await logoutAllSessions();
        setAuthState({ status: 'anonymous' });
      }}
    />
  );
}

function readPublicToken(): string | null {
  if (window.location.pathname !== '/public') return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token === null) return '';
  window.history.replaceState(null, '', '/public');
  return token;
}

function WorkspaceShell({
  auth,
  onLogout,
  onLogoutAll,
}: {
  auth: AuthResponse;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
}) {
  const [view, setView] = useState<'files' | 'shared' | 'trash'>('files');
  const [createDocumentRequest, setCreateDocumentRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="workspace-shell">
      <div className="workspace-body">
        <aside className="sidebar">
          <div className="sidebar-brand wordmark">TeamMD</div>
          <button
            className="new-document"
            type="button"
            onClick={() => setCreateDocumentRequest((current) => current + 1)}
          >
            <Plus size={18} />
            New document
          </button>
          <nav className="workspace-nav" aria-label="Workspace">
            <button
              className={`nav-row ${view === 'files' ? 'active' : ''}`}
              type="button"
              aria-label="My files"
              title="My files"
              onClick={() => setView('files')}
            >
              <Folder size={17} /> <span className="nav-label">My files</span>
            </button>
            <button
              className={`nav-row ${view === 'shared' ? 'active' : ''}`}
              type="button"
              aria-label="Shared with me"
              title="Shared with me"
              onClick={() => setView('shared')}
            >
              <Users size={17} />
              <span className="nav-label">Shared with me</span>
            </button>
            <button
              className={`nav-row ${view === 'trash' ? 'active' : ''}`}
              type="button"
              aria-label="Trash"
              title="Trash"
              onClick={() => setView('trash')}
            >
              <Trash2 size={17} /> <span className="nav-label">Trash</span>
            </button>
          </nav>
          <AccountMenu
            auth={auth}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={onLogout}
            onLogoutAll={onLogoutAll}
          />
        </aside>
        <WorkspaceView
          view={view}
          createDocumentRequest={createDocumentRequest}
          onViewChange={setView}
        />
      </div>
      {settingsOpen ? (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  );
}

function AccountMenu({
  auth,
  onOpenSettings,
  onLogout,
  onLogoutAll,
}: {
  auth: AuthResponse;
  onOpenSettings: () => void;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    items[0]?.focus();

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? (currentIndex + 1) % items.length
              : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={menuRef}>
      {open ? (
        <div className="account-popover" role="menu" aria-label="Account">
          <div className="account-summary">
            <span className="account-avatar" aria-hidden="true">
              {auth.user.email.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>Account</strong>
              <small>{auth.user.email}</small>
            </span>
          </div>
          <div className="account-menu-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            <Settings size={17} /> Settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void onLogoutAll()}
          >
            <MonitorX size={17} /> Sign out all devices
          </button>
          <button type="button" role="menuitem" onClick={() => void onLogout()}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      ) : null}
      <button
        ref={triggerRef}
        className="account-trigger"
        type="button"
        aria-label={`Account menu for ${auth.user.email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="account-avatar" aria-hidden="true">
          {auth.user.email.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-trigger-copy">
          <strong>{auth.user.email}</strong>
          <small>Account</small>
        </span>
        <ChevronUp className="account-chevron" size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, submitting]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setSaved(false);
    const form = new FormData(formElement);
    const currentPassword = readTextField(form, 'currentPassword');
    const newPassword = readTextField(form, 'newPassword');
    const confirmPassword = readTextField(form, 'confirmPassword');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      formElement.reset();
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Unable to change the password. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="item-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="Close settings"
          disabled={submitting}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <p className="eyebrow">Settings</p>
        <h2 id="settings-title">Change password</h2>
        <p className="dialog-copy">
          Use at least 12 characters. Other signed-in devices will be signed out
          when your password changes.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label className="field-label">
            Current password
            <input
              autoFocus
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label className="field-label">
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label className="field-label">
            Confirm new password
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="form-success" role="status">
              Password changed. Other sessions were signed out.
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              className="text-button"
              type="button"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary-action compact-action"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Changing...' : 'Change password'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function readTextField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
