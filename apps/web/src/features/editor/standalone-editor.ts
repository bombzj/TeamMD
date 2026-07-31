import { Crepe } from '@milkdown/crepe';

import type { CollaborativeEditor } from './collaborative-editor.js';

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
  const editor = new Crepe({
    root: options.editorHost,
    defaultValue: options.content,
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.TopBar]: true,
    },
  });
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
    prepareCheckpoint: () => Promise.resolve(),
    destroy: () => void editor.destroy(),
  };
}
