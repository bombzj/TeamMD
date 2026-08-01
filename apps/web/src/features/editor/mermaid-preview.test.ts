import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMermaidPreviewRenderer,
  mermaidPreviewLimits,
  sanitizeMermaidSvg,
} from './mermaid-preview.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Mermaid preview renderer', () => {
  it('renders only exact Mermaid fences and sanitizes derived SVG', async () => {
    vi.useFakeTimers();
    const render = vi.fn().mockResolvedValue({
      svg: '<svg><script>bad()</script><text>Safe</text></svg>',
    });
    const sanitizeSvg = vi.fn(() => '<svg><text>Safe</text></svg>');
    const renderer = createRenderer(render, sanitizeSvg);
    const applyPreview = vi.fn();

    expect(
      renderer.renderPreview('Mermaid', 'graph TD', applyPreview),
    ).toBeNull();
    expect(
      renderer.renderPreview('typescript', 'graph TD', applyPreview),
    ).toBeNull();
    renderer.renderPreview('mermaid', 'graph TD; A-->B', applyPreview);
    await vi.advanceTimersByTimeAsync(mermaidPreviewLimits.updateDebounceMs);

    expect(render).toHaveBeenCalledWith(
      expect.stringMatching(/^teammd-mermaid-/u),
      'graph TD; A-->B',
    );
    expect(sanitizeSvg).toHaveBeenCalledWith(
      '<svg><script>bad()</script><text>Safe</text></svg>',
    );
    expect(applyPreview).toHaveBeenLastCalledWith(
      '<svg><text>Safe</text></svg>',
    );
  });

  it('removes active content, links, HTML, and injected styles from SVG', () => {
    const sanitized = sanitizeMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <style>@import url(https://example.com/tracker.css)</style>
        <script>alert(1)</script>
        <a href="https://example.com"><text style="fill:red">Link</text></a>
        <foreignObject><div>HTML</div></foreignObject>
        <rect onload="alert(1)" width="10" height="10" />
      </svg>
    `);

    expect(sanitized).toContain('<rect');
    expect(sanitized).not.toMatch(
      /<style|<script|<a|foreignObject|href=|style=|onload=/u,
    );
  });

  it('preserves only sanitized same-document SVG references', () => {
    const sanitized = sanitizeMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220.2 72.4" width="100%">
        <defs>
          <marker id="arrowhead"><path d="M0 0 L10 5 L0 10z" /></marker>
        </defs>
        <line marker-end="url(#arrowhead)" />
        <line marker-end="url(https://example.test/marker.svg#arrowhead)" />
      </svg>
    `);

    expect(sanitized).toContain('id="user-content-arrowhead"');
    expect(sanitized).toContain('marker-end="url(#user-content-arrowhead)"');
    expect(sanitized).toContain('width="221"');
    expect(sanitized).not.toContain('width="100%"');
    expect(sanitized).not.toContain('example.test');
  });

  it('removes only consecutive duplicate Gantt tick labels', () => {
    const sanitized = sanitizeMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" aria-roledescription="gantt">
        <g class="grid">
          <g class="tick"><line /><text>2026-08-01</text></g>
          <g class="tick"><line /><text>2026-08-01</text></g>
          <g class="tick"><line /><text>2026-08-02</text></g>
        </g>
      </svg>
    `);
    const root = new DOMParser().parseFromString(
      sanitized,
      'image/svg+xml',
    ).documentElement;

    expect(root.querySelectorAll('.tick')).toHaveLength(3);
    expect(
      [...root.querySelectorAll('.tick text')].map((label) =>
        label.textContent?.trim(),
      ),
    ).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('rejects oversized diagrams without loading Mermaid', () => {
    const loadMermaid = vi.fn();
    const renderer = createMermaidPreviewRenderer({ loadMermaid });
    const applyPreview = vi.fn<(value: null | string | HTMLElement) => void>();

    renderer.renderPreview(
      'mermaid',
      'x'.repeat(mermaidPreviewLimits.maxSourceBytes + 1),
      applyPreview,
    );

    expect(loadMermaid).not.toHaveBeenCalled();
    const error = applyPreview.mock.calls[0]?.[0] ?? null;
    expect(error).toBeInstanceOf(HTMLElement);
    expect((error as HTMLElement).textContent).toContain('64 KiB');
  });

  it('rejects diagrams over the nonblank-line limit', () => {
    const loadMermaid = vi.fn();
    const renderer = createMermaidPreviewRenderer({ loadMermaid });
    const applyPreview = vi.fn<(value: null | string | HTMLElement) => void>();

    renderer.renderPreview(
      'mermaid',
      Array.from(
        { length: mermaidPreviewLimits.maxNonblankLines + 1 },
        (_, index) => `node${index}`,
      ).join('\n'),
      applyPreview,
    );

    expect(loadMermaid).not.toHaveBeenCalled();
    expect(
      (applyPreview.mock.calls[0]?.[0] as HTMLElement).textContent,
    ).toContain('500 nonblank lines');
  });

  it('ignores stale renders after rapid source updates', async () => {
    vi.useFakeTimers();
    const render = vi.fn().mockResolvedValue({ svg: '<svg>latest</svg>' });
    const renderer = createRenderer(render);
    const applyPreview = vi.fn();

    renderer.renderPreview('mermaid', 'graph TD; A-->B', applyPreview);
    renderer.renderPreview('mermaid', 'graph TD; A-->C', applyPreview);
    await vi.advanceTimersByTimeAsync(mermaidPreviewLimits.updateDebounceMs);

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(expect.any(String), 'graph TD; A-->C');
    expect(applyPreview).toHaveBeenCalledOnce();
  });

  it('reports bounded errors without exposing Mermaid source', async () => {
    vi.useFakeTimers();
    const render = vi
      .fn()
      .mockRejectedValue(new Error('secret diagram source'));
    const renderer = createRenderer(render);
    const applyPreview = vi.fn();

    renderer.renderPreview('mermaid', 'secret diagram source', applyPreview);
    await vi.advanceTimersByTimeAsync(mermaidPreviewLimits.updateDebounceMs);

    const error = applyPreview.mock.calls[0]?.[0] as HTMLElement;
    expect(error.getAttribute('role')).toBe('status');
    expect(error.textContent).toContain('could not be rendered');
    expect(error.textContent).not.toContain('secret diagram source');
  });

  it('reports a timeout without releasing the render slot', async () => {
    vi.useFakeTimers();
    const pending: Array<(value: { svg: string }) => void> = [];
    const render = vi.fn(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          pending.push(resolve);
        }),
    );
    const renderer = createRenderer(render);
    const firstPreview = vi.fn();
    const secondPreview = vi.fn();

    renderer.renderPreview('mermaid', 'graph TD; A-->B', firstPreview);
    renderer.renderPreview('mermaid', 'graph TD; C-->D', secondPreview);
    await vi.advanceTimersByTimeAsync(
      mermaidPreviewLimits.updateDebounceMs +
        mermaidPreviewLimits.renderTimeoutMs,
    );

    expect(render).toHaveBeenCalledOnce();
    expect(
      (firstPreview.mock.calls[0]?.[0] as HTMLElement).textContent,
    ).toContain('took too long');
    expect(secondPreview).not.toHaveBeenCalled();

    pending.shift()?.({ svg: '<svg>late</svg>' });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    renderer.destroy();
    pending.shift()?.({ svg: '<svg>second</svg>' });
  });

  it('serializes renders and ignores results after destroy', async () => {
    vi.useFakeTimers();
    const pending: Array<(value: { svg: string }) => void> = [];
    let active = 0;
    let maximumActive = 0;
    const render = vi.fn(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          pending.push((value) => {
            active -= 1;
            resolve(value);
          });
        }),
    );
    const renderer = createRenderer(render);
    const previews = [vi.fn(), vi.fn(), vi.fn()];

    previews.forEach((applyPreview, index) =>
      renderer.renderPreview('mermaid', `graph TD; A-->${index}`, applyPreview),
    );
    await vi.advanceTimersByTimeAsync(mermaidPreviewLimits.updateDebounceMs);
    expect(maximumActive).toBe(mermaidPreviewLimits.maxConcurrentRenders);
    expect(render).toHaveBeenCalledOnce();

    pending.shift()?.({ svg: '<svg>first</svg>' });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    pending.shift()?.({ svg: '<svg>second</svg>' });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(3));

    const callsBeforeDestroy = previews.map(
      (applyPreview) => applyPreview.mock.calls.length,
    );
    renderer.destroy();
    pending.forEach((resolve) => resolve({ svg: '<svg>late</svg>' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(
      previews.map((applyPreview) => applyPreview.mock.calls.length),
    ).toEqual(callsBeforeDestroy);
  });
});

function createRenderer(
  render: ReturnType<typeof vi.fn>,
  sanitizeSvg: (svg: string) => string = (svg) => svg,
) {
  return createMermaidPreviewRenderer({
    loadMermaid: () => Promise.resolve({ initialize: vi.fn(), render }),
    sanitizeSvg,
  });
}
