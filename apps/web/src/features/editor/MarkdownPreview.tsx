import Vditor from 'vditor';
import { useEffect, useRef } from 'react';

export function MarkdownPreview({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    void Vditor.preview(host, content, {
      cdn: '/vditor',
      mode: 'light',
      markdown: { sanitize: true },
    });
  }, [content]);

  return (
    <div
      ref={hostRef}
      className={`vditor-preview vditor-reset ${className}`.trim()}
    />
  );
}
