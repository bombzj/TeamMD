import { Crepe } from '@milkdown/crepe';
import {
  addBlockTypeCommand,
  codeBlockSchema,
} from '@milkdown/kit/preset/commonmark';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  editorCodeLanguages,
  editorBlockEditConfig,
  editorFeatureProfile,
  editorLatexConfig,
  editorTopBarConfig,
  enhanceEditorAccessibility,
  mermaidStarterSource,
} from './editor-feature-profile.js';

describe('editor feature profile', () => {
  it('offers Mermaid as the exact source-preserving code language', () => {
    expect(editorCodeLanguages[0]?.name).toBe('mermaid');
    expect(editorCodeLanguages[0]?.alias).toContain('mermaid');
    expect(editorCodeLanguages.length).toBeGreaterThan(1);
  });

  it('offers first-class Diagram controls that insert canonical Mermaid source', () => {
    const menuItem = captureAddedItem(editorBlockEditConfig.buildMenu);
    const topBarItem = captureAddedItem(editorTopBarConfig.buildTopBar);
    const call = vi.fn();
    const ctx = { get: vi.fn(() => ({ call })) };
    const diagramNode = {};
    const codeBlock = {
      create: vi.fn(() => diagramNode),
      schema: { text: vi.fn(() => 'starter-text') },
    };
    vi.spyOn(codeBlockSchema, 'type').mockReturnValue(codeBlock as never);

    menuItem.onRun?.(ctx as never);
    topBarItem.onRun?.(ctx as never);

    expect(menuItem.label).toBe('Diagram');
    expect(topBarItem.active?.(ctx as never)).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(1, addBlockTypeCommand.key, {
      nodeType: diagramNode,
    });
    expect(call).toHaveBeenNthCalledWith(2, addBlockTypeCommand.key, {
      nodeType: diagramNode,
    });
    expect(codeBlock.schema.text).toHaveBeenCalledWith(mermaidStarterSource);
    expect(codeBlock.create).toHaveBeenCalledWith(
      { language: 'mermaid' },
      'starter-text',
    );
  });

  it('enables local KaTeX rendering while keeping unplanned features disabled', () => {
    expect(editorFeatureProfile).toEqual({
      [Crepe.Feature.BlockEdit]: true,
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.Placeholder]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Toolbar]: true,
      [Crepe.Feature.TopBar]: true,
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.Latex]: true,
    });
    expect(editorLatexConfig).toEqual({
      katexOptions: {
        strict: 'error',
        throwOnError: false,
        trust: false,
      },
    });
  });

  it('is shared by collaborative and standalone editor adapters', async () => {
    const [collaborativeSource, standaloneSource] = await Promise.all([
      readFile(
        resolve(process.cwd(), 'src/features/editor/collaborative-editor.ts'),
        'utf8',
      ),
      readFile(
        resolve(process.cwd(), 'src/features/editor/standalone-editor.ts'),
        'utf8',
      ),
    ]);

    expect(collaborativeSource).toContain(
      'createTeamMdEditor(options.editorHost)',
    );
    expect(standaloneSource).toContain(
      'createTeamMdEditor(options.editorHost, options.content)',
    );
    expect(collaborativeSource).not.toContain('new Crepe(');
    expect(standaloneSource).not.toContain('new Crepe(');
  });

  it('labels rich controls and makes pointer-only actions keyboard accessible', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="milkdown-top-bar">
        <button class="top-bar-heading-button"></button>
        <button class="top-bar-item"></button>
        <button class="top-bar-item"></button>
      </div>
    `;
    const disconnect = enhanceEditorAccessibility(root);
    const controls = root.querySelectorAll<HTMLButtonElement>('button');
    const boldPointerDown = vi.fn();
    controls[1]?.addEventListener('pointerdown', boldPointerDown);

    expect([...controls].map((control) => control.ariaLabel)).toEqual([
      'Text style',
      'Bold',
      'Italic',
    ]);
    expect([...controls].map((control) => control.title)).toEqual([
      'Text style',
      'Bold',
      'Italic',
    ]);

    controls[1]?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );
    expect(boldPointerDown).toHaveBeenCalledOnce();

    const toolbar = document.createElement('div');
    toolbar.className = 'milkdown-toolbar';
    toolbar.innerHTML = '<button class="toolbar-item"></button>';
    root.append(toolbar);
    await Promise.resolve();
    expect(toolbar.querySelector('button')?.ariaLabel).toBe('Bold');

    disconnect();
  });

  it('makes block and link actions semantic keyboard controls', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="milkdown-block-handle">
        <div class="operation-item"></div>
        <div class="operation-item"></div>
      </div>
      <div class="milkdown-link-preview">
        <span class="link-icon"></span>
        <span class="link-edit-button"></span>
        <span class="link-remove-button"></span>
      </div>
      <div class="milkdown-link-edit">
        <input class="input-area" />
        <span class="confirm"></span>
      </div>
    `;
    const pointerEvents = vi.fn();
    root.addEventListener('pointerdown', pointerEvents);
    root.addEventListener('pointerup', pointerEvents);

    const disconnect = enhanceEditorAccessibility(root);
    const controls = root.querySelectorAll<HTMLElement>('[role="button"]');

    expect([...controls].map((control) => control.ariaLabel)).toEqual([
      'Add block',
      'Copy link',
      'Edit link',
      'Remove link',
      'Confirm link',
    ]);
    expect([...controls].map((control) => control.tabIndex)).toEqual([
      0, 0, 0, 0, 0,
    ]);
    const linkInput = root.querySelector<HTMLInputElement>('.input-area');
    expect(linkInput?.ariaLabel).toBe('Link URL');
    expect(linkInput?.name).toBe('link-url');

    controls[0]?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );
    controls[1]?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: ' ' }),
    );
    expect(pointerEvents).toHaveBeenCalledTimes(4);

    disconnect();
  });

  it('makes the code language picker accessible by keyboard', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="milkdown-code-block">
        <div class="language-picker">
          <input class="search-input" />
          <div class="clear-icon"></div>
          <ul class="language-list" role="listbox">
            <li class="language-list-item" role="listitem" tabindex="0" data-language="typescript">
              TypeScript
            </li>
          </ul>
        </div>
      </div>
    `;
    const clear = root.querySelector<HTMLElement>('.clear-icon');
    const mouseDown = vi.fn();
    clear?.addEventListener('mousedown', mouseDown);

    const disconnect = enhanceEditorAccessibility(root);

    expect(
      root.querySelector('.search-input')?.getAttribute('aria-label'),
    ).toBe('Search code languages');
    expect(clear?.getAttribute('role')).toBe('button');
    expect(clear?.getAttribute('aria-label')).toBe('Clear language search');
    expect(clear?.tabIndex).toBe(0);
    expect(
      root.querySelector('.language-list-item')?.getAttribute('role'),
    ).toBe('option');

    clear?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );
    expect(mouseDown).toHaveBeenCalledOnce();

    disconnect();
  });
});

function captureAddedItem(
  build:
    | typeof editorBlockEditConfig.buildMenu
    | typeof editorTopBarConfig.buildTopBar,
) {
  const addItem = vi.fn();
  build({
    getGroup: vi.fn(() => ({ addItem })),
  } as never);
  return addItem.mock.calls[0]?.[1] as {
    active?: (ctx: never) => boolean;
    label?: string;
    onRun?: (ctx: never) => void;
  };
}
