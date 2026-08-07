import { webcrypto } from 'node:crypto';
import { maximumBlackboardStrokes } from '@teammd/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { blackboardsEqual, createBlackboardStore } from './blackboard-state.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
});

describe('blackboard store', () => {
  it('creates an immutable Markdown copy and adds or removes strokes', async () => {
    const document = new Y.Doc();
    const store = createBlackboardStore(document, () => true);
    const id = await store.create('Board 1', '# Lesson\n');
    const [created] = store.list();
    expect(created?.id).toBe(id);
    expect(created?.backgroundMarkdown).toBe('# Lesson\n');

    const strokeId = '22222222-2222-4222-8222-222222222222';
    store.addStroke(id, {
      id: strokeId,
      tool: 'pen',
      color: '#112233',
      width: 4,
      points: [{ x: 10, y: 20, pressure: 0.5 }],
    });
    expect(store.list()[0]?.strokes).toHaveLength(1);
    store.deleteStroke(id, strokeId);
    expect(store.list()[0]?.strokes).toHaveLength(0);
    store.destroy();
    document.destroy();
  });

  it('compares canonical snapshots without serializing large backgrounds', () => {
    const backgroundMarkdown = 'x'.repeat(512 * 1024);
    const snapshot = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Board',
      order: 0,
      backgroundMarkdown,
      backgroundHash: 'a'.repeat(64),
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
    expect(blackboardsEqual([snapshot], [{ ...snapshot }])).toBe(true);
    expect(
      blackboardsEqual(
        [snapshot],
        [
          {
            ...snapshot,
            strokes: [
              {
                ...snapshot.strokes[0]!,
                points: [{ x: 11, y: 20, pressure: 0.5 }],
              },
            ],
          },
        ],
      ),
    ).toBe(false);
  });

  it('rejects duplicate names and read-only writes', async () => {
    const document = new Y.Doc();
    const store = createBlackboardStore(document, () => true);
    await store.create('Board 1', '# Lesson\n');
    await expect(store.create('board 1', '# Lesson\n')).rejects.toThrow(
      'already exists',
    );
    const readOnly = createBlackboardStore(document, () => false);
    await expect(readOnly.create('Board 2', '# Lesson\n')).rejects.toThrow(
      'read only',
    );
    readOnly.destroy();
    store.destroy();
    document.destroy();
  });

  it('reorders boards and locally undoes or redoes a moved stroke', async () => {
    const document = new Y.Doc();
    const store = createBlackboardStore(document, () => true);
    const firstId = await store.create('First', '# First\n');
    const secondId = await store.create('Second', '# Second\n');
    store.reorder(secondId, 0);
    expect(store.list().map((board) => board.id)).toEqual([secondId, firstId]);

    const strokeId = '33333333-3333-4333-8333-333333333333';
    store.addStroke(firstId, {
      id: strokeId,
      tool: 'pen',
      color: '#112233',
      width: 4,
      points: [{ x: 10, y: 20, pressure: 0.5 }],
    });
    store.moveStroke(firstId, strokeId, 15, -5);
    expect(
      store.list().find((board) => board.id === firstId)?.strokes[0]?.points,
    ).toEqual([{ x: 25, y: 15, pressure: 0.5 }]);

    expect(store.undo()).toBe(true);
    expect(
      store.list().find((board) => board.id === firstId)?.strokes[0]?.points,
    ).toEqual([{ x: 10, y: 20, pressure: 0.5 }]);
    expect(store.redo()).toBe(true);
    expect(
      store.list().find((board) => board.id === firstId)?.strokes[0]?.points,
    ).toEqual([{ x: 25, y: 15, pressure: 0.5 }]);
    store.destroy();
    document.destroy();
  });

  it('does not put another collaborator origin in the local undo stack', async () => {
    const document = new Y.Doc();
    const remote = createBlackboardStore(document, () => true);
    const id = await remote.create('Board', '# Lesson\n');
    const local = createBlackboardStore(document, () => true);
    remote.addStroke(id, {
      id: '44444444-4444-4444-8444-444444444444',
      tool: 'pen',
      color: '#112233',
      width: 4,
      points: [{ x: 10, y: 20, pressure: 0.5 }],
    });
    expect(local.undo()).toBe(false);
    expect(local.list()[0]?.strokes).toHaveLength(1);
    local.destroy();
    remote.destroy();
    document.destroy();
  });

  it('moves and deletes a multi-stroke selection in one undoable transaction', async () => {
    const document = new Y.Doc();
    const store = createBlackboardStore(document, () => true);
    const id = await store.create('Board', '# Lesson\n');
    const strokeIds = [
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ];
    for (const [index, strokeId] of strokeIds.entries()) {
      store.addStroke(id, {
        id: strokeId,
        tool: 'pen',
        color: '#112233',
        width: 4,
        points: [{ x: 10 + index * 20, y: 20, pressure: 0.5 }],
      });
    }

    store.moveStrokes(id, strokeIds, 5, 10);
    expect(store.list()[0]?.strokes.map((stroke) => stroke.points[0])).toEqual([
      { x: 15, y: 30, pressure: 0.5 },
      { x: 35, y: 30, pressure: 0.5 },
    ]);
    expect(store.undo()).toBe(true);
    expect(store.list()[0]?.strokes.map((stroke) => stroke.points[0])).toEqual([
      { x: 10, y: 20, pressure: 0.5 },
      { x: 30, y: 20, pressure: 0.5 },
    ]);

    store.deleteStrokes(id, strokeIds);
    expect(store.list()[0]?.strokes).toHaveLength(0);
    expect(store.undo()).toBe(true);
    expect(store.list()[0]?.strokes).toHaveLength(2);
    store.destroy();
    document.destroy();
  });

  it('unsubscribes observers and rejects use after destruction', async () => {
    const document = new Y.Doc();
    const store = createBlackboardStore(document, () => true);
    let publications = 0;
    store.subscribe(() => {
      publications += 1;
    });
    await store.create('Board', '# Lesson\n');
    expect(publications).toBe(2);

    store.destroy();
    const root = document.getMap<Y.Map<unknown>>('blackboards');
    document.transact(() => root.set(crypto.randomUUID(), new Y.Map()));
    expect(publications).toBe(2);
    expect(() => store.list()).toThrow('closed');
    document.destroy();
  });

  it('bounds retained local undo history during long sessions', async () => {
    const document = new Y.Doc();
    const store = createBlackboardStore(document, () => true);
    const id = await store.create('Board', '# Lesson\n');
    for (let index = 0; index < 100; index += 1) {
      store.rename(id, `Board ${index}`);
    }
    expect(store.undo()).toBe(true);
    expect(store.list()[0]?.name).toBe('Board 98');
    expect(store.undo()).toBe(false);
    store.destroy();
    document.destroy();
  });

  it('enforces stroke and collection memory limits before writing to Yjs', async () => {
    const document = new Y.Doc();
    const store = createBlackboardStore(document, () => true);
    const id = await store.create('Board', '# Lesson\n');
    for (let index = 0; index < maximumBlackboardStrokes; index += 1) {
      store.addStroke(id, {
        id: indexedUuid(index),
        tool: 'pen',
        color: '#112233',
        width: 4,
        points: [{ x: 10, y: 20, pressure: 0.5 }],
      });
    }
    expect(() =>
      store.addStroke(id, {
        id: indexedUuid(maximumBlackboardStrokes),
        tool: 'pen',
        color: '#112233',
        width: 4,
        points: [{ x: 10, y: 20, pressure: 0.5 }],
      }),
    ).toThrow('stroke limit');
    store.destroy();
    document.destroy();

    const largeDocument = new Y.Doc();
    const largeStore = createBlackboardStore(largeDocument, () => true);
    const largeMarkdown = 'x'.repeat(2 * 1024 * 1024);
    await largeStore.create('Large 1', largeMarkdown);
    await largeStore.create('Large 2', largeMarkdown);
    await expect(largeStore.create('Large 3', largeMarkdown)).rejects.toThrow(
      'storage limit',
    );
    largeStore.destroy();
    largeDocument.destroy();
  });
});

function indexedUuid(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index
    .toString(16)
    .padStart(12, '0')}`;
}
