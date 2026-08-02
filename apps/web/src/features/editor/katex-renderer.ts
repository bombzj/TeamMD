import katex, { type KatexOptions } from 'katex';
import 'katex/contrib/mhchem';

export const katexSourceLimit = 64 * 1024;

export const teamMdKatexOptions = {
  strict: 'error',
  throwOnError: false,
  trust: false,
} as const satisfies KatexOptions;

export function renderKatex(source: string, displayMode: boolean): HTMLElement {
  const output = document.createElement(displayMode ? 'div' : 'span');
  output.className = displayMode
    ? 'teammd-katex teammd-katex-display'
    : 'teammd-katex teammd-katex-inline';
  if (new TextEncoder().encode(source).byteLength > katexSourceLimit) {
    output.className = 'teammd-katex-error';
    output.setAttribute('role', 'status');
    output.textContent =
      'This formula is larger than the 64 KiB preview limit.';
    return output;
  }
  katex.render(source, output, {
    ...teamMdKatexOptions,
    displayMode,
    output: 'htmlAndMathml',
  });
  return output;
}
