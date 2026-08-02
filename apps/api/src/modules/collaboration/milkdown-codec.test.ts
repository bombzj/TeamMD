import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { markdownCompatibilityCorpus } from '@teammd/contracts';

import { getMilkdownCodec } from './milkdown-codec.js';

describe('Milkdown collaboration codec', () => {
  it.each(markdownCompatibilityCorpus)(
    'round-trips $name through a Y.XmlFragment',
    async ({ markdown, mathSources, mermaidSources }) => {
      const codec = await getMilkdownCodec();
      const state = codec.createState(markdown);
      const document = new Y.Doc();
      Y.applyUpdate(document, state);

      const serialized = codec.read(document);

      expect(codec.isSemanticallyEquivalent(serialized, markdown)).toBe(true);
      expect(codec.serialize(codec.parse(serialized))).toBe(serialized);
      expect(serialized).toContain('# Rendered editing');
      expect(serialized).toContain('**bold**');
      expect(serialized).toContain('[x] Complete');
      expect(serialized).toContain('Nested detail');
      expect(serialized).toContain('---');
      expect(serialized).toContain('Collaboration');
      expect(serialized).toContain('Working');
      expect(serialized).toContain('```ts');
      mathSources.forEach((source) => {
        expect(serialized).toContain(source);
      });
      mermaidSources.forEach((source) => {
        expect(serialized).toContain(`\`\`\`mermaid\n${source}\n\`\`\``);
      });
      document.destroy();
    },
  );
});
