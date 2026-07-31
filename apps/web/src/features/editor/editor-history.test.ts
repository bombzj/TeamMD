import { describe, expect, it, vi } from 'vitest';

import { runHistoryShortcut } from './editor-history.js';

describe('editor history controls', () => {
  it('routes undo and redo through the editable ProseMirror keymap', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="ProseMirror" contenteditable="true"></div>';
    const editor = host.querySelector<HTMLElement>('.ProseMirror')!;
    const shortcuts: KeyboardEvent[] = [];
    const focus = vi.spyOn(editor, 'focus');
    editor.addEventListener('keydown', (event) => {
      shortcuts.push(event);
      event.preventDefault();
    });

    expect(runHistoryShortcut(host, 'undo')).toBe(true);
    expect(runHistoryShortcut(host, 'redo')).toBe(true);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(shortcuts).toHaveLength(2);
    expect(shortcuts[0]?.key).toBe('z');
    expect(shortcuts[0]?.shiftKey).toBe(false);
    expect(shortcuts[1]?.shiftKey).toBe(true);
    expect(shortcuts.every((event) => event.ctrlKey || event.metaKey)).toBe(
      true,
    );
  });

  it('does not dispatch history commands to a read-only editor', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="ProseMirror" contenteditable="false"></div>';
    const keydown = vi.fn();
    host.querySelector('.ProseMirror')?.addEventListener('keydown', keydown);

    expect(runHistoryShortcut(host, 'undo')).toBe(false);
    expect(keydown).not.toHaveBeenCalled();
  });
});
