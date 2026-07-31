export function runHistoryShortcut(
  editorHost: HTMLElement,
  direction: 'undo' | 'redo',
): boolean {
  const editor = editorHost.querySelector<HTMLElement>('.ProseMirror');
  if (editor === null || editor.getAttribute('contenteditable') === 'false') {
    return false;
  }
  editor.focus();
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return !editor.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: !isMac,
      metaKey: isMac,
      shiftKey: direction === 'redo',
    }),
  );
}
