import {
  blackboardCollectionSchema,
  maximumBlackboardCollectionBytes,
  maximumBlackboardsPerDocument,
  maximumBlackboardStrokes,
  type BlackboardSnapshot,
  type BlackboardStroke,
} from '@teammd/contracts';
import * as Y from 'yjs';

const rootName = 'blackboards';
const maximumUndoSteps = 100;
const encoder = new TextEncoder();

export type BlackboardStore = {
  addStroke: (blackboardId: string, stroke: BlackboardStroke) => void;
  clear: (blackboardId: string) => void;
  create: (name: string, backgroundMarkdown: string) => Promise<string>;
  delete: (blackboardId: string) => void;
  deleteStroke: (blackboardId: string, strokeId: string) => void;
  deleteStrokes: (blackboardId: string, strokeIds: string[]) => void;
  destroy: () => void;
  list: () => BlackboardSnapshot[];
  moveStroke: (
    blackboardId: string,
    strokeId: string,
    deltaX: number,
    deltaY: number,
  ) => void;
  moveStrokes: (
    blackboardId: string,
    strokeIds: string[],
    deltaX: number,
    deltaY: number,
  ) => void;
  redo: () => boolean;
  rename: (blackboardId: string, name: string) => void;
  reorder: (blackboardId: string, targetIndex: number) => void;
  subscribe: (
    listener: (blackboards: BlackboardSnapshot[]) => void,
  ) => () => void;
  undo: () => boolean;
};

export function createBlackboardStore(
  document: Y.Doc,
  canEdit: () => boolean,
): BlackboardStore {
  const root = document.getMap<Y.Map<unknown>>(rootName);
  const localOrigin = Symbol('blackboard-local-operation');
  const undoManager = new Y.UndoManager(root, {
    captureTimeout: 0,
    trackedOrigins: new Set([localOrigin]),
  });
  let destroyed = false;
  const observers = new Set<() => void>();
  const ensureActive = () => {
    if (destroyed) throw new Error('The blackboard has been closed.');
  };
  const transact = (operation: () => void) => {
    ensureActive();
    if (undoManager.undoStack.length >= maximumUndoSteps) {
      // Yjs retains deleted structs while they remain undoable. Clearing at a
      // bounded interval releases those references instead of letting a long
      // classroom session grow without limit.
      undoManager.clear();
    }
    document.transact(operation, localOrigin);
  };
  const ensureEditable = () => {
    ensureActive();
    if (!canEdit()) throw new Error('This blackboard is read only.');
  };
  const requireBoard = (blackboardId: string) => {
    const board = root.get(blackboardId);
    if (!(board instanceof Y.Map)) throw new Error('Blackboard not found.');
    return board;
  };
  const deleteStrokes = (blackboardId: string, strokeIds: string[]) => {
    ensureEditable();
    const strokes = requireStrokes(requireBoard(blackboardId));
    const uniqueIds = [...new Set(strokeIds)];
    transact(() => {
      for (const strokeId of uniqueIds) strokes.delete(strokeId);
    });
  };
  const moveStrokes = (
    blackboardId: string,
    strokeIds: string[],
    deltaX: number,
    deltaY: number,
  ) => {
    ensureEditable();
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      throw new Error('The stroke movement is invalid.');
    }
    const strokes = requireStrokes(requireBoard(blackboardId));
    const schema = blackboardCollectionSchema.element.shape.strokes.element;
    const moved = [...new Set(strokeIds)].map((strokeId) => {
      const encoded = strokes.get(strokeId);
      if (encoded === undefined) throw new Error('Stroke not found.');
      let current: unknown;
      try {
        current = JSON.parse(encoded) as unknown;
      } catch {
        throw new Error('Blackboard state is invalid.');
      }
      const stroke = schema.parse(current);
      return schema.parse({
        ...stroke,
        points: stroke.points.map((point) => ({
          ...point,
          x: point.x + deltaX,
          y: point.y + deltaY,
        })),
      });
    });
    ensureCollectionWithinLimit(
      replaceBoard(readBlackboards(root), blackboardId, (blackboard) => {
        const movedById = new Map(moved.map((stroke) => [stroke.id, stroke]));
        return {
          ...blackboard,
          strokes: blackboard.strokes.map(
            (stroke) => movedById.get(stroke.id) ?? stroke,
          ),
        };
      }),
    );
    transact(() => {
      for (const stroke of moved) {
        strokes.set(stroke.id, JSON.stringify(stroke));
      }
    });
  };

  return {
    list: () => {
      ensureActive();
      return readBlackboards(root);
    },
    subscribe: (listener) => {
      ensureActive();
      const publish = () => listener(readBlackboards(root));
      observers.add(publish);
      root.observeDeep(publish);
      publish();
      return () => {
        if (!observers.delete(publish)) return;
        root.unobserveDeep(publish);
      };
    },
    create: async (name, backgroundMarkdown) => {
      ensureEditable();
      const existing = readBlackboards(root);
      if (existing.length >= maximumBlackboardsPerDocument) {
        throw new Error(
          'This document already has the maximum number of blackboards.',
        );
      }
      const normalizedName = name.trim();
      if (
        existing.some(
          (blackboard) =>
            blackboard.name.toLocaleLowerCase('en-US') ===
            normalizedName.toLocaleLowerCase('en-US'),
        )
      ) {
        throw new Error('A blackboard with that name already exists.');
      }
      const id = crypto.randomUUID();
      const backgroundHash = await sha256(backgroundMarkdown);
      ensureEditable();
      const current = readBlackboards(root);
      if (current.length >= maximumBlackboardsPerDocument) {
        throw new Error(
          'This document already has the maximum number of blackboards.',
        );
      }
      if (
        current.some(
          (blackboard) =>
            blackboard.name.toLocaleLowerCase('en-US') ===
            normalizedName.toLocaleLowerCase('en-US'),
        )
      ) {
        throw new Error('A blackboard with that name already exists.');
      }
      ensureCollectionWithinLimit([
        ...current,
        {
          id,
          name: normalizedName,
          order: current.length,
          backgroundMarkdown,
          backgroundHash,
          strokes: [],
        },
      ]);
      const board = new Y.Map<unknown>();
      board.set('name', normalizedName);
      board.set('order', current.length);
      board.set('backgroundMarkdown', backgroundMarkdown);
      board.set('backgroundHash', backgroundHash);
      board.set('strokes', new Y.Map<string>());
      transact(() => root.set(id, board));
      return id;
    },
    rename: (blackboardId, name) => {
      ensureEditable();
      const normalizedName = name.trim();
      const existing = readBlackboards(root);
      if (
        existing.some(
          (blackboard) =>
            blackboard.id !== blackboardId &&
            blackboard.name.toLocaleLowerCase('en-US') ===
              normalizedName.toLocaleLowerCase('en-US'),
        )
      ) {
        throw new Error('A blackboard with that name already exists.');
      }
      ensureCollectionWithinLimit(
        replaceBoard(existing, blackboardId, (blackboard) => ({
          ...blackboard,
          name: normalizedName,
        })),
      );
      transact(() => requireBoard(blackboardId).set('name', normalizedName));
    },
    reorder: (blackboardId, targetIndex) => {
      ensureEditable();
      const ordered = readBlackboards(root);
      const currentIndex = ordered.findIndex(
        (blackboard) => blackboard.id === blackboardId,
      );
      if (currentIndex < 0) throw new Error('Blackboard not found.');
      const nextIndex = Math.max(0, Math.min(targetIndex, ordered.length - 1));
      if (currentIndex === nextIndex) return;
      const [moving] = ordered.splice(currentIndex, 1);
      if (moving === undefined) return;
      ordered.splice(nextIndex, 0, moving);
      transact(() => {
        for (const [order, blackboard] of ordered.entries()) {
          requireBoard(blackboard.id).set('order', order);
        }
      });
    },
    delete: (blackboardId) => {
      ensureEditable();
      transact(() => root.delete(blackboardId));
    },
    clear: (blackboardId) => {
      ensureEditable();
      const strokes = requireStrokes(requireBoard(blackboardId));
      transact(() => {
        for (const strokeId of [...strokes.keys()]) strokes.delete(strokeId);
      });
    },
    addStroke: (blackboardId, stroke) => {
      ensureEditable();
      const parsed =
        blackboardCollectionSchema.element.shape.strokes.element.parse(stroke);
      const existing = readBlackboards(root);
      const board = existing.find(
        (blackboard) => blackboard.id === blackboardId,
      );
      if (board === undefined) throw new Error('Blackboard not found.');
      const isReplacement = board.strokes.some(
        (candidate) => candidate.id === parsed.id,
      );
      if (!isReplacement && board.strokes.length >= maximumBlackboardStrokes) {
        throw new Error('This blackboard has reached its stroke limit.');
      }
      ensureCollectionWithinLimit(
        replaceBoard(existing, blackboardId, (blackboard) => ({
          ...blackboard,
          strokes: isReplacement
            ? blackboard.strokes.map((candidate) =>
                candidate.id === parsed.id ? parsed : candidate,
              )
            : [...blackboard.strokes, parsed],
        })),
      );
      transact(() =>
        requireStrokes(requireBoard(blackboardId)).set(
          parsed.id,
          JSON.stringify(parsed),
        ),
      );
    },
    deleteStroke: (blackboardId, strokeId) => {
      deleteStrokes(blackboardId, [strokeId]);
    },
    deleteStrokes,
    moveStroke: (blackboardId, strokeId, deltaX, deltaY) => {
      moveStrokes(blackboardId, [strokeId], deltaX, deltaY);
    },
    moveStrokes,
    undo: () => {
      ensureEditable();
      if (undoManager.undoStack.length === 0) return false;
      undoManager.undo();
      return true;
    },
    redo: () => {
      ensureEditable();
      if (undoManager.redoStack.length === 0) return false;
      undoManager.redo();
      return true;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const publish of observers) root.unobserveDeep(publish);
      observers.clear();
      undoManager.clear();
      undoManager.destroy();
    },
  };
}

export function serializeBlackboards(
  blackboards: BlackboardSnapshot[],
): string {
  return JSON.stringify(
    canonicalize(blackboardCollectionSchema.parse(blackboards)),
  );
}

export async function hashBlackboards(
  blackboards: BlackboardSnapshot[],
): Promise<string> {
  return sha256(serializeBlackboards(blackboards));
}

export function blackboardsEqual(
  left: BlackboardSnapshot[],
  right: BlackboardSnapshot[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (const [boardIndex, leftBoard] of left.entries()) {
    const rightBoard = right[boardIndex];
    if (
      rightBoard === undefined ||
      leftBoard.id !== rightBoard.id ||
      leftBoard.name !== rightBoard.name ||
      leftBoard.order !== rightBoard.order ||
      leftBoard.backgroundHash !== rightBoard.backgroundHash ||
      leftBoard.backgroundMarkdown !== rightBoard.backgroundMarkdown ||
      leftBoard.strokes.length !== rightBoard.strokes.length
    ) {
      return false;
    }
    for (const [strokeIndex, leftStroke] of leftBoard.strokes.entries()) {
      const rightStroke = rightBoard.strokes[strokeIndex];
      if (
        rightStroke === undefined ||
        leftStroke.id !== rightStroke.id ||
        leftStroke.tool !== rightStroke.tool ||
        leftStroke.color !== rightStroke.color ||
        leftStroke.width !== rightStroke.width ||
        leftStroke.points.length !== rightStroke.points.length
      ) {
        return false;
      }
      for (const [pointIndex, leftPoint] of leftStroke.points.entries()) {
        const rightPoint = rightStroke.points[pointIndex];
        if (
          rightPoint === undefined ||
          leftPoint.x !== rightPoint.x ||
          leftPoint.y !== rightPoint.y ||
          leftPoint.pressure !== rightPoint.pressure
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

function readBlackboards(root: Y.Map<Y.Map<unknown>>): BlackboardSnapshot[] {
  const blackboards: unknown[] = [];
  for (const [id, board] of root.entries()) {
    if (!(board instanceof Y.Map)) continue;
    const strokes = board.get('strokes');
    if (!(strokes instanceof Y.Map)) continue;
    const parsedStrokes: unknown[] = [];
    for (const value of strokes.values()) {
      if (typeof value !== 'string') continue;
      try {
        parsedStrokes.push(JSON.parse(value) as unknown);
      } catch {
        continue;
      }
    }
    blackboards.push({
      id,
      name: board.get('name'),
      order: board.get('order'),
      backgroundMarkdown: board.get('backgroundMarkdown'),
      backgroundHash: board.get('backgroundHash'),
      strokes: parsedStrokes,
    });
  }
  const parsed = blackboardCollectionSchema.safeParse(blackboards);
  return parsed.success ? canonicalize(parsed.data) : [];
}

function canonicalize(blackboards: BlackboardSnapshot[]) {
  return blackboards
    .map((blackboard) => ({
      ...blackboard,
      name: blackboard.name.trim(),
      strokes: [...blackboard.strokes].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
}

function requireStrokes(board: Y.Map<unknown>): Y.Map<string> {
  const strokes = board.get('strokes');
  if (!(strokes instanceof Y.Map))
    throw new Error('Blackboard state is invalid.');
  return strokes as Y.Map<string>;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function replaceBoard(
  blackboards: BlackboardSnapshot[],
  blackboardId: string,
  update: (blackboard: BlackboardSnapshot) => BlackboardSnapshot,
): BlackboardSnapshot[] {
  let found = false;
  const next = blackboards.map((blackboard) => {
    if (blackboard.id !== blackboardId) return blackboard;
    found = true;
    return update(blackboard);
  });
  if (!found) throw new Error('Blackboard not found.');
  return next;
}

function ensureCollectionWithinLimit(blackboards: BlackboardSnapshot[]): void {
  const serialized = serializeBlackboards(blackboards);
  if (
    encoder.encode(serialized).byteLength > maximumBlackboardCollectionBytes
  ) {
    throw new Error('This document has reached its blackboard storage limit.');
  }
}
