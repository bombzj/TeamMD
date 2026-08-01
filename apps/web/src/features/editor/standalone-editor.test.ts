import { waitFor } from '@testing-library/react';
import { markdownCompatibilityCorpus } from '@teammd/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  browserConfig: { mermaidRenderingEnabled: true },
}));

vi.mock('../../lib/browser-config.js', () => ({
  browserConfig: mocks.browserConfig,
}));

import { createStandaloneEditor } from './standalone-editor.js';

class VisibleIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect() {}
  observe(target: Element) {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this,
    );
  }
  takeRecords() {
    return [];
  }
  unobserve() {}
}

vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [],
});

const richMarkdown = `# Rich document

This has **bold**, *italic*, ~~deleted~~, and \`inline code\`.

- [x] Finished task

| Name | State |
| --- | --- |
| Editor | Ready |

\`\`\`typescript
const ready = true;
\`\`\`

\`\`\`mermaid
graph TD
  Source --> Preview
\`\`\`
`;

const mountedEditors: Array<{ destroy: () => void }> = [];

afterEach(() => {
  mocks.browserConfig.mermaidRenderingEnabled = true;
  mountedEditors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

describe('standalone editor rich features', () => {
  it('renders rich Markdown with named editing controls', async () => {
    const host = mountHost();
    const editor = await createStandaloneEditor({
      content: richMarkdown,
      editorHost: host,
      readOnly: false,
      onContentChange: () => {},
    });
    mountedEditors.push(editor);

    expect(host.querySelector('h1')?.textContent).toBe('Rich document');
    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('em')?.textContent).toBe('italic');
    expect(host.querySelector('del')?.textContent).toBe('deleted');
    expect(host.querySelector('table')).not.toBeNull();
    expect(editor.getContent()).toContain('```typescript');
    expect(editor.getContent()).toContain('const ready = true;');
    expect(editor.getContent()).toContain(
      '```mermaid\ngraph TD\n  Source --> Preview\n```',
    );
    expect(editor.getContent()).not.toContain('<svg');
    await waitFor(() => {
      expect(
        host.querySelector('button[aria-label="Bold"]')?.getAttribute('title'),
      ).toBe('Bold');
    });
    expect(
      host.querySelector('button[aria-label="Code language"]')?.textContent,
    ).toContain('typescript');
    expect(
      host.querySelector('button[aria-label="Align column left"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="Delete row"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="Add column"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[role="button"][aria-label="Add block"]'),
    ).not.toBeNull();
    const namedControls = [
      'Bold',
      'Code language',
      'Align column left',
      'Delete row',
      'Add column',
      'Add block',
    ].map((name) => host.querySelector<HTMLElement>(`[aria-label="${name}"]`));
    expect(namedControls.every((control) => control !== null)).toBe(true);
    namedControls.forEach((control) => {
      expect(control?.getAttribute('title')).toBe(control?.ariaLabel);
      expect(control?.tabIndex).toBeGreaterThanOrEqual(0);
    });

    const boldButton = host.querySelector<HTMLButtonElement>(
      '.milkdown-top-bar button[aria-label="Bold"]',
    );
    const pointerDown = vi.fn();
    boldButton?.addEventListener('pointerdown', pointerDown);
    boldButton?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: ' ' }),
    );
    expect(pointerDown).toHaveBeenCalledOnce();
  });

  it('suppresses mutation controls for viewers', async () => {
    const host = mountHost();
    const editor = await createStandaloneEditor({
      content: richMarkdown,
      editorHost: host,
      readOnly: true,
      onContentChange: () => {},
    });
    mountedEditors.push(editor);

    expect(
      host.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
    ).toBe('false');
    expect(editor.getContent()).toContain('```mermaid');
    expect(editor.getContent()).not.toContain('<svg');
    expect(host.querySelector('.milkdown-top-bar button')).toBeNull();
    expect(
      host.querySelector('.milkdown-toolbar')?.getAttribute('data-show'),
    ).toBe('false');
    expect(
      host
        .querySelector('.milkdown-table-block [data-role="col-drag-handle"]')
        ?.getAttribute('data-show'),
    ).toBe('false');
    expect(host.querySelector('.mermaid-visual-controls')).toBeNull();
  });

  it('preserves writable Mermaid source when rendering is disabled', async () => {
    mocks.browserConfig.mermaidRenderingEnabled = false;
    const host = mountHost();
    const editor = await createStandaloneEditor({
      content: richMarkdown,
      editorHost: host,
      readOnly: false,
      onContentChange: () => {},
    });
    mountedEditors.push(editor);

    expect(editor.getContent()).toContain(
      '```mermaid\ngraph TD\n  Source --> Preview\n```',
    );
    expect(host.textContent).toContain('graph TD');
    expect(host.querySelector('.mermaid-visual-controls')).toBeNull();
    expect(host.querySelector('.mermaid-preview-svg')).toBeNull();
  });

  it.each(markdownCompatibilityCorpus)(
    'stabilizes the shared $name corpus through browser parse/serialize/parse',
    async ({ markdown, mermaidSources }) => {
      const firstHost = mountHost();
      const firstEditor = await createStandaloneEditor({
        content: markdown,
        editorHost: firstHost,
        readOnly: false,
        onContentChange: () => {},
      });
      mountedEditors.push(firstEditor);
      const serialized = firstEditor.getContent();

      const secondHost = mountHost();
      const secondEditor = await createStandaloneEditor({
        content: serialized,
        editorHost: secondHost,
        readOnly: false,
        onContentChange: () => {},
      });
      mountedEditors.push(secondEditor);

      expect(secondEditor.getContent()).toBe(serialized);
      mermaidSources.forEach((source) => {
        expect(serialized).toContain(`\`\`\`mermaid\n${source}\n\`\`\``);
      });
    },
  );
});

function mountHost() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}
