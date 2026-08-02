import {
  Editor,
  parserCtx,
  rootCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/core';
import type { Node, Schema } from '@milkdown/prose/model';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import type { Parser, Serializer } from '@milkdown/transformer';
import globalJsdom from 'global-jsdom';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import * as Y from 'yjs';

import {
  blockLatexSchema,
  mathInlineSchema,
  remarkMathBlockPlugin,
  remarkMathPlugin,
} from './milkdown-math.js';

export const milkdownFragmentName = 'milkdown';

export type MilkdownCodec = {
  createState: (markdown: string) => Uint8Array;
  isSemanticallyEquivalent: (left: string, right: string) => boolean;
  parse: (markdown: string) => Node;
  read: (document: Y.Doc) => string;
  serialize: (document: Node) => string;
  write: (document: Y.Doc, markdown: string) => void;
};

let codecPromise: Promise<MilkdownCodec> | undefined;

export function getMilkdownCodec(): Promise<MilkdownCodec> {
  codecPromise ??= createMilkdownCodec();
  return codecPromise;
}

async function createMilkdownCodec(): Promise<MilkdownCodec> {
  globalJsdom('<!doctype html><div id="milkdown-codec"></div>');
  installWindowEvents();
  const editor = await Editor.make()
    .config((context) => {
      context.set(rootCtx, document.querySelector('#milkdown-codec'));
    })
    .use(commonmark)
    .use(gfm)
    .use(remarkMathPlugin)
    .use(remarkMathBlockPlugin)
    .use(mathInlineSchema)
    .use(blockLatexSchema)
    .create();
  const values = editor.action((context) => ({
    parser: context.get(parserCtx),
    schema: context.get(schemaCtx),
    serializer: context.get(serializerCtx),
  }));
  return buildCodec(values.schema, values.parser, values.serializer);
}

function installWindowEvents(): void {
  const methods = {
    addEventListener: window.addEventListener.bind(window),
    CustomEvent: window.CustomEvent,
    dispatchEvent: window.dispatchEvent.bind(window),
    Event: window.Event,
    EventTarget: window.EventTarget,
    removeEventListener: window.removeEventListener.bind(window),
  };
  for (const [key, value] of Object.entries(methods)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
}

function buildCodec(
  schema: Schema,
  parser: Parser,
  serializer: Serializer,
): MilkdownCodec {
  return {
    createState(markdown) {
      const document = new Y.Doc();
      try {
        write(document, parser(markdown));
        return Y.encodeStateAsUpdate(document);
      } finally {
        document.destroy();
      }
    },
    isSemanticallyEquivalent(left, right) {
      return (
        JSON.stringify(normalizeDefaults(parser(left).toJSON())) ===
        JSON.stringify(normalizeDefaults(parser(right).toJSON()))
      );
    },
    parse: parser,
    read(document) {
      return serializeDocument(
        yXmlFragmentToProseMirrorRootNode(
          document.getXmlFragment(milkdownFragmentName),
          schema,
        ),
      );
    },
    serialize: serializeDocument,
    write(document, markdown) {
      write(document, parser(markdown));
    },
  };

  function write(document: Y.Doc, parsed: Node): void {
    const fragment = document.getXmlFragment(milkdownFragmentName);
    document.transact(() => {
      if (fragment.length > 0) fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(parsed, fragment);
    });
  }

  function serializeDocument(document: Node): string {
    const children: Node[] = [];
    document.forEach((child) => children.push(child));
    while (
      children.at(-1)?.type === schema.nodes.paragraph &&
      children.at(-1)?.content.size === 0
    ) {
      children.pop();
    }
    if (children.length === 0) return '';
    return serializer(document.type.create(document.attrs, children));
  }
}

function normalizeDefaults(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeDefaults);
  if (typeof value !== 'object' || value === null) return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      normalizeDefaults(entry),
    ]),
  );
  if (normalized.alignment === 'left') normalized.alignment = null;
  if (normalized.spread === 'true') normalized.spread = 'false';
  return normalized;
}
