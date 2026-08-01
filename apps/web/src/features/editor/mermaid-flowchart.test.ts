import { describe, expect, it } from 'vitest';

import {
  addFlowchartEdge,
  addFlowchartNode,
  deleteFlowchartEdge,
  deleteFlowchartNode,
  parseMermaidFlowchart,
  renameFlowchartNode,
  serializeMermaidFlowchart,
  setFlowchartDirection,
} from './mermaid-flowchart.js';

describe('constrained Mermaid flowcharts', () => {
  it('parses declarations and simple directed edges into one transient model', () => {
    expect(
      parseMermaidFlowchart(`flowchart LR
        Start[Draft]
        Start --> Review[Review]
        Review --> Done[Done]`),
    ).toEqual({
      direction: 'LR',
      nodes: [
        { id: 'Start', label: 'Draft' },
        { id: 'Review', label: 'Review' },
        { id: 'Done', label: 'Done' },
      ],
      edges: [
        { from: 'Start', to: 'Review' },
        { from: 'Review', to: 'Done' },
      ],
    });
  });

  it.each([
    'sequenceDiagram\n  A->>B: Hello',
    'flowchart LR\n  A -- label --> B',
    'flowchart LR\n  subgraph Group\n  A --> B\n  end',
    'flowchart LR\n  A((Circle)) --> B',
    'flowchart LR\n  A[One]\n  A[Two]',
  ])('rejects unsupported syntax without rewriting it', (source) => {
    expect(parseMermaidFlowchart(source)).toBeNull();
  });

  it('serializes visual operations to deterministic portable source', () => {
    const initial = parseMermaidFlowchart(
      'flowchart LR\n  A[Start] --> B[Done]',
    );
    expect(initial).not.toBeNull();
    if (initial === null) return;

    const withNode = addFlowchartNode(initial, 'Review');
    const renamed = renameFlowchartNode(withNode, 'B', 'Published');
    const withEdge = addFlowchartEdge(renamed, 'A', 'Node3');
    const directed = setFlowchartDirection(withEdge, 'TB');

    expect(serializeMermaidFlowchart(directed)).toBe(`flowchart TB
  A[Start]
  B[Published]
  Node3[Review]
  A --> B
  A --> Node3`);
  });

  it('deletes incident edges with a node and can delete one edge', () => {
    const initial = parseMermaidFlowchart(
      'flowchart LR\n  A[Start] --> B[Review]\n  B --> C[Done]',
    );
    expect(initial).not.toBeNull();
    if (initial === null) return;

    const withoutFirstEdge = deleteFlowchartEdge(initial, 0);
    expect(withoutFirstEdge.edges).toEqual([{ from: 'B', to: 'C' }]);
    expect(deleteFlowchartNode(initial, 'B')).toEqual({
      direction: 'LR',
      nodes: [
        { id: 'A', label: 'Start' },
        { id: 'C', label: 'Done' },
      ],
      edges: [],
    });
  });

  it('does not add invalid or duplicate edges', () => {
    const initial = parseMermaidFlowchart(
      'flowchart LR\n  A[Start] --> B[Done]',
    );
    expect(initial).not.toBeNull();
    if (initial === null) return;

    expect(addFlowchartEdge(initial, 'A', 'B')).toBe(initial);
    expect(addFlowchartEdge(initial, 'A', 'Missing')).toBe(initial);
  });
});
