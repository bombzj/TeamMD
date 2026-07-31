import { Crepe, type CrepeConfig } from '@milkdown/crepe';

const topBarControlNames = [
  'Text style',
  'Bold',
  'Italic',
  'Strikethrough',
  'Inline code',
  'Bullet list',
  'Numbered list',
  'Task list',
  'Link',
  'Table',
  'Code block',
  'Blockquote',
  'Horizontal rule',
] as const;

const selectionToolbarControlNames = [
  'Bold',
  'Italic',
  'Strikethrough',
  'Inline code',
  'Link',
] as const;

const tableColumnControlNames = [
  'Align column left',
  'Align column center',
  'Align column right',
  'Delete column',
] as const;

export const editorFeatureProfile = {
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
} satisfies NonNullable<CrepeConfig['features']>;

export function createTeamMdEditor(
  root: HTMLElement,
  defaultValue?: string,
): Crepe {
  const editor = new Crepe({
    root,
    features: editorFeatureProfile,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });
  const disconnectAccessibility = enhanceEditorAccessibility(root);
  const destroy = editor.destroy.bind(editor);
  editor.destroy = async () => {
    disconnectAccessibility();
    return await destroy();
  };
  return editor;
}

export function enhanceEditorAccessibility(root: HTMLElement): () => void {
  const enhance = () => {
    labelControls(
      root.querySelectorAll<HTMLButtonElement>(
        '.milkdown-top-bar .top-bar-heading-button, .milkdown-top-bar .top-bar-item',
      ),
      topBarControlNames,
    );
    labelControls(
      root.querySelectorAll<HTMLButtonElement>(
        '.milkdown-toolbar .toolbar-item',
      ),
      selectionToolbarControlNames,
    );
    labelControls(
      root.querySelectorAll<HTMLButtonElement>(
        '.milkdown-table-block [data-role="col-drag-handle"] .button-group button',
      ),
      tableColumnControlNames,
    );
    labelControls(
      root.querySelectorAll<HTMLButtonElement>(
        '.milkdown-table-block [data-role="row-drag-handle"] .button-group button',
      ),
      ['Delete row'],
    );
    labelNativeControl(
      root.querySelector<HTMLButtonElement>(
        '.milkdown-table-block [data-role="x-line-drag-handle"] .add-button',
      ),
      'Add row',
    );
    labelNativeControl(
      root.querySelector<HTMLButtonElement>(
        '.milkdown-table-block [data-role="y-line-drag-handle"] .add-button',
      ),
      'Add column',
    );
    labelNativeControl(
      root.querySelector<HTMLButtonElement>(
        '.milkdown-code-block .language-button',
      ),
      'Code language',
    );
    labelNativeControl(
      root.querySelector<HTMLButtonElement>(
        '.milkdown-code-block .preview-toggle-button',
      ),
      'Toggle code preview',
    );
  };
  const observer = new MutationObserver(enhance);
  observer.observe(root, { childList: true, subtree: true });
  enhance();
  return () => observer.disconnect();
}

function labelControls(
  controls: NodeListOf<HTMLButtonElement>,
  names: readonly string[],
) {
  controls.forEach((control, index) => {
    const name = names[index];
    if (name === undefined) return;
    labelNativeControl(control, name);
    if (control.dataset.keyboardActivation === 'true') return;
    control.dataset.keyboardActivation = 'true';
    control.addEventListener('keydown', activateWithKeyboard);
  });
}

function labelNativeControl(control: HTMLButtonElement | null, name: string) {
  if (control === null) return;
  control.setAttribute('aria-label', name);
  control.title = name;
}

function activateWithKeyboard(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.currentTarget?.dispatchEvent(
    new Event('pointerdown', { bubbles: true, cancelable: true }),
  );
}
