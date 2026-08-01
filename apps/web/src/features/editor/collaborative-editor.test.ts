import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('collaborative editor rendering', () => {
  it('binds Milkdown and styles local selections and remote identities', async () => {
    const globalStyles = await readFile(
      resolve(process.cwd(), 'src/styles/global.css'),
      'utf8',
    );
    const editorSource = await readFile(
      resolve(process.cwd(), 'src/features/editor/collaborative-editor.ts'),
      'utf8',
    );
    const featureProfileSource = await readFile(
      resolve(process.cwd(), 'src/features/editor/editor-feature-profile.ts'),
      'utf8',
    );
    const mainSource = await readFile(
      resolve(process.cwd(), 'src/main.tsx'),
      'utf8',
    );

    expect(editorSource).toContain("getXmlFragment('milkdown')");
    expect(editorSource).toContain('.bindXmlFragment(');
    expect(editorSource).not.toContain('mermaid');
    expect(featureProfileSource).toContain(
      'renderPreview: mermaidPreview.renderPreview',
    );
    expect(mainSource).toContain(
      "import '@milkdown/crepe/theme/common/style.css';",
    );
    expect(mainSource.indexOf('theme/common/style.css')).toBeLessThan(
      mainSource.indexOf('theme/classic.css'),
    );
    expect(globalStyles).toContain('.milkdown-host .ProseMirror ::selection');
    expect(globalStyles).toContain('background: #9bc9e9');
    expect(globalStyles).toContain('.milkdown-host .ProseMirror-yjs-cursor {');
    expect(globalStyles).toContain(
      '.milkdown-host .ProseMirror-yjs-cursor > div {',
    );
    const editorShellRule = globalStyles.match(
      /\.document-editor-shell \{(?<declarations>[^}]*)\}/u,
    )?.groups?.declarations;
    expect(editorShellRule).toContain('display: block;');
    expect(editorShellRule).not.toContain('grid-template-rows');
  });
});
