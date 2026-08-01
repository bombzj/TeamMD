import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from '@codemirror/language';
import { languages as codeMirrorLanguages } from '@codemirror/language-data';
import { Crepe, type CrepeConfig } from '@milkdown/crepe';
import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import type { TopBarFeatureConfig } from '@milkdown/crepe/feature/top-bar';
import { commandsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  addBlockTypeCommand,
  codeBlockSchema,
} from '@milkdown/kit/preset/commonmark';

import { createMermaidPreviewRenderer } from './mermaid-preview.js';

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
  'Diagram',
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

const mermaidLanguage = LanguageDescription.of({
  name: 'mermaid',
  alias: ['mermaid'],
  support: new LanguageSupport(
    StreamLanguage.define({
      token(stream) {
        stream.skipToEnd();
        return null;
      },
    }),
  ),
});

export const editorCodeLanguages = [mermaidLanguage, ...codeMirrorLanguages];

const diagramIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <rect x="3" y="4" width="6" height="5" rx="1" />
    <rect x="15" y="15" width="6" height="5" rx="1" />
    <path d="M9 6.5h3a4 4 0 0 1 4 4V15M13 12l3 3 3-3" fill="none" stroke="currentColor" stroke-width="2" />
  </svg>
`;

export const mermaidStarterSource = 'flowchart LR\n  Start --> Done';

export const editorBlockEditConfig = {
  buildMenu: (builder) => {
    builder.getGroup('advanced').addItem('diagram', {
      label: 'Diagram',
      icon: diagramIcon,
      onRun: insertMermaidDiagram,
    });
  },
} satisfies BlockEditFeatureConfig;

export const editorTopBarConfig = {
  buildTopBar: (builder) => {
    builder.getGroup('block').addItem('diagram', {
      icon: diagramIcon,
      active: () => false,
      onRun: insertMermaidDiagram,
    });
  },
} satisfies TopBarFeatureConfig;

function insertMermaidDiagram(ctx: Ctx): void {
  const commands = ctx.get(commandsCtx);
  const codeBlock = codeBlockSchema.type(ctx);
  commands.call(addBlockTypeCommand.key, {
    nodeType: codeBlock.create(
      { language: 'mermaid' },
      codeBlock.schema.text(mermaidStarterSource),
    ),
  });
}

export function createTeamMdEditor(
  root: HTMLElement,
  defaultValue?: string,
): Crepe {
  const mermaidPreview = createMermaidPreviewRenderer();
  const editor = new Crepe({
    root,
    features: editorFeatureProfile,
    featureConfigs: {
      [Crepe.Feature.BlockEdit]: editorBlockEditConfig,
      [Crepe.Feature.CodeMirror]: {
        languages: editorCodeLanguages,
        previewLabel: 'Diagram preview',
        renderLanguage: (language) =>
          language === 'mermaid' ? 'Mermaid' : language,
        renderPreview: mermaidPreview.renderPreview,
      },
      [Crepe.Feature.TopBar]: editorTopBarConfig,
    },
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });
  const disconnectAccessibility = enhanceEditorAccessibility(root);
  const destroy = editor.destroy.bind(editor);
  editor.destroy = async () => {
    disconnectAccessibility();
    mermaidPreview.destroy();
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
    labelPointerControl(
      root.querySelector<HTMLElement>(
        '.milkdown-block-handle .operation-item:first-child',
      ),
      'Add block',
    );
    labelPointerControl(
      root.querySelector<HTMLElement>('.milkdown-link-preview .link-icon'),
      'Copy link',
    );
    labelPointerControl(
      root.querySelector<HTMLElement>(
        '.milkdown-link-preview .link-edit-button',
      ),
      'Edit link',
    );
    labelPointerControl(
      root.querySelector<HTMLElement>(
        '.milkdown-link-preview .link-remove-button',
      ),
      'Remove link',
    );
    labelPointerControl(
      root.querySelector<HTMLElement>('.milkdown-link-edit .confirm'),
      'Confirm link',
    );
    labelNativeControl(
      root.querySelector<HTMLInputElement>(
        '.milkdown-code-block .language-picker .search-input',
      ),
      'Search code languages',
    );
    labelMouseControl(
      root.querySelector<HTMLElement>(
        '.milkdown-code-block .language-picker .clear-icon',
      ),
      'Clear language search',
    );
    root
      .querySelectorAll<HTMLElement>(
        '.milkdown-code-block .language-picker .language-list-item[data-language]',
      )
      .forEach((option) => option.setAttribute('role', 'option'));
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

function labelNativeControl(
  control: HTMLButtonElement | HTMLInputElement | null,
  name: string,
) {
  if (control === null) return;
  control.setAttribute('aria-label', name);
  control.title = name;
}

function labelPointerControl(control: HTMLElement | null, name: string) {
  if (control === null) return;
  control.setAttribute('role', 'button');
  control.tabIndex = 0;
  control.setAttribute('aria-label', name);
  control.title = name;
  if (control.dataset.keyboardActivation === 'true') return;
  control.dataset.keyboardActivation = 'true';
  control.addEventListener('keydown', activatePointerControlWithKeyboard);
}

function labelMouseControl(control: HTMLElement | null, name: string) {
  if (control === null) return;
  control.setAttribute('role', 'button');
  control.tabIndex = 0;
  control.setAttribute('aria-label', name);
  control.title = name;
  if (control.dataset.keyboardActivation === 'true') return;
  control.dataset.keyboardActivation = 'true';
  control.addEventListener('keydown', activateMouseControlWithKeyboard);
}

function activateWithKeyboard(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.currentTarget?.dispatchEvent(
    new Event('pointerdown', { bubbles: true, cancelable: true }),
  );
}

function activatePointerControlWithKeyboard(event: KeyboardEvent) {
  if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
  event.preventDefault();
  const control = event.currentTarget;
  control?.dispatchEvent(
    new Event('pointerdown', { bubbles: true, cancelable: true }),
  );
  control?.dispatchEvent(
    new Event('pointerup', { bubbles: true, cancelable: true }),
  );
}

function activateMouseControlWithKeyboard(event: KeyboardEvent) {
  if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
  event.preventDefault();
  event.currentTarget?.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
  );
}
