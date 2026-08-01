import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';

import {
  addFlowchartEdge,
  addFlowchartNode,
  deleteFlowchartEdge,
  deleteFlowchartNode,
  flowchartDirections,
  parseMermaidFlowchart,
  renameFlowchartNode,
  serializeMermaidFlowchart,
  setFlowchartDirection,
  type MermaidFlowchart,
} from './mermaid-flowchart.js';

export function createVisualMermaidPreview(
  source: string,
  diagram: HTMLElement,
  getEditorView: () => EditorView | null,
): HTMLElement {
  const flowchart = parseMermaidFlowchart(source);
  const preview = document.createElement('div');
  preview.className = 'mermaid-visual-preview';
  preview.append(diagram);
  const view = getEditorView();
  if (flowchart === null || view?.editable !== true) return preview;

  preview.prepend(createControls(flowchart));
  return preview;
}

export function connectVisualMermaidEditor(
  root: HTMLElement,
  getEditorView: () => EditorView | null,
): () => void {
  const syncControls = () => {
    const view = getEditorView();
    root
      .querySelectorAll<HTMLElement>('.mermaid-visual-preview')
      .forEach((preview) => {
        const controls = preview.querySelector('.mermaid-visual-controls');
        const source =
          view === null ? null : readOwningMermaidSource(preview, view);
        const flowchart =
          source === null ? null : parseMermaidFlowchart(source);
        if (view?.editable !== true || flowchart === null) {
          controls?.remove();
        } else if (controls === null) {
          preview.prepend(createControls(flowchart));
          initializeSelectValues(preview, flowchart);
        } else if (controls.getAttribute('data-selects-ready') !== 'true') {
          initializeSelectValues(preview, flowchart);
        }
      });
  };
  const handleAction = (event: Event) => {
    const control = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-mermaid-action]',
    );
    const preview = control?.closest<HTMLElement>('.mermaid-visual-preview');
    const view = getEditorView();
    const source =
      preview == null || view === null
        ? null
        : readOwningMermaidSource(preview, view);
    const flowchart = source === null ? null : parseMermaidFlowchart(source);
    if (
      control == null ||
      preview == null ||
      source === null ||
      flowchart === null ||
      view === null
    ) {
      return;
    }
    const next = applyAction(flowchart, control);
    if (next === null) return;
    replaceOwningMermaidSource(
      preview,
      source,
      serializeMermaidFlowchart(next),
      view,
    );
  };
  const observer = new MutationObserver((records) => {
    const shouldSync = records.some(
      (record) =>
        record.type === 'attributes' ||
        [...record.addedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches('.mermaid-visual-preview') ||
              node.querySelector('.mermaid-visual-preview') !== null),
        ),
    );
    if (shouldSync) syncControls();
  });
  observer.observe(root, {
    attributeFilter: ['contenteditable'],
    attributes: true,
    childList: true,
    subtree: true,
  });
  root.addEventListener('click', handleAction);
  root.addEventListener('change', handleAction);
  syncControls();
  return () => {
    observer.disconnect();
    root.removeEventListener('click', handleAction);
    root.removeEventListener('change', handleAction);
  };
}

export function replaceOwningMermaidSource(
  preview: HTMLElement,
  expectedSource: string,
  nextSource: string,
  view: EditorView,
): boolean {
  const owner = findOwningCodeBlock(preview, view);
  if (owner === null || !view.editable) return false;
  const { node, position } = owner;
  if (
    node?.type.name !== 'code_block' ||
    node.attrs.language !== 'mermaid' ||
    node.textContent !== expectedSource
  ) {
    return false;
  }
  const transaction = view.state.tr.replaceWith(
    position + 1,
    position + node.nodeSize - 1,
    view.state.schema.text(nextSource),
  );
  view.dispatch(transaction);
  return true;
}

function createControls(flowchart: MermaidFlowchart): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'mermaid-visual-controls';
  controls.setAttribute('aria-label', 'Visual diagram editor');

  const toolbar = document.createElement('div');
  toolbar.className = 'mermaid-visual-toolbar';
  const direction = document.createElement('select');
  direction.setAttribute('aria-label', 'Diagram direction');
  direction.dataset.mermaidAction = 'direction';
  flowchartDirections.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    if (value === flowchart.direction) option.setAttribute('selected', '');
    direction.append(option);
  });
  const addNode = commandButton('Add node', 'add-node');
  toolbar.append(direction, addNode);

  const nodes = document.createElement('div');
  nodes.className = 'mermaid-visual-nodes';
  flowchart.nodes.forEach((node) => {
    const row = document.createElement('div');
    row.className = 'mermaid-visual-row';
    const id = document.createElement('span');
    id.className = 'mermaid-node-id';
    id.textContent = node.id;
    const label = document.createElement('input');
    label.value = node.label;
    label.setAttribute('aria-label', `Label for ${node.id}`);
    label.dataset.mermaidAction = 'rename-node';
    label.dataset.nodeId = node.id;
    const remove = commandButton(`Delete node ${node.id}`, 'delete-node');
    remove.dataset.nodeId = node.id;
    remove.disabled = flowchart.nodes.length === 1;
    row.append(id, label, remove);
    nodes.append(row);
  });

  const edges = document.createElement('div');
  edges.className = 'mermaid-visual-edges';
  flowchart.edges.forEach((edge, index) => {
    const row = document.createElement('div');
    row.className = 'mermaid-visual-row';
    const label = document.createElement('span');
    label.textContent = `${edge.from} to ${edge.to}`;
    row.append(
      label,
      commandButton(`Delete edge ${edge.from} to ${edge.to}`, 'delete-edge'),
    );
    const remove = row.querySelector<HTMLButtonElement>(
      '[data-mermaid-action]',
    );
    if (remove !== null) remove.dataset.edgeIndex = String(index);
    edges.append(row);
  });

  if (flowchart.nodes.length > 1) {
    const edgeCreator = document.createElement('div');
    edgeCreator.className = 'mermaid-visual-edge-creator';
    const from = nodeSelect('Edge from', flowchart, 0);
    const to = nodeSelect('Edge to', flowchart, 1);
    edgeCreator.append(from, to, commandButton('Add edge', 'add-edge'));
    edges.append(edgeCreator);
  }

  controls.append(toolbar, nodes, edges);
  return controls;
}

function nodeSelect(
  label: string,
  flowchart: MermaidFlowchart,
  selectedIndex: number,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  flowchart.nodes.forEach((node, index) => {
    const option = document.createElement('option');
    option.value = node.id;
    option.textContent = node.id;
    if (index === selectedIndex) option.setAttribute('selected', '');
    select.append(option);
  });
  return select;
}

function commandButton(label: string, action: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.textContent = label.startsWith('Delete') ? '×' : label;
  button.dataset.mermaidAction = action;
  return button;
}

function applyAction(
  flowchart: MermaidFlowchart,
  control: HTMLElement,
): MermaidFlowchart | null {
  switch (control.dataset.mermaidAction) {
    case 'add-node':
      return addFlowchartNode(flowchart);
    case 'rename-node': {
      const id = control.dataset.nodeId;
      return id === undefined
        ? null
        : renameFlowchartNode(
            flowchart,
            id,
            (control as HTMLInputElement).value,
          );
    }
    case 'delete-node': {
      const id = control.dataset.nodeId;
      return id === undefined ? null : deleteFlowchartNode(flowchart, id);
    }
    case 'add-edge': {
      const creator = control.closest('.mermaid-visual-edge-creator');
      const from = creator?.querySelector<HTMLSelectElement>(
        '[aria-label="Edge from"]',
      )?.value;
      const to = creator?.querySelector<HTMLSelectElement>(
        '[aria-label="Edge to"]',
      )?.value;
      return from === undefined || to === undefined
        ? null
        : addFlowchartEdge(flowchart, from, to);
    }
    case 'delete-edge': {
      const index = Number(control.dataset.edgeIndex);
      return Number.isInteger(index)
        ? deleteFlowchartEdge(flowchart, index)
        : null;
    }
    case 'direction': {
      const direction = flowchartDirections.find(
        (item) => item === (control as HTMLSelectElement).value,
      );
      return direction === undefined
        ? null
        : setFlowchartDirection(flowchart, direction);
    }
    default:
      return null;
  }
}

function readOwningMermaidSource(
  preview: HTMLElement,
  view: EditorView,
): string | null {
  const owner = findOwningCodeBlock(preview, view);
  return owner?.node.attrs.language === 'mermaid'
    ? owner.node.textContent
    : null;
}

function findOwningCodeBlock(
  preview: HTMLElement,
  view: EditorView,
): { node: ProseMirrorNode; position: number } | null {
  const block = preview.closest('.milkdown-code-block');
  if (block === null) return null;
  try {
    const domPosition = view.posAtDOM(block, 0);
    const directNode = view.state.doc.nodeAt(domPosition);
    if (directNode?.type.name === 'code_block') {
      return { node: directNode, position: domPosition };
    }
    const resolved = view.state.doc.resolve(domPosition);
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const node = resolved.node(depth);
      if (node.type.name === 'code_block') {
        return { node, position: resolved.before(depth) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function initializeSelectValues(
  preview: HTMLElement,
  flowchart: MermaidFlowchart,
): void {
  const controls = preview.querySelector<HTMLElement>(
    '.mermaid-visual-controls',
  );
  if (controls === null) return;
  const direction = controls.querySelector<HTMLSelectElement>(
    '[aria-label="Diagram direction"]',
  );
  if (direction !== null) direction.value = flowchart.direction;
  const edgeFrom = controls.querySelector<HTMLSelectElement>(
    '[aria-label="Edge from"]',
  );
  const edgeTo = controls.querySelector<HTMLSelectElement>(
    '[aria-label="Edge to"]',
  );
  if (edgeFrom !== null && flowchart.nodes[0] !== undefined) {
    edgeFrom.value = flowchart.nodes[0].id;
  }
  if (edgeTo !== null && flowchart.nodes[1] !== undefined) {
    edgeTo.value = flowchart.nodes[1].id;
  }
  controls.setAttribute('data-selects-ready', 'true');
}
