import DOMPurify from 'dompurify';

export const mermaidPreviewLimits = {
  maxConcurrentRenders: 1,
  maxNonblankLines: 500,
  maxSourceBytes: 64 * 1024,
  renderTimeoutMs: 3_000,
  updateDebounceMs: 150,
} as const;

type ApplyPreview = (value: null | string | HTMLElement) => void;

type MermaidEngine = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

type MermaidPreviewDependencies = {
  loadMermaid?: () => Promise<MermaidEngine>;
  sanitizeSvg?: (svg: string) => string | HTMLElement;
};

type RenderTask = () => Promise<void>;

export type MermaidPreviewRenderer = {
  destroy: () => void;
  renderPreview: (
    language: string,
    source: string,
    applyPreview: ApplyPreview,
  ) => null | undefined;
};

const encoder = new TextEncoder();
let renderSequence = 0;

export function createMermaidPreviewRenderer(
  dependencies: MermaidPreviewDependencies = {},
): MermaidPreviewRenderer {
  const loadMermaid = dependencies.loadMermaid ?? loadDefaultMermaid;
  const sanitizeSvg =
    dependencies.sanitizeSvg ??
    ((svg: string) => createMermaidPreview(sanitizeMermaidSvg(svg)));
  const previewVersions = new WeakMap<ApplyPreview, number>();
  const pendingTimers = new Set<number>();
  const renderQueue: RenderTask[] = [];
  let enginePromise: Promise<MermaidEngine> | null = null;
  let activeRenders = 0;
  let destroyed = false;

  const getEngine = () => {
    enginePromise ??= loadMermaid().then((engine) => {
      engine.initialize({
        flowchart: { htmlLabels: false },
        htmlLabels: false,
        maxTextSize: mermaidPreviewLimits.maxSourceBytes,
        securityLevel: 'strict',
        startOnLoad: false,
        suppressErrorRendering: true,
      });
      return engine;
    });
    return enginePromise;
  };

  const drainQueue = () => {
    while (
      !destroyed &&
      activeRenders < mermaidPreviewLimits.maxConcurrentRenders &&
      renderQueue.length > 0
    ) {
      const task = renderQueue.shift();
      if (task === undefined) return;
      activeRenders += 1;
      void task().finally(() => {
        activeRenders -= 1;
        drainQueue();
      });
    }
  };

  const enqueue = (task: RenderTask) => {
    renderQueue.push(task);
    drainQueue();
  };

  const renderPreview = (
    language: string,
    source: string,
    applyPreview: ApplyPreview,
  ): null | undefined => {
    const version = (previewVersions.get(applyPreview) ?? 0) + 1;
    previewVersions.set(applyPreview, version);
    if (language !== 'mermaid') return null;

    const limitError = validateSource(source);
    if (limitError !== null) {
      applyPreview(createErrorPreview(limitError));
      return undefined;
    }

    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      if (destroyed || previewVersions.get(applyPreview) !== version) return;
      enqueue(async () => {
        if (destroyed || previewVersions.get(applyPreview) !== version) return;
        try {
          const engine = await getEngine();
          const id = `teammd-mermaid-${++renderSequence}`;
          const render = engine.render(id, source);
          const result = await withResultTimeout(
            render,
            mermaidPreviewLimits.renderTimeoutMs,
          );
          if (result === null) {
            if (!destroyed && previewVersions.get(applyPreview) === version) {
              applyPreview(
                createErrorPreview(
                  'This diagram took too long to render. Edit the Mermaid source to try again.',
                ),
              );
            }
            await render.catch(() => undefined);
            return;
          }
          const { svg } = result;
          if (destroyed || previewVersions.get(applyPreview) !== version)
            return;
          applyPreview(sanitizeSvg(svg));
        } catch {
          if (destroyed || previewVersions.get(applyPreview) !== version)
            return;
          applyPreview(
            createErrorPreview(
              'This diagram could not be rendered. Edit the Mermaid source to try again.',
            ),
          );
        }
      });
    }, mermaidPreviewLimits.updateDebounceMs);
    pendingTimers.add(timer);
    return undefined;
  };

  return {
    renderPreview,
    destroy: () => {
      destroyed = true;
      pendingTimers.forEach((timer) => window.clearTimeout(timer));
      pendingTimers.clear();
      renderQueue.length = 0;
    },
  };
}

function validateSource(source: string): string | null {
  if (encoder.encode(source).byteLength > mermaidPreviewLimits.maxSourceBytes) {
    return 'This Mermaid diagram is larger than the 64 KiB preview limit.';
  }
  const nonblankLines = source
    .split(/\r?\n/u)
    .filter((line) => line.trim()).length;
  if (nonblankLines > mermaidPreviewLimits.maxNonblankLines) {
    return 'This Mermaid diagram has more than 500 nonblank lines.';
  }
  return null;
}

function createErrorPreview(message: string): HTMLElement {
  const error = document.createElement('div');
  error.className = 'mermaid-preview-error';
  error.setAttribute('role', 'status');
  error.textContent = message;
  return error;
}

export function sanitizeMermaidSvg(svg: string): string {
  const sanitized = DOMPurify.sanitize(svg, {
    FORBID_ATTR: ['href', 'style', 'xlink:href'],
    FORBID_TAGS: ['a', 'foreignObject', 'iframe', 'script', 'style'],
    SANITIZE_NAMED_PROPS: true,
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  return repairLocalSvgReferences(sanitized);
}

const svgReferenceAttributes = [
  'clip-path',
  'fill',
  'filter',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
] as const;

function repairLocalSvgReferences(svg: string): string {
  const template = document.createElement('template');
  template.innerHTML = svg;
  const root = template.content.querySelector('svg');
  if (root === null) return '';
  normalizeSvgWidth(root);
  removeDuplicateGanttTickLabels(root);
  const sanitizedIds = new Set(
    [...root.querySelectorAll('[id]')].map((element) => element.id),
  );

  root.querySelectorAll('*').forEach((element) => {
    svgReferenceAttributes.forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value === null || !value.toLowerCase().includes('url(')) return;
      const match = /^url\(#([^)]+)\)$/u.exec(value);
      if (match === null) {
        element.removeAttribute(attribute);
        return;
      }
      const id = match[1];
      if (id === undefined) {
        element.removeAttribute(attribute);
        return;
      }
      const prefixedId = id.startsWith('user-content-')
        ? id
        : `user-content-${id}`;
      if (!sanitizedIds.has(prefixedId)) {
        element.removeAttribute(attribute);
        return;
      }
      element.setAttribute(attribute, `url(#${prefixedId})`);
    });
  });

  return root.outerHTML;
}

function removeDuplicateGanttTickLabels(root: SVGSVGElement): void {
  if (root.getAttribute('aria-roledescription') !== 'gantt') return;
  let previousLabel = '';
  root.querySelectorAll('.grid .tick text').forEach((label) => {
    const value = label.textContent?.trim() ?? '';
    if (value !== '' && value === previousLabel) {
      label.remove();
      return;
    }
    previousLabel = value;
  });
}

function createMermaidPreview(svg: string): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'mermaid-preview-content';
  preview.innerHTML = svg;
  const root = preview.querySelector('svg');
  if (root === null) return preview;
  normalizeSvgWidth(root);
  fitSanitizedSvg(preview, root);
  return preview;
}

function normalizeSvgWidth(root: SVGSVGElement): void {
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number);
  const width = viewBox?.[2];
  if (width === undefined || !Number.isFinite(width) || width <= 0) return;
  root.setAttribute('width', String(Math.ceil(width)));
  root.removeAttribute('height');
}

function fitSanitizedSvg(preview: HTMLElement, root: SVGSVGElement): void {
  const measurementPreview = preview.cloneNode(true) as HTMLElement;
  const measurementRoot = measurementPreview.querySelector('svg');
  if (measurementRoot === null) return;
  const host = document.createElement('div');
  host.className = 'milkdown-host mermaid-measurement-host';
  const codeBlock = document.createElement('div');
  codeBlock.className = 'milkdown-code-block';
  const panel = document.createElement('div');
  panel.className = 'preview-panel';
  const frame = document.createElement('div');
  frame.className = 'preview';
  frame.append(measurementPreview);
  panel.append(frame);
  codeBlock.append(panel);
  host.append(codeBlock);
  document.body.append(host);
  const bounds = measurementRoot.getBBox();
  const hasValidBounds =
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0;
  if (hasValidBounds) {
    const padding = 8;
    const width = bounds.width + padding * 2;
    const height = bounds.height + padding * 2;
    root.setAttribute(
      'viewBox',
      `${bounds.x - padding} ${bounds.y - padding} ${width} ${height}`,
    );
    root.setAttribute('width', String(Math.ceil(width)));
    root.removeAttribute('height');
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
  host.remove();
}

async function loadDefaultMermaid(): Promise<MermaidEngine> {
  const module = await import('mermaid');
  return module.default;
}

async function withResultTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
