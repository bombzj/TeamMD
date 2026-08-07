import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  blackboardCollectionHash,
  readBlackboards,
  validateBlackboardTransition,
  writeBlackboards,
} from './blackboard-state.js';

const markdown = '# Lesson\n';
const backgroundHash = createHash('sha256').update(markdown).digest('hex');
const board = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Board 1',
  order: 0,
  backgroundMarkdown: markdown,
  backgroundHash,
  strokes: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      tool: 'pen' as const,
      color: '#112233',
      width: 4,
      points: [{ x: 10, y: 20, pressure: 0.5 }],
    },
  ],
};

describe('blackboard Yjs state', () => {
  it('round-trips and hashes a canonical blackboard collection', () => {
    const document = new Y.Doc();
    writeBlackboards(document, [board]);
    expect(readBlackboards(document)).toEqual([board]);
    expect(blackboardCollectionHash([board])).toMatch(/^[a-f0-9]{64}$/);
    document.destroy();
  });

  it('accepts a new board copied from current Markdown and rejects background replacement', () => {
    const current = new Y.Doc();
    const candidate = new Y.Doc();
    writeBlackboards(candidate, [board]);
    expect(validateBlackboardTransition(current, candidate, markdown)).toEqual([
      board,
    ]);

    const changed = new Y.Doc();
    writeBlackboards(current, [board]);
    writeBlackboards(changed, [
      {
        ...board,
        backgroundMarkdown: '# Changed\n',
        backgroundHash: createHash('sha256')
          .update('# Changed\n')
          .digest('hex'),
      },
    ]);
    expect(() =>
      validateBlackboardTransition(current, changed, '# Changed\n'),
    ).toThrow('cannot be changed');
    current.destroy();
    candidate.destroy();
    changed.destroy();
  });
});
