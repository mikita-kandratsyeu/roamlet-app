import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { editorReducer, useRouteEditor, type EditorHistory } from './useRouteEditor';
import { initialEditor } from '../domain/editorSnapshot';
import type { PlannedRoute, Waypoint } from '../domain/types';
describe('editor history', () => {
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
