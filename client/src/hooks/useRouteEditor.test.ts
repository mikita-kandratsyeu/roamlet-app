import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { editorReducer, useRouteEditor, type EditorHistory } from './useRouteEditor';
import { initialEditor, withEditorSchedule } from '../domain/editorSnapshot';
import { isRouteResultCurrent, routingInputKey } from '../domain/editorRouting';
import type { PlannedRoute, Waypoint } from '../domain/types';
describe('editor history', () => {
  it('shares unchanged geometry across checkpoints and geometry undo/redo', () => {
    const initial = initialEditor();
    initial.mode = 'snapshot';
    initial.result = {
      ...initial.identity, name: 'Imported', description: '', activity: 'hiking', source: 'gpx',
      waypoints: [], segments: [[[0, 0, 100], [0.01, 0, 110]]],
      stats: { distance: 1112, duration: 800 }, updatedAt: initial.identity.createdAt,
    };
    let state: EditorHistory = { present: initial, past: [], future: [] };
    state = editorReducer(state, { type: 'checkpoint' });
    expect(state.past[0].result?.segments).toBe(initial.result.segments);
    state = editorReducer(state, { type: 'patch', key: 'result', value: null });
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.result?.segments).toBe(initial.result.segments);
    state = editorReducer(state, { type: 'redo' });
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.result?.segments).toBe(initial.result.segments);
  });
  it('bounds history to fifty geometry actions and clears redo after another edit', () => {
    let state: EditorHistory = { present: initialEditor(), past: [], future: [] };
    for (let i = 0; i < 60; i++) {
      state = editorReducer(state, { type: 'checkpoint' });
      state = editorReducer(state, {
        type: 'patch',
        key: 'waypoints',
        value: [{ id: String(i), name: 'point', coordinate: [i, 1] }],
      });
    }
    expect(state.past).toHaveLength(50);
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.waypoints[0].id).toBe('58');
    state = editorReducer(state, { type: 'redo' });
    expect(state.present.waypoints[0].id).toBe('59');
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'checkpoint' });
    expect(state.future).toHaveLength(0);
  });
  it('restores serializable ready geometry without granting routing and resets session history', () => {
    const { result } = renderHook(() => useRouteEditor(initialEditor()));
    const points: Waypoint[] = [
      { id: 'a', name: 'A', coordinate: [10, 20] },
      { id: 'b', name: 'B', coordinate: [10.1, 20.1] },
    ];
    const ready: PlannedRoute = {
      ...result.current.identity,
      name: 'Ready',
      description: '',
      activity: 'cycling',
      waypoints: points,
      segments: [points.map((point) => point.coordinate)],
      stats: { distance: 1000, duration: 200 },
      source: 'manual',
      updatedAt: new Date().toISOString(),
    };
    act(() => {
      result.current.checkpoint();
      result.current.setWaypoints(points);
      result.current.setResult(ready);
    });
    act(() => {
      result.current.checkpoint();
      result.current.setWaypoints([]);
      result.current.setResult(null);
    });
    act(() => result.current.undo());
    expect(result.current.waypoints).toHaveLength(2);
    expect(result.current.result).toEqual(ready);
    expect(result.current.routingAllowed.current).toBe(false);
    expect(JSON.parse(JSON.stringify(result.current.snapshot))).toEqual(result.current.snapshot);
    act(() => result.current.reset(result.current.snapshot));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});

it('personal changes preserve ready snapshot geometry, routing permission and history restoration', async () => {
  const initial = initialEditor();
  const ready: PlannedRoute = {
    ...initial.identity,
    name: '',
    description: '',
    activity: 'cycling',
    segments: [
      [
        [0, 0],
        [0.01, 0],
      ],
    ],
    waypoints: [],
    stats: { distance: 1000, duration: 200 },
    source: 'openrouteservice',
    updatedAt: new Date().toISOString(),
  };
  initial.result = ready;
  initial.mode = 'snapshot';
  const { result } = renderHook(() => useRouteEditor(initial));
  act(() => {
    result.current.checkpoint();
    result.current.setFitness('trained');
    result.current.setSurface('rough');
    result.current.setSpeeds({ cycling: 12.5, hiking: 4.8 });
    result.current.setStopsMinutes(15);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.result).toBe(ready);
  expect(result.current.routingAllowed.current).toBe(false);
  act(() => result.current.undo());
  expect(result.current.fitness).toBe('regular');
  expect(result.current.surface).toBe('unknown');
  expect(result.current.result).toEqual(ready);
  act(() => result.current.redo());
  expect(result.current.surface).toBe('rough');
  expect(result.current.fitness).toBe('trained');
  expect(result.current.result).toEqual(ready);
});

it('edits generated loop waypoint pauses without turning them into routing input pins', () => {
  const initial = initialEditor();
  initial.planningMode = 'loop';
  initial.mode = 'snapshot';
  initial.waypoints = [{ id: 'start', name: 'Start', coordinate: [0, 0] }];
  initial.result = { ...initial.identity, name: '', description: '', activity: 'cycling',
    source: 'openrouteservice', updatedAt: initial.identity.createdAt,
    segments: [[[0, 0], [0.01, 0], [0, 0]]], stats: { distance: 2224, duration: 600 },
    waypoints: [{ id: 'start', name: 'Start', coordinate: [0, 0] },
      { id: 'generated', name: 'Loop stop', coordinate: [0.01, 0] }] };
  const { result } = renderHook(() => useRouteEditor(initial));
  const routingPoints = result.current.routingSnapshot.waypoints;
  const geometry = result.current.result!.segments;
  act(() => result.current.setWaypointPause('generated', 20));
  expect(result.current.scheduleWaypoints[1].pauseMinutes).toBe(20);
  expect(result.current.waypoints).toHaveLength(1);
  expect(result.current.routingSnapshot.waypoints).toBe(routingPoints);
  expect(withEditorSchedule(result.current.result!, result.current.snapshot).waypoints[1].pauseMinutes).toBe(20);
  act(() => result.current.undo());
  expect(result.current.scheduleWaypoints[1].pauseMinutes).toBeUndefined();
  expect(result.current.result!.segments).toBe(geometry);
  act(() => result.current.redo());
  expect(result.current.scheduleWaypoints[1].pauseMinutes).toBe(20);
  expect(result.current.result!.segments).toBe(geometry);
});

it('edits schedule atomically with undo/redo while keeping routing inputs, permission and geometry stable', () => {
  const initial = initialEditor();
  initial.waypoints = [
    { id: 'a', name: 'Start', coordinate: [0, 0] },
    { id: 'b', name: 'Finish', coordinate: [0.01, 0] },
  ];
  const ready: PlannedRoute = { ...initial.identity, name: '', description: '', activity: 'cycling',
    waypoints: initial.waypoints, segments: [initial.waypoints.map((point) => point.coordinate)],
    stats: { distance: 1112, duration: 300 }, source: 'manual', updatedAt: initial.identity.createdAt };
  initial.planningMode = 'manual';
  initial.result = ready;
  const { result } = renderHook(() => useRouteEditor(initial));
  const key = routingInputKey(initial);
  const routingPoints = result.current.routingSnapshot.waypoints;
  result.current.routingAllowed.current = true;
  act(() => result.current.setDepartureLocal('2026-10-29T23:30'));
  act(() => result.current.setWaypointPause('a', 15));
  expect(result.current.departureLocal).toBe('2026-10-29T23:30');
  expect(result.current.waypoints[0].pauseMinutes).toBe(15);
  expect(result.current.result).toBe(ready);
  expect(result.current.result!.segments).toBe(ready.segments);
  expect(result.current.routingSnapshot.waypoints).toBe(routingPoints);
  expect(result.current.routingAllowed.current).toBe(true);
  expect(result.current.routeStale).toBe(false);
  expect(routingInputKey(result.current.snapshot)).toBe(key);
  expect(isRouteResultCurrent(result.current.snapshot)).toBe(true);
  expect(withEditorSchedule(ready, result.current.snapshot).waypoints[0].pauseMinutes).toBe(15);
  act(() => result.current.undo());
  expect(result.current.waypoints[0].pauseMinutes).toBeUndefined();
  expect(result.current.departureLocal).toBe('2026-10-29T23:30');
  act(() => result.current.undo());
  expect(result.current.departureLocal).toBeUndefined();
  act(() => result.current.redo());
  act(() => result.current.redo());
  expect(result.current.waypoints[0].pauseMinutes).toBe(15);
  act(() => result.current.undo());
  act(() => result.current.setDepartureLocal('2026-10-30T08:00'));
  expect(result.current.canRedo).toBe(false);
  act(() => result.current.setWaypointPause('missing', 10));
  expect(result.current.waypoints).toHaveLength(2);
  act(() => result.current.reset(result.current.snapshot));
  expect(result.current.departureLocal).toBe('2026-10-30T08:00');
  expect(result.current.canUndo).toBe(false);
});
