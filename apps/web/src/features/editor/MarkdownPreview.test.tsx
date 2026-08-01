import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  browserConfig: { mermaidRenderingEnabled: true },
  destroy: vi.fn(),
  preview: vi.fn(),
  renderPreview: vi.fn(),
}));

vi.mock('../../lib/browser-config.js', () => ({
  browserConfig: mocks.browserConfig,
}));

vi.mock('vditor', () => ({
  default: { preview: mocks.preview },
}));

vi.mock('./mermaid-preview.js', () => ({
  createMermaidPreviewRenderer: () => ({
    destroy: mocks.destroy,
    renderPreview: mocks.renderPreview,
  }),
}));

import { MarkdownPreview } from './MarkdownPreview.js';

afterEach(() => {
  cleanup();
  mocks.browserConfig.mermaidRenderingEnabled = true;
  vi.clearAllMocks();
});

describe('MarkdownPreview', () => {
  it('routes exact Mermaid fences through the bounded read-only renderer', async () => {
    mocks.preview.mockImplementation(
      (
        host: HTMLElement,
        _content: string,
        options: { transform: (html: string) => string },
      ) => {
        host.innerHTML = options.transform(`
          <pre><code class="language-mermaid">flowchart LR\n  Start --&gt; Done</code></pre>
          <pre><code class="language-typescript">const value = 1;</code></pre>
        `);
        return Promise.resolve();
      },
    );
    mocks.renderPreview.mockImplementation(
      (
        _language: string,
        _source: string,
        applyPreview: (value: HTMLElement) => void,
      ) => {
        const preview = document.createElement('div');
        preview.textContent = 'Rendered diagram';
        applyPreview(preview);
      },
    );

    const { container } = render(
      <MarkdownPreview
        content={'```mermaid\nflowchart LR\n  Start --> Done\n```'}
      />,
    );

    expect(await screen.findByText('Rendered diagram')).toBeTruthy();
    expect(mocks.renderPreview).toHaveBeenCalledWith(
      'mermaid',
      'flowchart LR\n  Start --> Done',
      expect.any(Function),
    );
    expect(container.querySelector('.language-mermaid')).toBeNull();
    expect(container.querySelector('.language-typescript')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not mount a stale detached Vditor result', async () => {
    const completions: Array<() => void> = [];
    mocks.preview.mockImplementation(
      (host: HTMLElement, content: string) =>
        new Promise<void>((resolve) => {
          host.textContent = content;
          completions.push(resolve);
        }),
    );

    const { rerender } = render(<MarkdownPreview content="Old revision" />);
    rerender(<MarkdownPreview content="Current revision" />);

    completions[1]?.();
    expect(await screen.findByText('Current revision')).toBeTruthy();
    completions[0]?.();
    await waitFor(() => expect(screen.queryByText('Old revision')).toBeNull());
  });

  it('keeps sanitized Mermaid source visible when rendering is disabled', async () => {
    mocks.browserConfig.mermaidRenderingEnabled = false;
    mocks.preview.mockImplementation(
      (
        host: HTMLElement,
        _content: string,
        options: { transform: (html: string) => string },
      ) => {
        host.innerHTML = options.transform(
          '<pre><code class="language-mermaid">flowchart LR\n  Start --&gt; Done</code></pre>',
        );
        return Promise.resolve();
      },
    );

    const { container } = render(
      <MarkdownPreview
        content={'```mermaid\nflowchart LR\n  Start --> Done\n```'}
      />,
    );

    expect(await screen.findByText(/flowchart LR/u)).toBeTruthy();
    expect(container.querySelector('code.language-mermaid')).toBeTruthy();
    expect(container.querySelector('.static-mermaid-preview')).toBeNull();
    expect(mocks.renderPreview).not.toHaveBeenCalled();
  });

  it('keeps the surrounding document available when a diagram is invalid', async () => {
    mocks.preview.mockImplementation(
      (
        host: HTMLElement,
        _content: string,
        options: { transform: (html: string) => string },
      ) => {
        host.innerHTML = options.transform(`
          <p>Before diagram</p>
          <pre><code class="language-mermaid">not valid</code></pre>
          <p>After diagram</p>
        `);
        return Promise.resolve();
      },
    );
    mocks.renderPreview.mockImplementation(
      (
        _language: string,
        _source: string,
        applyPreview: (value: HTMLElement) => void,
      ) => {
        const error = document.createElement('div');
        error.setAttribute('role', 'status');
        error.textContent = 'This diagram could not be rendered.';
        applyPreview(error);
      },
    );

    render(<MarkdownPreview content="invalid diagram" />);

    expect(await screen.findByText('Before diagram')).toBeTruthy();
    expect(
      screen.getByText('This diagram could not be rendered.'),
    ).toBeTruthy();
    expect(screen.getByText('After diagram')).toBeTruthy();
  });

  it('destroys pending derived renders when content changes or unmounts', async () => {
    mocks.preview.mockResolvedValue(undefined);

    const { rerender, unmount } = render(
      <MarkdownPreview content="Revision one" />,
    );
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
    rerender(<MarkdownPreview content="Revision two" />);
    await waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
    unmount();

    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
});
