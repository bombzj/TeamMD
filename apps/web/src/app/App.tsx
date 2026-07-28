import type { AuthResponse } from '@mymd/contracts';
import { Folder, LogOut, Plus, Search, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AuthScreen } from '../features/auth/AuthScreen.js';
import { WorkspaceView } from '../features/workspace/WorkspaceView.js';
import { loadCurrentUser, logout } from '../lib/api.js';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; auth: AuthResponse };

export function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
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
  }, []);

  if (authState.status === 'loading') {
    return (
      <main className="loading-screen" aria-label="Loading MyMD">
        <div className="wordmark">MyMD</div>
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
    />
  );
}

function WorkspaceShell({
  auth,
  onLogout,
}: {
  auth: AuthResponse;
  onLogout: () => Promise<void>;
}) {
  const [view, setView] = useState<'files' | 'trash'>('files');
  const [createDocumentRequest, setCreateDocumentRequest] = useState(0);

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div className="wordmark">MyMD</div>
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Search"
            title="Search"
          >
            <Search size={18} />
          </button>
          <button
            className="icon-button mobile-logout"
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void onLogout()}
          >
            <LogOut size={18} />
          </button>
          <div className="user-chip" title={auth.user.email}>
            {auth.user.email.slice(0, 1).toUpperCase()}
          </div>
        </div>
      </header>
      <div className="workspace-body">
        <aside className="sidebar">
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
              onClick={() => setView('files')}
            >
              <Folder size={17} /> My files
            </button>
            <button className="nav-row" type="button" disabled>
              <Users size={17} /> Shared with me
            </button>
            <button
              className={`nav-row ${view === 'trash' ? 'active' : ''}`}
              type="button"
              onClick={() => setView('trash')}
            >
              <Trash2 size={17} /> Trash
            </button>
          </nav>
          <button
            className="logout-button"
            type="button"
            onClick={() => void onLogout()}
          >
            <LogOut size={17} /> Sign out
          </button>
        </aside>
        <WorkspaceView
          view={view}
          createDocumentRequest={createDocumentRequest}
          onViewChange={setView}
        />
      </div>
    </div>
  );
}
