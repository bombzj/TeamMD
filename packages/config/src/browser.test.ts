import { describe, expect, it } from 'vitest';

import { parseBrowserConfig } from './browser.js';

describe('browser config', () => {
  it('enables Mermaid rendering by default', () => {
    expect(parseBrowserConfig({})).toEqual({ mermaidRenderingEnabled: true });
  });

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('parses an explicit Mermaid rendering flag', (value, enabled) => {
    expect(
      parseBrowserConfig({ VITE_MERMAID_RENDERING_ENABLED: value }),
    ).toEqual({ mermaidRenderingEnabled: enabled });
  });

  it('rejects ambiguous public flag values', () => {
    expect(() =>
      parseBrowserConfig({ VITE_MERMAID_RENDERING_ENABLED: '1' }),
    ).toThrow();
  });
});
