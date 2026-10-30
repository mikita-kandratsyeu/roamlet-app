import type { Map as RouteMap } from 'maplibre-gl';
import { afterEach, expect, it, vi } from 'vitest';
import type { Coordinate, Waypoint } from '../domain/types';
import { installRouteLineDrag } from './routeLineDrag';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

function setup() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, right: 110, bottom: 120,
    width: 100, height: 100, x: 10, y: 20, toJSON: () => ({}) });
  const onInsert = vi.fn();
  let route = {
    editable: true, comparisonMode: false, routeStale: false,
    segments: [[[0, 0], [1, 0], [1, 1], [0, 1]]] as Coordinate[][],
    waypoints: [
      { id: 'a', name: 'Start', coordinate: [0, 0] },
      { id: 'b', name: 'Turn', coordinate: [1, 0] },
      { id: 'c', name: 'Finish', coordinate: [0, 1] },
    ] as Waypoint[],
    onInsert: onInsert as ((coordinate: Coordinate, index: number) => void) | undefined,
  };
  let panEnabled = true;
  const map = {
    getCanvas: () => canvas,
    getLayer: vi.fn(() => ({})),
    queryRenderedFeatures: vi.fn(() => [{}]),
    unproject: ([x, y]: number[]) => ({ lng: x / 100, lat: y / 100 }),
    dragPan: { isEnabled: () => panEnabled,
      enable: vi.fn(() => { panEnabled = true; }),
      disable: vi.fn(() => { panEnabled = false; }) },
  };
  const preview = vi.fn();
  const suppress = vi.fn();
  const drag = installRouteLineDrag(map as unknown as RouteMap, () => route, preview, suppress);
  cleanups.push(drag.destroy);
  const pointer = (type: string, x: number, y: number, options: MouseEventInit & { pointerId?: number } = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true,
      clientX: x + 10, clientY: y + 20, button: 0, ...options });
    Object.defineProperty(event, 'pointerId', { value: options.pointerId ?? 1 });
    (type === 'pointerdown' ? canvas : window).dispatchEvent(event);
    return event;
  };
  return { canvas, map, onInsert, preview, suppress, drag, pointer,
    update: (patch: Partial<typeof route>) => { route = { ...route, ...patch }; },
    disablePan: () => { panEnabled = false; } };
}

it('previews a dragged point without committing and inserts once at release into the original leg', () => {
  const state = setup();
  expect(state.pointer('pointerdown', 50, 0).defaultPrevented).toBe(true);
  expect(state.map.dragPan.disable).toHaveBeenCalledOnce();
  state.pointer('pointermove', 50, 90);
  expect(state.preview).toHaveBeenLastCalledWith([[0, 0], [0.5, 0.9], [1, 0]]);
  expect(state.onInsert).not.toHaveBeenCalled();
  state.pointer('pointerup', 60, 80);
  expect(state.onInsert).toHaveBeenCalledExactlyOnceWith([0.6, 0.8], 1);
  expect(state.preview).toHaveBeenLastCalledWith(null);
  expect(state.map.dragPan.enable).toHaveBeenCalledExactlyOnceWith({ maxSpeed: 0 });
  expect(state.suppress).toHaveBeenLastCalledWith(expect.any(Number));
  state.pointer('pointerup', 60, 80);
  expect(state.onInsert).toHaveBeenCalledOnce();
});

it('keeps a click and small pointer jitter projected onto the route', () => {
  const state = setup();
  state.pointer('pointerdown', 50, 0);
  state.pointer('pointermove', 52, 1);
  expect(state.preview).not.toHaveBeenCalled();
  state.pointer('pointerup', 52, 1);
  expect(state.onInsert).toHaveBeenCalledExactlyOnceWith([0.5, 0], 1);
});

it.each(['readonly', 'comparison', 'stale', 'no-insert', 'no-hit', 'no-layer', 'endpoint', 'secondary', 'modified'])(
  'does not intercept map navigation for %s', (mode) => {
    const state = setup();
    if (mode === 'readonly') state.update({ editable: false });
    if (mode === 'comparison') state.update({ comparisonMode: true });
    if (mode === 'stale') state.update({ routeStale: true });
    if (mode === 'no-insert') state.update({ onInsert: undefined });
    if (mode === 'no-hit') state.map.queryRenderedFeatures.mockReturnValue([]);
    if (mode === 'no-layer') state.map.getLayer.mockReturnValue(undefined as unknown as object);
    const event = state.pointer('pointerdown', mode === 'endpoint' ? 0 : 50, 0,
      mode === 'secondary' ? { button: 2 } : mode === 'modified' ? { ctrlKey: true } : {});
    expect(event.defaultPrevented).toBe(false);
    expect(state.drag.isActive()).toBe(false);
    expect(state.map.dragPan.disable).not.toHaveBeenCalled();
    state.pointer('pointerup', 50, 20);
    expect(state.onInsert).not.toHaveBeenCalled();
  },
);

it.each(['escape', 'cancel', 'blur', 'outside', 'second-touch', 'destroy', 'route-changed', 'readonly'])(
  'cancels without inserting on %s and restores navigation', (reason) => {
    const state = setup();
    state.pointer('pointerdown', 50, 0);
    state.pointer('pointermove', 50, 20);
    if (reason === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (reason === 'cancel') state.pointer('pointercancel', 50, 20);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'outside') state.pointer('pointerup', 120, 20);
    if (reason === 'second-touch') state.pointer('pointerdown', 60, 20, { pointerId: 2 });
    if (reason === 'destroy') state.drag.destroy();
    if (reason === 'route-changed') {
      state.update({ segments: [[[0, 0], [1, 0]]] });
      state.pointer('pointerup', 50, 20);
    }
    if (reason === 'readonly') {
      state.update({ editable: false });
      state.pointer('pointermove', 50, 30);
    }
    expect(state.drag.isActive()).toBe(false);
    expect(state.onInsert).not.toHaveBeenCalled();
    expect(state.preview).toHaveBeenLastCalledWith(null);
    expect(state.map.dragPan.enable).toHaveBeenCalledOnce();
  },
);

it('ignores other pointers and preserves an initially disabled pan handler', () => {
  const state = setup();
  state.disablePan();
  state.pointer('pointerdown', 50, 0);
  state.pointer('pointermove', 50, 40, { pointerId: 2 });
  state.pointer('pointerup', 50, 40, { pointerId: 2 });
  expect(state.drag.isActive()).toBe(true);
  expect(state.preview).not.toHaveBeenCalled();
  state.pointer('pointerup', 50, 40);
  expect(state.onInsert).toHaveBeenCalledExactlyOnceWith([0.5, 0.4], 1);
  expect(state.map.dragPan.enable).not.toHaveBeenCalled();
});

it('blocks native map gestures only during line editing and removes listeners on cleanup', () => {
  const state = setup();
  state.pointer('pointerdown', 50, 0);
  const event = new Event('touchstart', { cancelable: true });
  state.canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  state.drag.destroy();
  const after = new Event('touchstart', { cancelable: true });
  state.canvas.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  state.pointer('pointerdown', 50, 0);
  expect(state.drag.isActive()).toBe(false);
});
