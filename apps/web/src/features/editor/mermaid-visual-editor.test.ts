import { describe, expect, it, vi } from 'vitest';

import {
  connectVisualMermaidEditor,
  createVisualMermaidPreview,
  replaceOwningMermaidSource,
} from './mermaid-visual-editor.js';

describe('source-backed Mermaid visual editor', () => {
  it('shows controls only for editable supported flowcharts', () => {
    const preview = createVisualMermaidPreview(
      'flowchart LR\n  Start --> Done',
      diagramElement(),
      () => editorView().view,
    );

    expect(
      preview.querySelector('[aria-label="Visual diagram editor"]'),
    ).toBeTruthy();
    expect(preview.querySelector('[aria-label="Add node"]')).toBeTruthy();
    expect(
      preview.querySelector('[aria-label="Diagram direction"]'),
    ).toBeTruthy();
  });

  it.each([
    'sequenceDiagram\n  A->>B: Hello',
    'flowchart LR\n  A -- label --> B',
  ])('keeps unsupported Mermaid source in preview-only mode', (source) => {
    const preview = createVisualMermaidPreview(
      source,
      diagramElement(),
      () => editorView().view,
    );

    expect(preview.textContent).toContain('Diagram');
    expect(
      preview.querySelector('[aria-label="Visual diagram editor"]'),
    ).toBeNull();
  });

  it('suppresses visual mutation controls for read-only editors', () => {
    const preview = createVisualMermaidPreview(
      'flowchart LR\n  Start --> Done',
      diagramElement(),
      () => editorView({ editable: false }).view,
    );

    expect(
      preview.querySelector('[aria-label="Visual diagram editor"]'),
    ).toBeNull();
  });

  it('removes and restores derived controls when permissions change', async () => {
    const source = 'flowchart LR\n  Start --> Done';
    const fixture = editorView({ source });
    const root = document.createElement('div');
    const preview = createVisualMermaidPreview(
      source,
      diagramElement(),
      () => fixture.view,
    );
    const block = document.createElement('div');
    block.className = 'milkdown-code-block';
    block.append(preview);
    root.append(block);
    const disconnect = connectVisualMermaidEditor(root, () => fixture.view);

    fixture.setEditable(false);
    root.setAttribute('contenteditable', 'false');
    await Promise.resolve();
    expect(root.querySelector('.mermaid-visual-controls')).toBeNull();

    fixture.setEditable(true);
    root.setAttribute('contenteditable', 'true');
    await Promise.resolve();
    expect(root.querySelector('.mermaid-visual-controls')).toBeTruthy();

    disconnect();
  });

  it('restores select defaults after sanitized preview remounting', async () => {
    const source = 'flowchart LR\n  Start --> Done';
    const fixture = editorView({ source });
    const root = document.createElement('div');
    const block = document.createElement('div');
    block.className = 'milkdown-code-block';
    const preview = createVisualMermaidPreview(
      source,
      diagramElement(),
      () => fixture.view,
    );
    preview
      .querySelectorAll('option')
      .forEach((option) => option.removeAttribute('selected'));
    block.append(preview);
    root.append(block);

    const disconnect = connectVisualMermaidEditor(root, () => fixture.view);
    await Promise.resolve();

    expect(
      preview.querySelector<HTMLSelectElement>(
        '[aria-label="Diagram direction"]',
      )?.value,
    ).toBe('LR');
    expect(
      preview.querySelector<HTMLSelectElement>('[aria-label="Edge to"]')?.value,
    ).toBe('Done');
    disconnect();
  });

  it('rewrites the owning Mermaid code text in one transaction', () => {
    const source = 'flowchart LR\n  Start --> Done';
    const fixture = editorView({ source });
    const preview = mountedPreview();

    expect(
      replaceOwningMermaidSource(
        preview,
        source,
        'flowchart TB\n  Start --> Done',
        fixture.view,
      ),
    ).toBe(true);
    expect(fixture.replaceWith).toHaveBeenCalledWith(
      8,
      8 + source.length,
      'next-text',
    );
    expect(fixture.dispatch).toHaveBeenCalledOnce();
  });

  it.each([
    { editable: false, language: 'mermaid', source: 'current' },
    { editable: true, language: 'typescript', source: 'current' },
    { editable: true, language: 'mermaid', source: 'changed remotely' },
  ])('rejects stale, read-only, or non-Mermaid transactions', (state) => {
    const fixture = editorView(state);

    expect(
      replaceOwningMermaidSource(
        mountedPreview(),
        'current',
        'next',
        fixture.view,
      ),
    ).toBe(false);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it('serializes a visual node operation through the same transaction path', () => {
    const source = 'flowchart LR\n  Start --> Done';
    const fixture = editorView({ source });
    const preview = createVisualMermaidPreview(
      source,
      diagramElement(),
      () => fixture.view,
    );
    const block = document.createElement('div');
    block.className = 'milkdown-code-block';
    block.append(preview);
    const root = document.createElement('div');
    root.append(block);
    document.body.append(root);
    const disconnect = connectVisualMermaidEditor(root, () => fixture.view);

    preview
      .querySelector<HTMLButtonElement>('[aria-label="Add node"]')
      ?.click();

    expect(fixture.schemaText).toHaveBeenCalledWith(`flowchart LR
  Start[Start]
  Done[Done]
  Node3[New node]
  Start --> Done`);
    expect(fixture.dispatch).toHaveBeenCalledOnce();
    disconnect();
    root.remove();
  });
});

function diagramElement(): HTMLElement {
  const diagram = document.createElement('div');
  diagram.textContent = 'Diagram';
  return diagram;
}

function mountedPreview(): HTMLElement {
  const block = document.createElement('div');
  block.className = 'milkdown-code-block';
  const preview = document.createElement('div');
  block.append(preview);
  document.body.append(block);
  return preview;
}

function editorView(
  options: {
    editable?: boolean;
    language?: string;
    source?: string;
  } = {},
) {
  const source = options.source ?? 'current';
  const replaceWith = vi.fn(() => transaction);
  const transaction = { replaceWith };
  const dispatch = vi.fn();
  const schemaText = vi.fn(() => 'next-text');
  const view = {
    editable: options.editable ?? true,
    posAtDOM: vi.fn(() => 7),
    dispatch,
    state: {
      doc: {
        nodeAt: vi.fn(() => ({
          attrs: { language: options.language ?? 'mermaid' },
          nodeSize: source.length + 2,
          textContent: source,
          type: { name: 'code_block' },
        })),
      },
      schema: { text: schemaText },
      tr: transaction,
    },
  };
  return {
    dispatch,
    replaceWith,
    schemaText,
    setEditable: (editable: boolean) => {
      view.editable = editable;
    },
    view: view as never,
  };
}
