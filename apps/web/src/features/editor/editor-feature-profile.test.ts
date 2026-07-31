import { Crepe } from '@milkdown/crepe';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  editorFeatureProfile,
  enhanceEditorAccessibility,
} from './editor-feature-profile.js';

describe('editor feature profile', () => {
  it('explicitly enables supported rich editing and disables unplanned features', () => {
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
      [Crepe.Feature.Latex]: false,
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

    controls[0]?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );
    controls[1]?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: ' ' }),
    );
    expect(pointerEvents).toHaveBeenCalledTimes(4);

    disconnect();
  });
});
