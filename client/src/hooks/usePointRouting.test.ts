import { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePointRouting } from './usePointRouting';
import { useRouteEditor } from './useRouteEditor';
import { initialEditor, type EditorSnapshot } from '../domain/editorSnapshot';
import { isRouteResultCurrent, routingInputKey } from '../domain/editorRouting';
import { routingProvider } from '../services/routing';
import type { PlannedRoute, RoutingResult, Waypoint } from '../domain/types';

const notification = { success: vi.fn(), error: vi.fn() };
const onStart = vi.fn(() => notification);
const points: Waypoint[] = [
  { id: 'a', name: 'A', coordinate: [11.4, 47.26] },
  { id: 'b', name: 'B', coordinate: [11.41, 47.27] },
];
function initial(): EditorSnapshot {
  const snapshot = initialEditor();
  snapshot.waypoints = points;
  snapshot.result = {
    ...snapshot.identity,
    name: 'Previous ready route',
    description: '',
    activity: 'cycling',
    waypoints: points,
    segments: [points.map((point) => point.coordinate)],
    stats: { distance: 1000, duration: 100 },
    source: 'openrouteservice',
    updatedAt: new Date().toISOString(),
    routingInputKey: routingInputKey(snapshot),
  };
  return snapshot;
}
function useHarness(snapshot: EditorSnapshot, online: boolean, revision = 0) {
  const editor = useRouteEditor(snapshot);
  const once = useRef(true);
  if (once.current) {
    editor.routingAllowed.current = true;
    once.current = false;
  }
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error: boolean;
    kind?: 'routing' | 'map';
  } | null>(null);
  usePointRouting({
    snapshot: editor.snapshot,
    revision,
    online,
    allowed: editor.routingAllowed,
    request,
    setBusy,
    setNotice,
    setResult: editor.setResult,
    setRouteStale: editor.setRouteStale,
    onStart,
  });
  return { editor, busy, notice, request };
}
const calculated: RoutingResult = {
  segments: [
    [
      [11.4, 47.26, 600],
      [11.41, 47.27, 620],
    ],
  ],
  stats: { distance: 1200, duration: 120, ascent: 20, descent: 0 },
  elevationSource: 'openrouteservice',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function runDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}
describe('retaining ready geometry while stale routing is pending', () => {
  it('preserves previous result until success and persists freshness/provenance/options', async () => {
    let resolve!: (value: RoutingResult) => void;
    const calculate = vi.spyOn(routingProvider, 'calculateRoute').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const snapshot = initial();
    const { result } = renderHook(() => useHarness(snapshot, true));
    expect(result.current.editor.result).toBe(snapshot.result);
    expect(result.current.editor.routeStale).toBe(true);
    expect(isRouteResultCurrent(result.current.editor.snapshot)).toBe(false);
    expect(result.current.busy).toBe(true);
    expect(onStart).toHaveBeenCalledWith(result.current.request.current);
    expect(notification.success).not.toHaveBeenCalled();
    await runDebounce();
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(result.current.editor.result).toBe(snapshot.result);
    await act(async () => {
      resolve(calculated);
    });
    expect(result.current.editor.result?.segments).toEqual(calculated.segments);
    expect(result.current.editor.result?.elevationSource).toBe('openrouteservice');
    expect(result.current.editor.result?.routingOptions).toEqual(snapshot.routingOptions);
    expect(result.current.editor.routeStale).toBe(false);
    expect(isRouteResultCurrent(result.current.editor.snapshot)).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(notification.success).toHaveBeenCalledOnce();
    expect(notification.error).not.toHaveBeenCalled();
  });
  it('does not restart routing for waypoint names and applies current names to the result', async () => {
    let resolve!: (value: RoutingResult) => void;
    const calculate = vi.spyOn(routingProvider, 'calculateRoute').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useHarness(initial(), true));
    const controller = result.current.request.current!;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    act(() =>
      result.current.editor.setWaypoints((current) =>
        current.map((point) => ({ ...point, name: `${point.name} renamed` })),
      ),
    );
    expect(controller.signal.aborted).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(calculate).toHaveBeenCalledTimes(1);
    act(() =>
      result.current.editor.setWaypoints((current) =>
        current.map((point) => ({ ...point, name: `${point.name} again` })),
      ),
    );
    expect(controller.signal.aborted).toBe(false);
    await act(async () => {
      resolve(calculated);
    });
    expect(result.current.editor.result?.waypoints.map((point) => point.name)).toEqual([
      'A renamed again',
      'B renamed again',
    ]);
    const geometry = result.current.editor.result!.segments;
    act(() => {
      result.current.editor.checkpoint(true);
      result.current.editor.setWaypoints((current) =>
        current.map((point) => ({ ...point, name: `${point.name} final` })),
      );
    });
    await runDebounce();
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(result.current.editor.result?.waypoints.map((point) => point.name)).toEqual([
      'A renamed again final',
      'B renamed again final',
    ]);
    expect(result.current.editor.result?.segments).toBe(geometry);
    expect(result.current.editor.routeStale).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(notification.success).toHaveBeenCalledTimes(1);
    expect(result.current.editor.undoChangesGeometry).toBe(false);
    act(() => result.current.editor.undo());
    expect(result.current.editor.result?.waypoints[0].name).toBe('A renamed again');
    expect(result.current.editor.result?.segments).toBe(geometry);
    act(() => result.current.editor.redo());
    expect(result.current.editor.result?.waypoints[0].name).toBe('A renamed again final');
    await runDebounce();
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(result.current.editor.routingAllowed.current).toBe(true);
  });
  it('preserves explicit retry for unchanged inputs and aborts it on unmount', async () => {
    const calculate = vi
      .spyOn(routingProvider, 'calculateRoute')
      .mockResolvedValueOnce(calculated)
      .mockImplementation(() => new Promise(() => {}));
    const snapshot = initial();
    const { result, rerender, unmount } = renderHook(
      ({ revision }) => useHarness(snapshot, true, revision),
      { initialProps: { revision: 0 } },
    );
    await runDebounce();
    expect(result.current.busy).toBe(false);
    rerender({ revision: 1 });
    await runDebounce();
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(result.current.busy).toBe(true);
    const controller = result.current.request.current!;
    unmount();
    expect(controller.signal.aborted).toBe(true);
  });
  it('keeps geometry stale and nonexportable after a service error or notice dismissal', async () => {
    vi.spyOn(routingProvider, 'calculateRoute').mockRejectedValue(
      new Error('Routing quota reached.'),
    );
    const snapshot = initial();
    const { result } = renderHook(() => useHarness(snapshot, true));
    await runDebounce();
    expect(result.current.editor.result).toBe(snapshot.result);
    expect(result.current.notice?.text).toBe('Routing quota reached.');
    expect(notification.error).toHaveBeenCalledWith('Routing quota reached.');
    expect(notification.success).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.editor.routeStale).toBe(true);
    expect(isRouteResultCurrent(result.current.editor.snapshot)).toBe(false);
  });
  it('aborts outdated calculation after options change and ignores late completion', async () => {
    const completions: ((value: RoutingResult) => void)[] = [];
    const calculate = vi.spyOn(routingProvider, 'calculateRoute').mockImplementation(
      () =>
        new Promise((resolve) => {
          completions.push(resolve);
        }),
    );
    const snapshot = initial();
    const { result } = renderHook(() => useHarness(snapshot, true));
    await runDebounce();
    const firstSignal = calculate.mock.calls[0][2]!;
    act(() =>
      result.current.editor.setRoutingOptions({
        cyclingProfile: 'cycling-road',
        avoidFerries: true,
      }),
    );
    expect(firstSignal.aborted).toBe(true);
    await runDebounce();
    expect(calculate.mock.calls[1][3]).toEqual({
      cyclingProfile: 'cycling-road',
      avoidFerries: true,
    });
    await act(async () => {
      completions[0](calculated);
    });
    expect(result.current.editor.result).toBe(snapshot.result);
    expect(result.current.editor.routeStale).toBe(true);
    await act(async () => {
      completions[1]({ ...calculated, stats: { ...calculated.stats, duration: 200 } });
    });
    expect(result.current.editor.result?.stats.duration).toBe(200);
    expect(result.current.editor.routeStale).toBe(false);
  });
  it('keeps stale geometry when going offline midrequest, without granting new exports', async () => {
    vi.spyOn(routingProvider, 'calculateRoute').mockImplementation(() => new Promise(() => {}));
    const snapshot = initial();
    const { result, rerender } = renderHook(({ online }) => useHarness(snapshot, online), {
      initialProps: { online: true },
    });
    await runDebounce();
    const controller = result.current.request.current!;
    rerender({ online: false });
    expect(controller.signal.aborted).toBe(true);
    expect(result.current.editor.result).toBe(snapshot.result);
    expect(result.current.editor.routeStale).toBe(true);
    expect(result.current.busy).toBe(false);
  });
  it('keeps completed matching geometry current offline and does not recalculate on reconnect', async () => {
    const calculate = vi.spyOn(routingProvider, 'calculateRoute').mockResolvedValue(calculated);
    const snapshot = initial();
    const { result, rerender } = renderHook(({ online }) => useHarness(snapshot, online), {
      initialProps: { online: true },
    });
    await runDebounce();
    const ready = result.current.editor.result;
    expect(result.current.editor.routeStale).toBe(false);
    rerender({ online: false });
    expect(result.current.editor.result).toBe(ready);
    expect(result.current.editor.routeStale).toBe(false);
    expect(isRouteResultCurrent(result.current.editor.snapshot)).toBe(true);
    rerender({ online: true });
    await runDebounce();
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(result.current.editor.result).toBe(ready);
    expect(result.current.editor.routeStale).toBe(false);
  });
  it('calculates all-direct point mode offline immediately with no routing request', () => {
    const calculate = vi.spyOn(routingProvider, 'calculateRoute');
    const snapshot = initial();
    snapshot.name = 'Through quiet places';
    snapshot.waypoints = points.map((point) => ({ ...point, legMode: 'direct' }));
    snapshot.routeStale = true;
    const { result } = renderHook(() => useHarness(snapshot, false));
    expect(calculate).not.toHaveBeenCalled();
    expect(result.current.editor.result?.source).toBe('manual');
    expect(result.current.editor.result?.name).toBe('Through quiet places');
    expect(result.current.editor.result?.directSegments).toEqual(
      result.current.editor.result?.segments,
    );
    expect(result.current.editor.routeStale).toBe(false);
    expect(isRouteResultCurrent(result.current.editor.snapshot)).toBe(true);
  });
  it('marks retained geometry stale on unauthorized point edits without starting routing', async () => {
    vi.spyOn(routingProvider, 'calculateRoute').mockResolvedValue(calculated);
    const { result } = renderHook(() => useHarness(initial(), true));
    await runDebounce();
    const previous = result.current.editor.result as PlannedRoute;
    act(() => {
      result.current.editor.routingAllowed.current = false;
      result.current.editor.setWaypoints([{ ...points[0], coordinate: [11.5, 47.3] }, points[1]]);
    });
    expect(result.current.editor.result).toBe(previous);
    expect(result.current.editor.routeStale).toBe(true);
    expect(isRouteResultCurrent(result.current.editor.snapshot)).toBe(false);
  });
});
