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
  sanitizeSvg?: (svg: string) => string;
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
  const sanitizeSvg = dependencies.sanitizeSvg ?? sanitizeMermaidSvg;
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
  return DOMPurify.sanitize(svg, {
    FORBID_ATTR: ['href', 'style', 'xlink:href'],
    FORBID_TAGS: ['a', 'foreignObject', 'iframe', 'script', 'style'],
    SANITIZE_NAMED_PROPS: true,
    USE_PROFILES: { svg: true, svgFilters: true },
  });
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
