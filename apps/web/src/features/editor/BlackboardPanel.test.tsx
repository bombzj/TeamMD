import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./MarkdownPreview.js', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { BlackboardPanel } from './BlackboardPanel.js';

const blackboard = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Board 1',
  order: 0,
  backgroundMarkdown: '# Lesson\n',
  backgroundHash: 'a'.repeat(64),
  strokes: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      tool: 'pen' as const,
      color: '#112233',
      width: 4,
      points: [
        { x: 10, y: 20, pressure: 0.5 },
        { x: 100, y: 20, pressure: 0.5 },
      ],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe() {}
      public disconnect() {}
    },
  );
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(
      () =>
        ({
          beginPath: vi.fn(),
          clearRect: vi.fn(),
          lineTo: vi.fn(),
          moveTo: vi.fn(),
          restore: vi.fn(),
          save: vi.fn(),
          setLineDash: vi.fn(),
          setTransform: vi.fn(),
          stroke: vi.fn(),
          strokeRect: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    ),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BlackboardPanel', () => {
  it('selects a line segment, moves it in logical coordinates, and deletes it by keyboard', async () => {
    const onMoveStrokes = vi.fn();
    const onDeleteStrokes = vi.fn();
    render(
      <BlackboardPanel
        activeBlackboardId={blackboard.id}
        blackboards={[blackboard]}
        currentMarkdown="# Current\n"
        readOnly={false}
        onAddStroke={vi.fn()}
        onClear={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onDeleteStrokes={onDeleteStrokes}
        onMoveStrokes={onMoveStrokes}
        onRedo={vi.fn()}
        onRename={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'Select and move strokes' }),
    );
    const canvas = screen.getByLabelText('Board 1 drawing surface');
    configureCanvas(canvas);

    fireEvent(canvas, pointerEvent('pointerdown', 50, 20));
    fireEvent(canvas, pointerEvent('pointermove', 70, 30));
    fireEvent(canvas, pointerEvent('pointerup', 70, 30));
    expect(onMoveStrokes).toHaveBeenCalledWith(
      blackboard.id,
      [blackboard.strokes[0]?.id],
      20,
      10,
    );

    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(onDeleteStrokes).toHaveBeenCalledWith(blackboard.id, [
      blackboard.strokes[0]?.id,
    ]);
  });

  it('lassos multiple strokes and moves the group as one operation', async () => {
    const secondStroke = {
      id: '33333333-3333-4333-8333-333333333333',
      tool: 'pen' as const,
      color: '#112233',
      width: 4,
      points: [
        { x: 20, y: 60, pressure: 0.5 },
        { x: 90, y: 60, pressure: 0.5 },
      ],
    };
    const onMoveStrokes = vi.fn();
    render(
      <BlackboardPanel
        activeBlackboardId={blackboard.id}
        blackboards={[
          { ...blackboard, strokes: [...blackboard.strokes, secondStroke] },
        ]}
        currentMarkdown="# Current\n"
        readOnly={false}
        onAddStroke={vi.fn()}
        onClear={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onDeleteStrokes={vi.fn()}
        onMoveStrokes={onMoveStrokes}
        onRedo={vi.fn()}
        onRename={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const canvas = screen.getByLabelText('Board 1 drawing surface');
    configureCanvas(canvas);
    await user.click(screen.getByRole('button', { name: 'Lasso strokes' }));
    fireEvent(canvas, pointerEvent('pointerdown', 0, 0));
    fireEvent(canvas, pointerEvent('pointermove', 120, 0));
    fireEvent(canvas, pointerEvent('pointermove', 120, 80));
    fireEvent(canvas, pointerEvent('pointermove', 0, 80));
    fireEvent(canvas, pointerEvent('pointerup', 0, 0));

    fireEvent(canvas, pointerEvent('pointerdown', 50, 20));
    fireEvent(canvas, pointerEvent('pointermove', 70, 30));
    fireEvent(canvas, pointerEvent('pointerup', 70, 30));
    expect(onMoveStrokes).toHaveBeenCalledWith(
      blackboard.id,
      [blackboard.strokes[0]?.id, secondStroke.id],
      20,
      10,
    );
  });

  it('creates a closed rectangle as one validated vector stroke', async () => {
    const onAddStroke = vi.fn();
    render(
      <BlackboardPanel
        activeBlackboardId={blackboard.id}
        blackboards={[{ ...blackboard, strokes: [] }]}
        currentMarkdown="# Current\n"
        readOnly={false}
        onAddStroke={onAddStroke}
        onClear={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onDeleteStrokes={vi.fn()}
        onMoveStrokes={vi.fn()}
        onRedo={vi.fn()}
        onRename={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Rectangle' }));
    const canvas = screen.getByLabelText('Board 1 drawing surface');
    configureCanvas(canvas);
    fireEvent(canvas, pointerEvent('pointerdown', 10, 20));
    fireEvent(canvas, pointerEvent('pointermove', 110, 80));
    fireEvent(canvas, pointerEvent('pointerup', 110, 80));
    expect(onAddStroke).toHaveBeenCalledWith(
      blackboard.id,
      expect.objectContaining({
        tool: 'pen',
        points: [
          { x: 10, y: 20, pressure: 0.5 },
          { x: 110, y: 20, pressure: 0.5 },
          { x: 110, y: 80, pressure: 0.5 },
          { x: 10, y: 80, pressure: 0.5 },
          { x: 10, y: 20, pressure: 0.5 },
        ],
      }),
    );
  });

  it('zooms the sheet without changing the logical drawing size', async () => {
    render(
      <BlackboardPanel
        activeBlackboardId={blackboard.id}
        blackboards={[blackboard]}
        currentMarkdown="# Current\n"
        readOnly
        onAddStroke={vi.fn()}
        onClear={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onDeleteStrokes={vi.fn()}
        onMoveStrokes={vi.fn()}
        onRedo={vi.fn()}
        onRename={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Zoom in blackboard' }),
    );
    expect(
      screen.getByRole('button', { name: 'Reset blackboard zoom' }).textContent,
    ).toBe('125%');
    expect(screen.getByLabelText('Board 1 drawing surface')).toHaveProperty(
      'width',
      900,
    );
  });

  it('lets a viewer drag-pan without mutating the board', async () => {
    render(
      <BlackboardPanel
        activeBlackboardId={blackboard.id}
        blackboards={[blackboard]}
        currentMarkdown="# Current\n"
        readOnly
        onAddStroke={vi.fn()}
        onClear={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onDeleteStrokes={vi.fn()}
        onMoveStrokes={vi.fn()}
        onRedo={vi.fn()}
        onRename={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Pan blackboard' }),
    );
    const canvas = screen.getByLabelText('Board 1 drawing surface');
    configureCanvas(canvas);
    const scroll = canvas.closest('.blackboard-scroll');
    expect(scroll).not.toBeNull();
    if (!(scroll instanceof HTMLDivElement)) return;
    scroll.scrollLeft = 50;
    scroll.scrollTop = 30;
    fireEvent(canvas, pointerEvent('pointerdown', 100, 100));
    fireEvent(canvas, pointerEvent('pointermove', 80, 70));
    fireEvent(canvas, pointerEvent('pointerup', 80, 70));
    expect(scroll.scrollLeft).toBe(70);
    expect(scroll.scrollTop).toBe(60);
  });
});

function configureCanvas(canvas: HTMLElement) {
  Object.defineProperties(canvas, {
    getBoundingClientRect: {
      configurable: true,
      value: () => ({
        bottom: 720,
        height: 720,
        left: 0,
        right: 900,
        top: 0,
        width: 900,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    setPointerCapture: { configurable: true, value: vi.fn() },
  });
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pressure: { value: 0.5 },
  });
  return event;
}
