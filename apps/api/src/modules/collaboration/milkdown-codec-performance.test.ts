import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { getMilkdownCodec } from './milkdown-codec.js';

const performanceIt =
  process.env.TEAMMD_PERFORMANCE_SMOKE === 'true' ? it : it.skip;

describe('Milkdown codec performance smoke', () => {
  performanceIt(
    'keeps 256 KiB Yjs updates and checkpoint serialization bounded',
    async () => {
      const markdown = createLargeMarkdown(256 * 1024);
      const codec = await getMilkdownCodec();
      const heapBefore = process.memoryUsage().heapUsed;
      const createStartedAt = performance.now();
      const state = codec.createState(markdown);
      const createStateMs = performance.now() - createStartedAt;
      const document = new Y.Doc();
      Y.applyUpdate(document, state);

      const checkpointStartedAt = performance.now();
      const serialized = codec.read(document);
      const persistedUpdate = Y.encodeStateAsUpdate(document);
      createHash('sha256').update(serialized).digest('hex');
      const checkpointSerializeMs = performance.now() - checkpointStartedAt;
      const heapDeltaBytes = Math.max(
        0,
        process.memoryUsage().heapUsed - heapBefore,
      );

      console.info('TeamMD codec performance smoke', {
        checkpointSerializeMs: Math.round(checkpointSerializeMs),
        createStateMs: Math.round(createStateMs),
        heapDeltaBytes,
        markdownBytes: Buffer.byteLength(serialized),
        yjsUpdateBytes: persistedUpdate.byteLength,
      });
      expect(createStateMs).toBeLessThan(5_000);
      expect(checkpointSerializeMs).toBeLessThan(1_000);
      expect(persistedUpdate.byteLength).toBeLessThan(2 * 1024 * 1024);
      expect(heapDeltaBytes).toBeLessThan(256 * 1024 * 1024);
      document.destroy();
    },
    15_000,
  );
});

function createLargeMarkdown(minimumBytes: number): string {
  const sectionCount = 64;
  const paragraph = 'Paragraph content for a representative large document. ';
  const paragraphLength = Math.ceil(minimumBytes / sectionCount);
  return Array.from(
    { length: sectionCount },
    (_, index) =>
      `## Section ${index + 1}\n\n${paragraph.repeat(Math.ceil(paragraphLength / paragraph.length))}\n`,
  ).join('\n');
}
