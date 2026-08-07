import {
  maximumBlackboardPointsPerStroke,
  type BlackboardPoint,
  type BlackboardSnapshot,
  type BlackboardStroke,
} from '@teammd/contracts';
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  LassoSelect,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { MarkdownPreview } from './MarkdownPreview.js';

/*
 * Keep canvas allocation independent from document height. A tall frozen
 * Markdown page is allowed to use a lower backing resolution, but it must not
 * allocate an unbounded RGBA buffer.
 */
const blackboardWidth = 900;
const minimumBlackboardHeight = 720;
const maximumBlackboardHeight = 100_000;
const blackboardVerticalPadding = 46 + 80;
const maximumCanvasBackingDimension = 16_384;
const maximumCanvasBackingPixels = 8 * 1024 * 1024;
const maximumCanvasPixelRatio = 2;
const minimumSampleDistance = 0.75;

type DrawingTool =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'select'
  | 'lasso'
  | 'pan'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'arrow';
type ShapeTool = 'line' | 'rectangle' | 'ellipse' | 'arrow';
type StrokeMove = {
  strokes: BlackboardStroke[];
  start: BlackboardPoint;
  deltaX: number;
  deltaY: number;
};
type PanMove = {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
};

type BlackboardPanelProps = {
  activeBlackboardId: string | null;
  blackboards: BlackboardSnapshot[];
  currentMarkdown: string;
  readOnly: boolean;
  onAddStroke: (blackboardId: string, stroke: BlackboardStroke) => void;
  onClear: (blackboardId: string) => void;
  onCreate: (name: string, backgroundMarkdown: string) => Promise<string>;
  onDelete: (blackboardId: string) => void;
  onDeleteStrokes: (blackboardId: string, strokeIds: string[]) => void;
  onMoveStrokes: (
    blackboardId: string,
    strokeIds: string[],
    deltaX: number,
    deltaY: number,
  ) => void;
  onRedo: () => void;
  onRename: (blackboardId: string, name: string) => void;
  onReorder: (blackboardId: string, targetIndex: number) => void;
  onSelect: (blackboardId: string) => void;
  onUndo: () => void;
};

export function BlackboardPanel({
  activeBlackboardId,
  blackboards,
  currentMarkdown,
  readOnly,
  onAddStroke,
  onClear,
  onCreate,
  onDelete,
  onDeleteStrokes,
  onMoveStrokes,
  onRedo,
  onRename,
  onReorder,
  onSelect,
  onUndo,
}: BlackboardPanelProps) {
  const active =
    blackboards.find((blackboard) => blackboard.id === activeBlackboardId) ??
    blackboards[0] ??
    null;
  const [tool, setTool] = useState<DrawingTool>('pen');
  const [color, setColor] = useState('#1f2937');
  const [width, setWidth] = useState(4);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomByBlackboard, setZoomByBlackboard] = useState<
    Record<string, number>
  >({});
  const activeIndex = active === null ? -1 : blackboards.indexOf(active);
  const zoom = active === null ? 1 : (zoomByBlackboard[active.id] ?? 1);

  const changeZoom = (nextZoom: number) => {
    if (active === null) return;
    setZoomByBlackboard((current) => ({
      ...current,
      [active.id]: Math.max(0.5, Math.min(2, nextZoom)),
    }));
  };

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const id = await onCreate(
        `Blackboard ${blackboards.length + 1}`,
        currentMarkdown,
      );
      onSelect(id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not create blackboard.',
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="blackboard-panel" aria-label="Document blackboards">
      <div className="blackboard-tabs" role="tablist" aria-label="Blackboards">
        {blackboards.map((blackboard) => (
          <button
            key={blackboard.id}
            className={`blackboard-tab${active?.id === blackboard.id ? ' active' : ''}`}
            type="button"
            role="tab"
            aria-selected={active?.id === blackboard.id}
            onClick={() => onSelect(blackboard.id)}
          >
            {blackboard.name}
          </button>
        ))}
        {!readOnly && (
          <button
            className="secondary-button compact-action"
            type="button"
            disabled={creating}
            onClick={() => void create()}
          >
            <Plus size={16} /> {creating ? 'Creating...' : 'New blackboard'}
          </button>
        )}
      </div>
      {error !== null && (
        <p className="editor-error" role="alert">
          {error}
        </p>
      )}

      {active === null ? (
        <div className="blackboard-empty">
          <h2>No blackboards yet</h2>
          <p>Create one to capture the current Markdown and draw over it.</p>
          {!readOnly && (
            <button
              className="primary-action compact-action"
              type="button"
              disabled={creating}
              onClick={() => void create()}
            >
              <Plus size={17} /> Create blackboard
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="blackboard-toolbar" aria-label="Blackboard tools">
            {!readOnly && (
              <>
                <ToolButton
                  active={tool === 'pen'}
                  label="Pen"
                  onClick={() => setTool('pen')}
                >
                  <PenLine size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'highlighter'}
                  label="Highlighter"
                  onClick={() => setTool('highlighter')}
                >
                  <Highlighter size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'eraser'}
                  label="Stroke eraser"
                  onClick={() => setTool('eraser')}
                >
                  <Eraser size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'select'}
                  label="Select and move strokes"
                  onClick={() => setTool('select')}
                >
                  <MousePointer2 size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'lasso'}
                  label="Lasso strokes"
                  onClick={() => setTool('lasso')}
                >
                  <LassoSelect size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'line'}
                  label="Straight line"
                  onClick={() => setTool('line')}
                >
                  <Minus size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'rectangle'}
                  label="Rectangle"
                  onClick={() => setTool('rectangle')}
                >
                  <Square size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'ellipse'}
                  label="Ellipse"
                  onClick={() => setTool('ellipse')}
                >
                  <Circle size={17} />
                </ToolButton>
                <ToolButton
                  active={tool === 'arrow'}
                  label="Arrow"
                  onClick={() => setTool('arrow')}
                >
                  <MoveUpRight size={17} />
                </ToolButton>
                <ToolButton
                  active={false}
                  label="Undo blackboard"
                  onClick={onUndo}
                >
                  <Undo2 size={17} />
                </ToolButton>
                <ToolButton
                  active={false}
                  label="Redo blackboard"
                  onClick={onRedo}
                >
                  <Redo2 size={17} />
                </ToolButton>
                <label className="blackboard-field">
                  Color
                  <input
                    type="color"
                    value={color}
                    disabled={!supportsStyle(tool)}
                    onChange={(event) => setColor(event.target.value)}
                  />
                </label>
                <label className="blackboard-field blackboard-width">
                  Width
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={width}
                    disabled={!supportsStyle(tool)}
                    onChange={(event) => setWidth(Number(event.target.value))}
                  />
                </label>
                <button
                  className="secondary-button compact-action"
                  type="button"
                  onClick={() => {
                    const next = window.prompt('Blackboard name', active.name);
                    if (next?.trim()) onRename(active.id, next);
                  }}
                >
                  Rename
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Move blackboard left"
                  title="Move blackboard left"
                  disabled={activeIndex <= 0}
                  onClick={() => onReorder(active.id, activeIndex - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Move blackboard right"
                  title="Move blackboard right"
                  disabled={
                    activeIndex < 0 || activeIndex >= blackboards.length - 1
                  }
                  onClick={() => onReorder(active.id, activeIndex + 1)}
                >
                  <ChevronRight size={17} />
                </button>
                <button
                  className="secondary-button compact-action"
                  type="button"
                  disabled={active.strokes.length === 0}
                  onClick={() => {
                    if (
                      window.confirm('Clear every stroke from this blackboard?')
                    ) {
                      onClear(active.id);
                    }
                  }}
                >
                  <RotateCcw size={16} /> Clear
                </button>
                <button
                  className="danger-button compact-action"
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${active.name}?`))
                      onDelete(active.id);
                  }}
                >
                  <Trash2 size={16} /> Delete
                </button>
              </>
            )}
            <ToolButton
              active={tool === 'pan'}
              label="Pan blackboard"
              onClick={() => setTool('pan')}
            >
              <Hand size={17} />
            </ToolButton>
            <button
              className="icon-button"
              type="button"
              aria-label="Zoom out blackboard"
              title="Zoom out blackboard"
              disabled={zoom <= 0.5}
              onClick={() => changeZoom(zoom - 0.25)}
            >
              <ZoomOut size={17} />
            </button>
            <button
              className="secondary-button compact-action blackboard-zoom-value"
              type="button"
              aria-label="Reset blackboard zoom"
              title="Reset blackboard zoom"
              onClick={() => changeZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Zoom in blackboard"
              title="Zoom in blackboard"
              disabled={zoom >= 2}
              onClick={() => changeZoom(zoom + 0.25)}
            >
              <ZoomIn size={17} />
            </button>
            <span className="blackboard-copy-label">Frozen Markdown copy</span>
          </div>
          <BlackboardSurface
            blackboard={active}
            color={color}
            readOnly={readOnly}
            tool={tool}
            width={width}
            onAddStroke={onAddStroke}
            onDeleteStrokes={onDeleteStrokes}
            onMoveStrokes={onMoveStrokes}
            onUndo={onUndo}
            onRedo={onRedo}
            onToolChange={setTool}
            zoom={zoom}
          />
        </>
      )}
    </section>
  );
}

function ToolButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`icon-button${active ? ' active' : ''}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function BlackboardSurface({
  blackboard,
  color,
  readOnly,
  tool,
  width,
  onAddStroke,
  onDeleteStrokes,
  onMoveStrokes,
  onUndo,
  onRedo,
  onToolChange,
  zoom,
}: {
  blackboard: BlackboardSnapshot;
  color: string;
  readOnly: boolean;
  tool: DrawingTool;
  width: number;
  onAddStroke: (blackboardId: string, stroke: BlackboardStroke) => void;
  onDeleteStrokes: (blackboardId: string, strokeIds: string[]) => void;
  onMoveStrokes: (
    blackboardId: string,
    strokeIds: string[],
    deltaX: number,
    deltaY: number,
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToolChange: (tool: DrawingTool) => void;
  zoom: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundContentRef = useRef<HTMLDivElement | null>(null);
  const canvasScaleRef = useRef(1);
  const transientFrameRef = useRef<number | null>(null);
  const [height, setHeight] = useState(minimumBlackboardHeight);
  const [draft, setDraft] = useState<BlackboardStroke | null>(null);
  const draftRef = useRef<BlackboardStroke | null>(null);
  const gestureStartRef = useRef<BlackboardPoint | null>(null);
  const [lasso, setLasso] = useState<BlackboardPoint[]>([]);
  const lassoRef = useRef<BlackboardPoint[]>([]);
  const panRef = useRef<PanMove | null>(null);
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const [move, setMove] = useState<StrokeMove | null>(null);
  const moveRef = useRef<StrokeMove | null>(null);
  const scheduleTransientRender = () => {
    if (transientFrameRef.current !== null) return;
    transientFrameRef.current = window.requestAnimationFrame(() => {
      transientFrameRef.current = null;
      setDraft(draftRef.current);
      setLasso(lassoRef.current);
      setMove(moveRef.current);
    });
  };
  const cancelTransientRender = () => {
    if (transientFrameRef.current === null) return;
    window.cancelAnimationFrame(transientFrameRef.current);
    transientFrameRef.current = null;
  };
  const strokes = useMemo(() => {
    let visible = blackboard.strokes;
    if (move !== null) {
      const movingIds = new Set(move.strokes.map((stroke) => stroke.id));
      visible = visible.map((stroke) =>
        movingIds.has(stroke.id)
          ? translateStroke(stroke, move.deltaX, move.deltaY)
          : stroke,
      );
    }
    return draft === null ? visible : [...visible, draft];
  }, [blackboard.strokes, draft, move]);

  useEffect(() => {
    if (transientFrameRef.current !== null) {
      window.cancelAnimationFrame(transientFrameRef.current);
      transientFrameRef.current = null;
    }
    setSelectedStrokeIds([]);
    setDraft(null);
    draftRef.current = null;
    gestureStartRef.current = null;
    setLasso([]);
    lassoRef.current = [];
    panRef.current = null;
    setMove(null);
    moveRef.current = null;
  }, [blackboard.id]);

  useEffect(() => {
    const available = new Set(blackboard.strokes.map((stroke) => stroke.id));
    setSelectedStrokeIds((current) =>
      current.every((strokeId) => available.has(strokeId))
        ? current
        : current.filter((strokeId) => available.has(strokeId)),
    );
  }, [blackboard.strokes]);

  useLayoutEffect(() => {
    const content = backgroundContentRef.current;
    if (content === null) return;
    let measurementFrame: number | null = null;
    const measure = () => {
      measurementFrame = null;
      const nextHeight = Math.min(
        maximumBlackboardHeight,
        Math.max(
          minimumBlackboardHeight,
          Math.ceil(content.scrollHeight + blackboardVerticalPadding),
        ),
      );
      setHeight((current) => (current === nextHeight ? current : nextHeight));
    };
    const scheduleMeasurement = () => {
      if (measurementFrame !== null) return;
      measurementFrame = window.requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasurement);
    observer.observe(content);
    scheduleMeasurement();
    return () => {
      observer.disconnect();
      if (measurementFrame !== null) {
        window.cancelAnimationFrame(measurementFrame);
      }
    };
  }, [blackboard.id, blackboard.backgroundMarkdown]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const requestedRatio = canvasBackingRatio(height, window.devicePixelRatio);
    const backingWidth = Math.max(
      1,
      Math.floor(blackboardWidth * requestedRatio),
    );
    const backingHeight = Math.max(1, Math.floor(height * requestedRatio));
    canvasScaleRef.current = Math.min(
      backingWidth / blackboardWidth,
      backingHeight / height,
    );
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }, [height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const ratio = canvasScaleRef.current;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, blackboardWidth, height);
    for (const stroke of strokes) drawStroke(context, stroke);
    const selectedIds = new Set(selectedStrokeIds);
    for (const stroke of strokes) {
      if (selectedIds.has(stroke.id)) drawSelection(context, stroke);
    }
    if (lasso.length > 0) drawLasso(context, lasso);
  }, [height, lasso, selectedStrokeIds, strokes]);

  useEffect(() => {
    const mountedCanvas = canvasRef.current;
    return () => {
      if (transientFrameRef.current !== null) {
        window.cancelAnimationFrame(transientFrameRef.current);
        transientFrameRef.current = null;
      }
      if (mountedCanvas !== null) {
        // Release the browser's native backing store immediately on unmount.
        mountedCanvas.width = 1;
        mountedCanvas.height = 1;
      }
    };
  }, []);

  const pointFor = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): BlackboardPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x:
        ((event.clientX - bounds.left) / Math.max(1, bounds.width)) *
        blackboardWidth,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height,
      pressure: event.pressure > 0 ? event.pressure : 0.5,
    };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan') {
      const scroll = scrollRef.current;
      if (scroll === null) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop,
      };
      return;
    }
    if (readOnly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFor(event);
    if (tool === 'eraser') {
      const stroke = nearestStroke(blackboard.strokes, point);
      if (stroke !== null) onDeleteStrokes(blackboard.id, [stroke.id]);
      return;
    }
    if (tool === 'lasso') {
      setSelectedStrokeIds([]);
      lassoRef.current = [point];
      setLasso([point]);
      return;
    }
    if (tool === 'select') {
      const stroke = nearestStroke(blackboard.strokes, point);
      if (stroke === null) {
        setSelectedStrokeIds([]);
        return;
      }
      const nextSelection = event.shiftKey
        ? selectedStrokeIds.includes(stroke.id)
          ? selectedStrokeIds.filter((strokeId) => strokeId !== stroke.id)
          : [...selectedStrokeIds, stroke.id]
        : selectedStrokeIds.includes(stroke.id)
          ? selectedStrokeIds
          : [stroke.id];
      setSelectedStrokeIds(nextSelection);
      if (nextSelection.includes(stroke.id)) {
        const selected = blackboard.strokes.filter((candidate) =>
          nextSelection.includes(candidate.id),
        );
        const nextMove = {
          strokes: selected,
          start: point,
          deltaX: 0,
          deltaY: 0,
        };
        moveRef.current = nextMove;
        setMove(nextMove);
      }
      return;
    }
    if (isShapeTool(tool)) {
      gestureStartRef.current = point;
      const nextDraft = shapeStroke(
        crypto.randomUUID(),
        tool,
        color,
        width,
        point,
        point,
      );
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }
    const nextDraft: BlackboardStroke = {
      id: crypto.randomUUID(),
      tool: tool === 'highlighter' ? 'highlighter' : 'pen',
      color,
      width,
      points: [point],
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  };

  return (
    <div ref={scrollRef} className="blackboard-scroll">
      <div
        className="blackboard-sheet-frame"
        style={{
          height: height * zoom,
          width: blackboardWidth * zoom,
        }}
      >
        <div
          className="blackboard-sheet"
          style={{ height, transform: `scale(${zoom})` }}
        >
          <div className="blackboard-background">
            <div
              ref={backgroundContentRef}
              className="blackboard-background-content"
            >
              <MarkdownPreview content={blackboard.backgroundMarkdown} />
            </div>
          </div>
          <canvas
            ref={canvasRef}
            className={`blackboard-drawing ${readOnly ? 'read-only ' : ''}${tool}`}
            aria-label={`${blackboard.name} drawing surface`}
            tabIndex={0}
            onPointerDown={pointerDown}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                return;
              if (panRef.current !== null) {
                const scroll = scrollRef.current;
                if (scroll === null) return;
                scroll.scrollLeft =
                  panRef.current.scrollLeft -
                  (event.clientX - panRef.current.clientX);
                scroll.scrollTop =
                  panRef.current.scrollTop -
                  (event.clientY - panRef.current.clientY);
                return;
              }
              const point = pointFor(event);
              if (lassoRef.current.length > 0) {
                const nextLasso = appendSample(lassoRef.current, point);
                if (nextLasso === lassoRef.current) return;
                lassoRef.current = nextLasso;
                scheduleTransientRender();
                return;
              }
              if (moveRef.current !== null) {
                const current = moveRef.current;
                const [deltaX, deltaY] = boundedMovement(
                  current.strokes,
                  point.x - current.start.x,
                  point.y - current.start.y,
                  height,
                );
                const nextMove = { ...current, deltaX, deltaY };
                moveRef.current = nextMove;
                scheduleTransientRender();
                return;
              }
              if (draftRef.current === null) return;
              if (isShapeTool(tool) && gestureStartRef.current !== null) {
                const nextDraft = shapeStroke(
                  draftRef.current.id,
                  tool,
                  color,
                  width,
                  gestureStartRef.current,
                  point,
                );
                draftRef.current = nextDraft;
                scheduleTransientRender();
                return;
              }
              const nextPoints = appendSample(draftRef.current.points, point);
              if (nextPoints === draftRef.current.points) return;
              const nextDraft = {
                ...draftRef.current,
                points: nextPoints,
              };
              draftRef.current = nextDraft;
              scheduleTransientRender();
            }}
            onPointerUp={(event) => {
              cancelTransientRender();
              if (panRef.current !== null) {
                panRef.current = null;
              }
              if (lassoRef.current.length > 0) {
                const selected = blackboard.strokes
                  .filter((stroke) =>
                    strokeInsideLasso(stroke, lassoRef.current),
                  )
                  .map((stroke) => stroke.id);
                setSelectedStrokeIds(selected);
                lassoRef.current = [];
                setLasso([]);
                onToolChange('select');
              }
              const completedMove = moveRef.current;
              if (
                completedMove !== null &&
                (completedMove.deltaX !== 0 || completedMove.deltaY !== 0)
              ) {
                onMoveStrokes(
                  blackboard.id,
                  completedMove.strokes.map((stroke) => stroke.id),
                  completedMove.deltaX,
                  completedMove.deltaY,
                );
              }
              const completedDraft = draftRef.current;
              if (completedDraft !== null) {
                onAddStroke(blackboard.id, completedDraft);
              }
              moveRef.current = null;
              setMove(null);
              gestureStartRef.current = null;
              draftRef.current = null;
              setDraft(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => {
              cancelTransientRender();
              panRef.current = null;
              lassoRef.current = [];
              setLasso([]);
              moveRef.current = null;
              setMove(null);
              gestureStartRef.current = null;
              draftRef.current = null;
              setDraft(null);
            }}
            onKeyDown={(event) => {
              if (
                !readOnly &&
                selectedStrokeIds.length > 0 &&
                (event.key === 'Delete' || event.key === 'Backspace')
              ) {
                event.preventDefault();
                onDeleteStrokes(blackboard.id, selectedStrokeIds);
                setSelectedStrokeIds([]);
                return;
              }
              if (
                !readOnly &&
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === 'z'
              ) {
                event.preventDefault();
                if (event.shiftKey) onRedo();
                else onUndo();
                return;
              }
              if (
                !readOnly &&
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === 'y'
              ) {
                event.preventDefault();
                onRedo();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: BlackboardStroke,
) {
  const [first, ...rest] = stroke.points;
  if (first === undefined) return;
  context.save();
  context.globalAlpha = stroke.tool === 'highlighter' ? 0.3 : 1;
  context.strokeStyle = stroke.color;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (stroke.tool === 'pen' && rest.length > 0) {
    let previous = first;
    for (const point of rest) {
      context.lineWidth =
        stroke.width * (0.5 + (previous.pressure + point.pressure) / 2);
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      previous = point;
    }
    context.restore();
    return;
  }
  context.lineWidth = stroke.width;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  if (rest.length === 0) context.lineTo(first.x + 0.01, first.y + 0.01);
  context.stroke();
  context.restore();
}

function drawLasso(
  context: CanvasRenderingContext2D,
  points: BlackboardPoint[],
) {
  const [first, ...rest] = points;
  if (first === undefined) return;
  context.save();
  context.strokeStyle = '#315f89';
  context.lineWidth = 1.5;
  context.setLineDash([6, 4]);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  context.stroke();
  context.restore();
}

function drawSelection(
  context: CanvasRenderingContext2D,
  stroke: BlackboardStroke,
) {
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of stroke.points) {
    minimumX = Math.min(minimumX, point.x);
    maximumX = Math.max(maximumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumY = Math.max(maximumY, point.y);
  }
  if (!Number.isFinite(minimumX) || !Number.isFinite(minimumY)) return;
  const padding = Math.max(8, stroke.width);
  const left = minimumX - padding;
  const top = minimumY - padding;
  const width = maximumX - minimumX + padding * 2;
  const height = maximumY - minimumY + padding * 2;
  context.save();
  context.strokeStyle = '#315f89';
  context.lineWidth = 1.5;
  context.setLineDash([6, 4]);
  context.strokeRect(left, top, Math.max(width, 16), Math.max(height, 16));
  context.restore();
}

function translateStroke(
  stroke: BlackboardStroke,
  deltaX: number,
  deltaY: number,
): BlackboardStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({
      ...point,
      x: point.x + deltaX,
      y: point.y + deltaY,
    })),
  };
}

function boundedMovement(
  strokes: BlackboardStroke[],
  deltaX: number,
  deltaY: number,
  sheetHeight: number,
): [number, number] {
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      minimumX = Math.min(minimumX, point.x);
      maximumX = Math.max(maximumX, point.x);
      minimumY = Math.min(minimumY, point.y);
      maximumY = Math.max(maximumY, point.y);
    }
  }
  if (!Number.isFinite(minimumX) || !Number.isFinite(minimumY)) return [0, 0];
  return [
    Math.max(-minimumX, Math.min(deltaX, blackboardWidth - maximumX)),
    Math.max(-minimumY, Math.min(deltaY, sheetHeight - maximumY)),
  ];
}

function supportsStyle(tool: DrawingTool): boolean {
  return (
    tool === 'pen' ||
    tool === 'highlighter' ||
    tool === 'line' ||
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'arrow'
  );
}

function isShapeTool(tool: DrawingTool): tool is ShapeTool {
  return (
    tool === 'line' ||
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'arrow'
  );
}

function shapeStroke(
  id: string,
  tool: ShapeTool,
  color: string,
  width: number,
  start: BlackboardPoint,
  end: BlackboardPoint,
): BlackboardStroke {
  let points: BlackboardPoint[];
  if (tool === 'rectangle') {
    points = [
      start,
      { ...start, x: end.x },
      end,
      { ...end, x: start.x },
      start,
    ];
  } else if (tool === 'ellipse') {
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    points = Array.from({ length: 49 }, (_, index) => {
      const angle = (index / 48) * Math.PI * 2;
      return {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
        pressure: end.pressure,
      };
    });
  } else if (tool === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const headLength = Math.min(
      24,
      Math.max(10, Math.hypot(end.x - start.x, end.y - start.y) / 3),
    );
    const head = (offset: number): BlackboardPoint => ({
      x: end.x - Math.cos(angle + offset) * headLength,
      y: end.y - Math.sin(angle + offset) * headLength,
      pressure: end.pressure,
    });
    points = [start, end, head(Math.PI / 6), end, head(-Math.PI / 6)];
  } else {
    points = [start, end];
  }
  return { id, tool: 'pen', color, width, points };
}

function strokeInsideLasso(
  stroke: BlackboardStroke,
  lasso: BlackboardPoint[],
): boolean {
  if (lasso.length < 3) return false;
  return stroke.points.every((point) => pointInsidePolygon(point, lasso));
}

function pointInsidePolygon(
  point: BlackboardPoint,
  polygon: BlackboardPoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (currentPoint === undefined || previousPoint === undefined) continue;
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function nearestStroke(
  strokes: BlackboardStroke[],
  point: BlackboardPoint,
): BlackboardStroke | null {
  let match: BlackboardStroke | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const stroke of strokes) {
    const threshold = Math.max(20, stroke.width / 2 + 8);
    for (const [index, candidate] of stroke.points.entries()) {
      const previous = stroke.points[index - 1];
      const next =
        previous === undefined
          ? Math.hypot(candidate.x - point.x, candidate.y - point.y)
          : distanceToSegment(point, previous, candidate);
      if (next < distance && next <= threshold) {
        match = stroke;
        distance = next;
      }
    }
  }
  return match;
}

function distanceToSegment(
  point: BlackboardPoint,
  start: BlackboardPoint,
  end: BlackboardPoint,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const position = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + position * deltaX),
    point.y - (start.y + position * deltaY),
  );
}

function appendSample(
  points: BlackboardPoint[],
  point: BlackboardPoint,
): BlackboardPoint[] {
  if (points.length >= maximumBlackboardPointsPerStroke) return points;
  const previous = points.at(-1);
  if (
    previous !== undefined &&
    Math.hypot(point.x - previous.x, point.y - previous.y) <
      minimumSampleDistance
  ) {
    return points;
  }
  return [...points, point];
}

function canvasBackingRatio(height: number, devicePixelRatio: number): number {
  const requestedRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? Math.min(devicePixelRatio, maximumCanvasPixelRatio)
      : 1;
  const pixelLimitedRatio = Math.sqrt(
    maximumCanvasBackingPixels / (blackboardWidth * Math.max(1, height)),
  );
  const dimensionLimitedRatio =
    maximumCanvasBackingDimension /
    Math.max(blackboardWidth, Math.max(1, height));
  return Math.max(
    Number.EPSILON,
    Math.min(requestedRatio, pixelLimitedRatio, dimensionLimitedRatio),
  );
}
