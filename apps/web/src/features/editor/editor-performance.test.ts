import { editorViewCtx } from '@milkdown/kit/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createTeamMdEditor } from './editor-feature-profile.js';
import { createMermaidPreviewRenderer } from './mermaid-preview.js';

const runPerformanceSmoke = process.env.TEAMMD_PERFORMANCE_SMOKE === 'true';
const performanceIt = runPerformanceSmoke ? it : it.skip;
const editors: Array<{ destroy: () => Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  document.body.replaceChildren();
});

describe('editor performance smoke', () => {
  performanceIt(
    'keeps a 256 KiB document transaction and serialization bounded',
    async () => {
      const content = createLargeMarkdown(256 * 1024);
      const host = document.createElement('div');
      document.body.append(host);
      const heapBefore = readHeapUsed();
      const createStartedAt = performance.now();
      const editor = createTeamMdEditor(host, content);
      await editor.create();
      editors.push(editor);
      const createMs = performance.now() - createStartedAt;

      const transactionStartedAt = performance.now();
      editor.editor.action((context) => {
        const view = context.get(editorViewCtx);
        view.dispatch(view.state.tr.insertText('x', 1));
      });
      const serialized = editor.getMarkdown();
      const transactionAndSerializeMs =
        performance.now() - transactionStartedAt;
      const heapDeltaBytes = Math.max(0, readHeapUsed() - heapBefore);

      console.info('TeamMD editor performance smoke', {
        bytes: new TextEncoder().encode(serialized).byteLength,
        createMs: Math.round(createMs),
        heapDeltaBytes,
        transactionAndSerializeMs: Math.round(transactionAndSerializeMs),
      });
      expect(createMs).toBeLessThan(5_000);
      expect(transactionAndSerializeMs).toBeLessThan(1_000);
      expect(heapDeltaBytes).toBeLessThan(256 * 1024 * 1024);
    },
    15_000,
  );

  performanceIt(
    'renders representative and 25-node Mermaid flowcharts within limits',
    async () => {
      installSvgMeasurementFallback();
      const renderer = createMermaidPreviewRenderer();
      const samples = [
        'flowchart LR\n  Start --> Review\n  Review --> Done',
        createFlowchart(25),
      ];
      const durations: number[] = [];

      for (const source of samples) {
        const startedAt = performance.now();
        const preview = await renderDiagram(renderer, source);
        durations.push(performance.now() - startedAt);
        expect(preview.querySelector('svg')).not.toBeNull();
      }
      renderer.destroy();

      console.info('TeamMD Mermaid performance smoke', {
        twentyFiveNodeFlowchartMs: Math.round(durations[1] ?? 0),
        representativeFlowchartMs: Math.round(durations[0] ?? 0),
      });
      expect(durations[0]).toBeLessThan(3_000);
      expect(durations[1]).toBeLessThan(3_000);
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

function createFlowchart(nodeCount: number): string {
  return [
    'flowchart LR',
    ...Array.from(
      { length: nodeCount },
      (_, index) => `  Node${index}[Node ${index}]`,
    ),
    ...Array.from(
      { length: nodeCount - 1 },
      (_, index) => `  Node${index} --> Node${index + 1}`,
    ),
  ].join('\n');
}

function renderDiagram(
  renderer: ReturnType<typeof createMermaidPreviewRenderer>,
  source: string,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    renderer.renderPreview('mermaid', source, (value) => {
      if (!(value instanceof HTMLElement)) {
        reject(new Error('Mermaid did not return a preview element.'));
        return;
      }
      if (value.classList.contains('mermaid-preview-error')) {
        reject(new Error(value.textContent ?? 'Mermaid rendering failed.'));
        return;
      }
      resolve(value);
    });
  });
}

function installSvgMeasurementFallback(): void {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ height: 100, width: 200, x: 0, y: 0 }),
  });
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
    configurable: true,
    value: function (this: SVGElement) {
      return (this.textContent?.length ?? 0) * 8;
    },
  });
}

function readHeapUsed(): number {
  return (
    (
      globalThis as typeof globalThis & {
        process?: { memoryUsage: () => { heapUsed: number } };
      }
    ).process?.memoryUsage().heapUsed ?? 0
  );
}
