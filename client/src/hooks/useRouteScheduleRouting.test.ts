import { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRouteEditor } from './useRouteEditor';
import { usePointRouting } from './usePointRouting';
import { initialEditor, withEditorSchedule } from '../domain/editorSnapshot';
import { routingProvider } from '../services/routing';
import { isRouteResultCurrent } from '../domain/editorRouting';
import type { RoutingResult } from '../domain/types';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('schedule edits neither restart a debounce nor abort/reroute an in-flight or completed automatic route', async () => {
  vi.useFakeTimers();
  let resolve!: (value: RoutingResult) => void;
  const calculate = vi.spyOn(routingProvider, 'calculateRoute').mockImplementation(() =>
    new Promise((done) => { resolve = done; }));
  const initial = initialEditor();
  initial.waypoints = [{ id: 'a', name: 'A', coordinate: [0, 0] }, { id: 'b', name: 'B', coordinate: [0.01, 0] }];
  function useHarness() {
    const editor = useRouteEditor(initial);
    const once = useRef(true);
    if (once.current) { once.current = false; editor.routingAllowed.current = true; }
    const request = useRef<AbortController | null>(null);
    const [busy, setBusy] = useState(false);
    const [, setNotice] = useState<{ text: string; error: boolean; kind?: 'routing' | 'map' } | null>(null);
    usePointRouting({ snapshot: editor.routingSnapshot, revision: 0, online: true,
      allowed: editor.routingAllowed, request, setBusy, setNotice,
      setResult: editor.setResult, setRouteStale: editor.setRouteStale });
    return { editor, busy, request };
  }
  const { result, unmount } = renderHook(useHarness);
  const request = result.current.request.current!;
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  act(() => result.current.editor.setWaypointPause('a', 5));
  act(() => result.current.editor.setDepartureLocal('2026-10-29T23:30'));
  expect(result.current.request.current).toBe(request);
  expect(request.signal.aborted).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(calculate).toHaveBeenCalledTimes(1);
  act(() => result.current.editor.setWaypointPause('a', 15));
  expect(request.signal.aborted).toBe(false);
  await act(async () => { resolve({ segments: [[[0, 0], [0.01, 0]]], stats: { distance: 1112, duration: 300 } }); });
  expect(result.current.busy).toBe(false);
  expect(isRouteResultCurrent(result.current.editor.snapshot)).toBe(true);
  const geometry = result.current.editor.result!.segments;
  act(() => result.current.editor.setWaypointPause('b', 10));
  act(() => result.current.editor.setDepartureLocal('2026-10-30T08:00'));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(calculate).toHaveBeenCalledTimes(1);
  expect(result.current.editor.result!.segments).toBe(geometry);
  expect(result.current.editor.routeStale).toBe(false);
  const saved = withEditorSchedule(result.current.editor.result!, result.current.editor.snapshot);
  expect(saved.departureLocal).toBe('2026-10-30T08:00');
  expect(saved.waypoints.map((point) => point.pauseMinutes)).toEqual([15, 10]);
  expect(result.current.editor.undoChangesGeometry).toBe(false);
  act(() => result.current.editor.undo());
  act(() => result.current.editor.undo());
  act(() => result.current.editor.undo());
  // The pause checkpoint predates the router response, but timing undo must retain that response.
  expect(result.current.editor.result!.segments).toBe(geometry);
  expect(result.current.editor.routeStale).toBe(false);
  expect(result.current.editor.waypoints[0].pauseMinutes).toBe(5);
  expect(result.current.editor.routingAllowed.current).toBe(true);
  expect(result.current.editor.redoChangesGeometry).toBe(false);
  act(() => result.current.editor.redo());
  expect(result.current.editor.result!.segments).toBe(geometry);
  expect(result.current.editor.waypoints[0].pauseMinutes).toBe(15);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(calculate).toHaveBeenCalledTimes(1);
  unmount();
});
