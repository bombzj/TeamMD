import {
  blackboardCollectionSchema,
  type BlackboardSnapshot,
} from '@teammd/contracts';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';

import { ApiError } from '../../lib/api-error.js';

export const blackboardRootName = 'blackboards';
const maximumBlackboardCollectionBytes = 6 * 1024 * 1024;

export function readBlackboards(document: Y.Doc): BlackboardSnapshot[] {
  const root = document.getMap<unknown>(blackboardRootName);
  const blackboards: BlackboardSnapshot[] = [];

  for (const [id, value] of root.entries()) {
    if (!(value instanceof Y.Map)) throw invalidBlackboardState();
    const board = value as Y.Map<unknown>;
    const strokesValue = board.get('strokes');
    if (!(strokesValue instanceof Y.Map)) throw invalidBlackboardState();
    const strokes: unknown[] = [];
    for (const stroke of strokesValue.values()) {
      if (typeof stroke !== 'string') throw invalidBlackboardState();
      try {
        strokes.push(JSON.parse(stroke) as unknown);
      } catch {
        throw invalidBlackboardState();
      }
    }
    blackboards.push({
      id,
      name: board.get('name'),
      order: board.get('order'),
      backgroundMarkdown: board.get('backgroundMarkdown'),
      backgroundHash: board.get('backgroundHash'),
      strokes,
    } as BlackboardSnapshot);
  }

  const parsed = blackboardCollectionSchema.safeParse(blackboards);
  if (!parsed.success) throw invalidBlackboardState();
  const canonical = canonicalizeBlackboards(parsed.data);
  for (const blackboard of canonical) {
    if (sha256(blackboard.backgroundMarkdown) !== blackboard.backgroundHash) {
      throw invalidBlackboardState();
    }
  }
  if (
    Buffer.byteLength(JSON.stringify(canonical), 'utf8') >
    maximumBlackboardCollectionBytes
  ) {
    throw new ApiError(
      413,
      'VALIDATION_ERROR',
      'The blackboard collection is too large.',
    );
  }
  return canonical;
}

export function writeBlackboards(
  document: Y.Doc,
  input: BlackboardSnapshot[],
): void {
  const blackboards = canonicalizeBlackboards(
    blackboardCollectionSchema.parse(input),
  );
  const root = document.getMap<Y.Map<unknown>>(blackboardRootName);
  document.transact(() => {
    for (const id of [...root.keys()]) root.delete(id);
    for (const blackboard of blackboards) {
      const value = new Y.Map<unknown>();
      value.set('name', blackboard.name);
      value.set('order', blackboard.order);
      value.set('backgroundMarkdown', blackboard.backgroundMarkdown);
      value.set('backgroundHash', blackboard.backgroundHash);
      const strokes = new Y.Map<string>();
      for (const stroke of blackboard.strokes) {
        strokes.set(stroke.id, JSON.stringify(stroke));
      }
      value.set('strokes', strokes);
      root.set(blackboard.id, value);
    }
  });
}

export function validateBlackboardTransition(
  currentDocument: Y.Doc,
  candidateDocument: Y.Doc,
  candidateMarkdown: string,
): BlackboardSnapshot[] {
  const current = readBlackboards(currentDocument);
  const candidate = readBlackboards(candidateDocument);
  const currentById = new Map(
    current.map((blackboard) => [blackboard.id, blackboard]),
  );
  const candidateMarkdownHash = sha256(candidateMarkdown);

  for (const blackboard of candidate) {
    const previous = currentById.get(blackboard.id);
    if (previous === undefined) {
      if (
        blackboard.backgroundMarkdown !== candidateMarkdown ||
        blackboard.backgroundHash !== candidateMarkdownHash
      ) {
        throw invalidBlackboardState(
          'A new blackboard must copy the current Markdown.',
        );
      }
      continue;
    }
    if (
      previous.backgroundMarkdown !== blackboard.backgroundMarkdown ||
      previous.backgroundHash !== blackboard.backgroundHash
    ) {
      throw invalidBlackboardState(
        'A blackboard Markdown background cannot be changed.',
      );
    }
  }
  return candidate;
}

export function blackboardCollectionHash(
  blackboards: BlackboardSnapshot[],
): string {
  return sha256(JSON.stringify(canonicalizeBlackboards(blackboards)));
}

export function canonicalizeBlackboards(
  blackboards: BlackboardSnapshot[],
): BlackboardSnapshot[] {
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

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalidBlackboardState(
  message = 'The collaborative blackboard state is invalid.',
): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', message);
}
