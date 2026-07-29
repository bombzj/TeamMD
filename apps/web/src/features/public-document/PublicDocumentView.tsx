import { Eye, FileText, LogIn } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { MarkdownPreview } from '../editor/MarkdownPreview.js';
import { loadPublicDocument } from '../../lib/api.js';

export function PublicDocumentView({ token }: { token: string }) {
  const documentQuery = useQuery({
    queryKey: ['public-document'],
    queryFn: () => loadPublicDocument(token),
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (documentQuery.isPending) {
    return (
      <main
        className="public-document-status"
        aria-label="Loading public document"
      >
        <div className="wordmark">TeamMD</div>
        <span className="loading-rule" />
        Loading shared document
      </main>
    );
  }

  if (documentQuery.isError) {
    return (
      <main className="public-document-status">
        <div className="wordmark">TeamMD</div>
        <FileText size={34} />
        <h1>This link is unavailable</h1>
        <p>It may be invalid, revoked, or no longer shared.</p>
        <a className="secondary-button" href="/">
          <LogIn size={16} /> Open TeamMD
        </a>
      </main>
    );
  }

  return (
    <main className="public-document-shell">
      <header className="public-document-heading">
        <div className="wordmark">TeamMD</div>
        <div className="public-document-title">
          <p className="eyebrow">
            <Eye size={14} /> Read-only public document
          </p>
          <h1>{documentQuery.data.name}</h1>
          <span>
            Saved revision {documentQuery.data.currentRevision.ordinal} ·{' '}
            {formatPublicDate(documentQuery.data.currentRevision.createdAt)}
          </span>
        </div>
        <a className="secondary-button" href="/">
          <LogIn size={16} /> Open TeamMD
        </a>
      </header>
      <article className="public-document-content">
        <MarkdownPreview content={documentQuery.data.content} />
      </article>
      <footer className="public-document-footer">
        This view shows the latest saved revision. Shared drafts are never
        public.
      </footer>
    </main>
  );
}

function formatPublicDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
