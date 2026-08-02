import Vditor from 'vditor';
import { useEffect, useRef } from 'react';

import { browserConfig } from '../../lib/browser-config.js';
import { renderKatex } from './katex-renderer.js';
import { createMermaidPreviewRenderer } from './mermaid-preview.js';

const staticMermaidSourceClass = 'teammd-static-mermaid-source';
const staticMathSourceClass = 'teammd-static-math-source';

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
    const detachedHost = document.createElement('div');
    const mermaidPreview = createMermaidPreviewRenderer();
    let active = true;

    void Vditor.preview(detachedHost, content, {
      cdn: '/vditor',
      math: { inlineDigit: true },
      mode: 'light',
      markdown: { sanitize: true },
      transform: preserveStaticMermaidSources,
    }).then(() => {
      if (!active) return;
      if (!browserConfig.mermaidRenderingEnabled) {
        restoreStaticMermaidSources(detachedHost);
      }
      const diagrams = browserConfig.mermaidRenderingEnabled
        ? prepareStaticMermaidPreviews(detachedHost)
        : [];
      prepareStaticMathPreviews(detachedHost);
      host.replaceChildren(...detachedHost.childNodes);
      diagrams.forEach(({ source, target }) => {
        mermaidPreview.renderPreview('mermaid', source, (value) => {
          if (!active || !target.isConnected) return;
          if (value === null) {
            target.replaceChildren();
          } else if (typeof value === 'string') {
            target.textContent = value;
          } else {
            target.replaceChildren(value);
          }
        });
      });
    });

    return () => {
      active = false;
      mermaidPreview.destroy();
    };
  }, [content]);

  return (
    <div
      ref={hostRef}
      className={`vditor-preview vditor-reset ${className}`.trim()}
    />
  );
}

function restoreStaticMermaidSources(host: HTMLElement): void {
  host.querySelectorAll(`code.${staticMermaidSourceClass}`).forEach((code) => {
    code.classList.remove(staticMermaidSourceClass);
    code.classList.add('language-mermaid');
  });
}

function preserveStaticMermaidSources(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('code.language-mermaid').forEach((code) => {
    code.classList.remove('language-mermaid');
    code.classList.add(staticMermaidSourceClass);
  });
  template.content.querySelectorAll('.language-math').forEach((math) => {
    math.classList.remove('language-math');
    math.classList.add(staticMathSourceClass);
  });
  return template.innerHTML;
}

function prepareStaticMathPreviews(host: HTMLElement): void {
  host.querySelectorAll(`.${staticMathSourceClass}`).forEach((math) => {
    const source = math.textContent?.trim() ?? '';
    const container = math.closest('pre');
    const displayMode = math.tagName === 'DIV' || container !== null;
    const rendered = renderKatex(source, displayMode);
    rendered.setAttribute('aria-label', `Formula: ${source}`);
    (container ?? math).replaceWith(rendered);
  });
}

function prepareStaticMermaidPreviews(host: HTMLElement): Array<{
  source: string;
  target: HTMLElement;
}> {
  return [...host.querySelectorAll(`code.${staticMermaidSourceClass}`)].map(
    (code) => {
      const source = code.textContent?.replace(/\n$/u, '') ?? '';
      const target = document.createElement('div');
      target.className = 'preview';
      const panel = document.createElement('div');
      panel.className = 'preview-panel';
      panel.append(target);
      const codeBlock = document.createElement('div');
      codeBlock.className = 'milkdown-code-block static-mermaid-preview';
      codeBlock.setAttribute('aria-label', 'Mermaid diagram');
      codeBlock.append(panel);
      const themeHost = document.createElement('div');
      themeHost.className = 'milkdown-host static-mermaid-host';
      themeHost.append(codeBlock);
      const container = code.closest('pre') ?? code;
      container.replaceWith(themeHost);
      return { source, target };
    },
  );
}
