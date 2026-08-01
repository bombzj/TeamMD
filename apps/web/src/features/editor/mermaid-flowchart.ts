export const flowchartDirections = ['TB', 'TD', 'BT', 'RL', 'LR'] as const;

export type FlowchartDirection = (typeof flowchartDirections)[number];

export type FlowchartNode = {
  id: string;
  label: string;
};

export type FlowchartEdge = {
  from: string;
  to: string;
};

export type MermaidFlowchart = {
  direction: FlowchartDirection;
  edges: FlowchartEdge[];
  nodes: FlowchartNode[];
};

const identifierPattern = '[A-Za-z_][A-Za-z0-9_-]*';
const headerPattern = new RegExp(
  `^flowchart\\s+(${flowchartDirections.join('|')})$`,
  'u',
);
const nodePattern = new RegExp(
  `^(${identifierPattern})\\[([^\\]\\n]*)\\]$`,
  'u',
);
const edgePattern = new RegExp(
  `^(${identifierPattern})(?:\\[([^\\]\\n]*)\\])?\\s*-->\\s*(${identifierPattern})(?:\\[([^\\]\\n]*)\\])?$`,
  'u',
);

export function parseMermaidFlowchart(source: string): MermaidFlowchart | null {
  const lines = source.split(/\r?\n/u).map((line) => line.trim());
  const header = lines.shift()?.match(headerPattern);
  const direction = header?.[1] as FlowchartDirection | undefined;
  if (direction === undefined) return null;

  const nodes = new Map<string, FlowchartNode>();
  const edges: FlowchartEdge[] = [];
  for (const line of lines) {
    if (line === '') continue;
    const edge = line.match(edgePattern);
    if (edge !== null) {
      const [, from, fromLabel, to, toLabel] = edge;
      if (from === undefined || to === undefined) return null;
      if (!addNode(nodes, from, fromLabel) || !addNode(nodes, to, toLabel)) {
        return null;
      }
      if (edges.some((item) => item.from === from && item.to === to)) {
        return null;
      }
      edges.push({ from, to });
      continue;
    }
    const node = line.match(nodePattern);
    if (node === null || node[1] === undefined) return null;
    if (!addNode(nodes, node[1], node[2] ?? '')) return null;
  }

  if (nodes.size === 0) return null;
  return { direction, edges, nodes: [...nodes.values()] };
}

export function serializeMermaidFlowchart(flowchart: MermaidFlowchart): string {
  return [
    `flowchart ${flowchart.direction}`,
    ...flowchart.nodes.map(
      (node) => `  ${node.id}[${sanitizeLabel(node.label)}]`,
    ),
    ...flowchart.edges.map((edge) => `  ${edge.from} --> ${edge.to}`),
  ].join('\n');
}

export function addFlowchartNode(
  flowchart: MermaidFlowchart,
  label = 'New node',
): MermaidFlowchart {
  const ids = new Set(flowchart.nodes.map((node) => node.id));
  let sequence = flowchart.nodes.length + 1;
  while (ids.has(`Node${sequence}`)) sequence += 1;
  return {
    ...flowchart,
    nodes: [...flowchart.nodes, { id: `Node${sequence}`, label }],
  };
}

export function renameFlowchartNode(
  flowchart: MermaidFlowchart,
  id: string,
  label: string,
): MermaidFlowchart {
  return {
    ...flowchart,
    nodes: flowchart.nodes.map((node) =>
      node.id === id ? { ...node, label: sanitizeLabel(label) } : node,
    ),
  };
}

export function deleteFlowchartNode(
  flowchart: MermaidFlowchart,
  id: string,
): MermaidFlowchart {
  return {
    ...flowchart,
    nodes: flowchart.nodes.filter((node) => node.id !== id),
    edges: flowchart.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

export function addFlowchartEdge(
  flowchart: MermaidFlowchart,
  from: string,
  to: string,
): MermaidFlowchart {
  const ids = new Set(flowchart.nodes.map((node) => node.id));
  if (
    !ids.has(from) ||
    !ids.has(to) ||
    flowchart.edges.some((edge) => edge.from === from && edge.to === to)
  ) {
    return flowchart;
  }
  return { ...flowchart, edges: [...flowchart.edges, { from, to }] };
}

export function deleteFlowchartEdge(
  flowchart: MermaidFlowchart,
  index: number,
): MermaidFlowchart {
  return {
    ...flowchart,
    edges: flowchart.edges.filter((_edge, edgeIndex) => edgeIndex !== index),
  };
}

export function setFlowchartDirection(
  flowchart: MermaidFlowchart,
  direction: FlowchartDirection,
): MermaidFlowchart {
  return { ...flowchart, direction };
}

function addNode(
  nodes: Map<string, FlowchartNode>,
  id: string,
  label: string | undefined,
): boolean {
  const current = nodes.get(id);
  const nextLabel = label === undefined ? (current?.label ?? id) : label;
  if (current !== undefined && label !== undefined && current.label !== label) {
    return false;
  }
  nodes.set(id, { id, label: sanitizeLabel(nextLabel) });
  return true;
}

function sanitizeLabel(label: string): string {
  return label.replace(/[[\]\r\n]/gu, ' ').trim() || 'Untitled';
}
