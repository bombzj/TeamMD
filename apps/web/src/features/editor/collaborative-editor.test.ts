import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('collaborative editor selection styling', () => {
  it('keeps local CodeMirror and native text selections visible', async () => {
    const [editorSource, globalStyles] = await Promise.all([
      readFile(
        resolve(process.cwd(), 'src/features/editor/collaborative-editor.ts'),
        'utf8',
      ),
      readFile(resolve(process.cwd(), 'src/styles/global.css'), 'utf8'),
    ]);

    expect(editorSource).toContain('drawSelection()');
    expect(globalStyles).toContain('.codemirror-host .cm-content ::selection');
    expect(globalStyles).toContain('.cm-selectionBackground');
    expect(globalStyles).toContain('background: #9bc9e9');
    expect(globalStyles).toContain('background: rgba(244, 240, 231, 0.42)');
  });
});
