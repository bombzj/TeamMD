import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { getMilkdownCodec } from './milkdown-codec.js';

const supportedMarkdown = `# Rendered editing

This has **bold**, *emphasis*, ~~strike~~, and [a link](https://example.test).

- [x] Complete
- [ ] Pending

| Feature | Status |
| --- | --- |
| Collaboration | Working |

> Shared quote

\`inline code\`

\`\`\`ts
const answer = 42;
\`\`\`
`;

describe('Milkdown collaboration codec', () => {
  it('round-trips supported GFM through a Y.XmlFragment', async () => {
    const codec = await getMilkdownCodec();
    const state = codec.createState(supportedMarkdown);
    const document = new Y.Doc();
    Y.applyUpdate(document, state);

    const serialized = codec.read(document);

    expect(codec.isSemanticallyEquivalent(serialized, supportedMarkdown)).toBe(
      true,
    );
    expect(codec.serialize(codec.parse(serialized))).toBe(serialized);
    expect(serialized).toContain('# Rendered editing');
    expect(serialized).toContain('**bold**');
    expect(serialized).toContain('[x] Complete');
    expect(serialized).toContain('Collaboration');
    expect(serialized).toContain('Working');
    expect(serialized).toContain('```ts');
    document.destroy();
  });
});
