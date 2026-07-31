import type { CollaborativeEditor } from './collaborative-editor.js';
import { createTeamMdEditor } from './editor-feature-profile.js';
import { runHistoryShortcut } from './editor-history.js';

type StandaloneEditorOptions = {
  content: string;
  editorHost: HTMLElement;
  readOnly: boolean;
  onContentChange: (content: string) => void;
};

export async function createStandaloneEditor(
  options: StandaloneEditorOptions,
): Promise<CollaborativeEditor> {
  let currentContent = options.content;
  const editor = createTeamMdEditor(options.editorHost, options.content);
  editor.setReadonly(options.readOnly);
  editor.on((listener) => {
    listener.markdownUpdated((_context, markdown) => {
      if (markdown === currentContent) return;
      currentContent = markdown;
      options.onContentChange(markdown);
    });
  });
  await editor.create();
  editor.setReadonly(options.readOnly);

  return {
    getContent: () => currentContent,
    undo: () => runHistoryShortcut(options.editorHost, 'undo'),
    redo: () => runHistoryShortcut(options.editorHost, 'redo'),
    prepareCheckpoint: () => Promise.resolve(),
    destroy: () => void editor.destroy(),
  };
}
