import { describe, expect, it } from 'vitest';

import { katexSourceLimit, renderKatex } from './katex-renderer.js';

describe('KaTeX renderer', () => {
  it('renders inline and display formulas with accessible MathML', () => {
    const inline = renderKatex('E = mc^2', false);
    const display = renderKatex(
      String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`,
      true,
    );

    expect(inline.classList.contains('teammd-katex-inline')).toBe(true);
    expect(inline.querySelector('math')).toBeTruthy();
    expect(display.classList.contains('teammd-katex-display')).toBe(true);
    expect(display.querySelector('.katex-display')).toBeTruthy();
  });

  it('supports the local mhchem extension without remote scripts', () => {
    const rendered = renderKatex(String.raw`\ce{H2O + CO2 -> H2CO3}`, false);

    expect(rendered.textContent).toContain('H');
    expect(rendered.innerHTML).not.toContain('cdn');
  });

  it('keeps invalid formulas local and non-executable', () => {
    const rendered = renderKatex(
      String.raw`\href{javascript:alert(1)}{unsafe}`,
      false,
    );

    expect(rendered.querySelector('a')).toBeNull();
    expect(rendered.querySelector('[href]')).toBeNull();
    expect(rendered.textContent).toContain('\\href');
  });

  it('rejects formulas beyond the bounded source limit', () => {
    const rendered = renderKatex('x'.repeat(katexSourceLimit + 1), false);

    expect(rendered.getAttribute('role')).toBe('status');
    expect(rendered.textContent).toContain('64 KiB');
  });
});
