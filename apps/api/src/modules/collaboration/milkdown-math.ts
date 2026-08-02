import type { Node } from '@milkdown/transformer';
import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import { codeBlockSchema } from '@milkdown/preset-commonmark';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';

const mathInlineId = 'math_inline';

export const remarkMathPlugin = $remark<'remarkMath', undefined>(
  'remarkMath',
  () => remarkMath,
);

export const remarkMathBlockPlugin = $remark(
  'remarkMathBlock',
  () => () => (tree: Node) => {
    visit(
      tree,
      'math',
      (
        node: Node & { value: string },
        index: number | undefined,
        parent: (Node & { children: Node[] }) | undefined,
      ) => {
        if (index === undefined || parent === undefined) return;
        parent.children.splice(index, 1, {
          type: 'code',
          lang: 'LaTeX',
          value: node.value,
        } as Node);
      },
    );
  },
);

export const mathInlineSchema = $nodeSchema(mathInlineId, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [
    {
      tag: `span[data-type="${mathInlineId}"]`,
      getAttrs: (dom: HTMLElement) => ({ value: dom.dataset.value ?? '' }),
    },
  ],
  toDOM: (node) => {
    const value: unknown = node.attrs.value;
    return [
      'span',
      {
        'data-type': mathInlineId,
        'data-value': typeof value === 'string' ? value : '',
      },
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === mathInlineId,
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.attrs.value as string);
    },
  },
}));

export const blockLatexSchema = codeBlockSchema.extendSchema((previous) => {
  return (context) => {
    const baseSchema = previous(context);
    return {
      ...baseSchema,
      toMarkdown: {
        match: baseSchema.toMarkdown.match,
        runner: (state, node) => {
          const language = (node.attrs.language as string | null) ?? '';
          if (language.toLowerCase() === 'latex') {
            state.addNode('math', undefined, node.textContent);
            return;
          }
          baseSchema.toMarkdown.runner(state, node);
        },
      },
    };
  };
});
