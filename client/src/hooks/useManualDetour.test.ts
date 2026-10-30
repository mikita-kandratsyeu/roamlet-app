import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useManualDetour } from './useManualDetour';
import { applyManualDetour } from '../domain/manualDetour';
import type { Waypoint } from '../domain/types';

const base: Waypoint[] = [
  { id: 'a', name: 'Start', coordinate: [0, 0], pauseMinutes: 5 },
  { id: 'b', name: 'Middle', coordinate: [1, 0], pauseMinutes: 10 },
  { id: 'c', name: 'Finish', coordinate: [2, 0], legMode: 'automatic' },
];

it('keeps edits local, fixes endpoints and applies only the chosen outgoing section', () => {
  const original = structuredClone(base);
  const { result } = renderHook(() => useManualDetour(base, true));
  act(() => result.current.start(0));
  expect(result.current.canApply).toBe(false);
  act(() => result.current.add([0.5, 0.2]));
  expect(result.current.canApply).toBe(true);
  const id = result.current.active!.points[1].id;
  act(() => result.current.move('a', [9, 9]));
  act(() => result.current.remove('b'));
  expect(result.current.active!.points[0].coordinate).toEqual([0, 0]);
  expect(result.current.active!.points.at(-1)!.id).toBe('b');
  act(() => result.current.move(id, [0.5, 0.3]));
  const committed = result.current.apply()!;
  expect(committed.map((point) => point.id)).toEqual(['a', id, 'b', 'c']);
  expect(committed.map((point) => point.legMode)).toEqual(['direct', 'direct', undefined, 'automatic']);
  expect(committed[0].pauseMinutes).toBe(5);
  expect(committed[2]).toBe(base[1]);
  expect(committed[3]).toBe(base[2]);
  expect(base).toEqual(original);
  act(() => result.current.cancel());
  expect(result.current.active).toBeNull();
  expect(base).toEqual(original);
});

it('supports local undo/redo, insertion and removal without changing the original route', () => {
  const { result } = renderHook(() => useManualDetour(base, true));
  act(() => result.current.start(1));
  act(() => result.current.add([1.5, 0.2]));
  act(() => result.current.insert([1.2, 0.1], 1));
  expect(result.current.active!.points.map((point) => point.coordinate)).toEqual([
    [1, 0], [1.2, 0.1], [1.5, 0.2], [2, 0],
  ]);
  act(() => result.current.undo());
  expect(result.current.active!.points).toHaveLength(3);
  act(() => result.current.redo());
  expect(result.current.active!.points).toHaveLength(4);
  act(() => result.current.remove(result.current.active!.points[1].id));
  expect(result.current.active!.points).toHaveLength(3);
  act(() => result.current.undo());
  act(() => result.current.add([1.8, 0.4]));
  expect(result.current.canRedo).toBe(false);
});

it('discards drafts permanently when route identity or editing availability changes', () => {
  const { result, rerender } = renderHook(({ points, enabled }) => useManualDetour(points, enabled),
    { initialProps: { points: base, enabled: true } });
  act(() => result.current.start(0));
  act(() => result.current.add([0.5, 0.2]));
  rerender({ points: base, enabled: false });
  expect(result.current.active).toBeNull();
  rerender({ points: base, enabled: true });
  expect(result.current.active).toBeNull();
  act(() => result.current.start(0));
  rerender({ points: [...base], enabled: true });
  expect(result.current.active).toBeNull();
});

it('enforces the existing route-wide 50-stop limit without losing edits', () => {
  const many = Array.from({ length: 49 }, (_, index): Waypoint => ({
    id: `p${index}`, name: String(index), coordinate: [index, 0],
  }));
  const { result, rerender } = renderHook(({ points }) => useManualDetour(points, true),
    { initialProps: { points: many } });
  act(() => result.current.start(0));
  act(() => result.current.add([0.5, 0.1]));
  expect(result.current.canAdd).toBe(false);
  act(() => result.current.add([0.6, 0.2]));
  expect(result.current.active!.points).toHaveLength(3);
  expect(result.current.apply()).toHaveLength(50);
  act(() => result.current.undo());
  expect(result.current.canAdd).toBe(true);
  rerender({ points: [...many, { id: 'last', name: 'Last', coordinate: [49, 0] }] });
  act(() => result.current.start(0));
  expect(result.current.active).toBeNull();
});

it('rejects invalid sections, endpoint changes, duplicate ids, coordinates and excess points', () => {
  const points = [base[0], { id: 'new', name: 'New', coordinate: [0.5, 0.2] } as Waypoint, base[1]];
  expect(() => applyManualDetour(base, -1, points)).toThrow();
  expect(() => applyManualDetour(base, 0, [base[0], base[1]])).toThrow();
  expect(() => applyManualDetour(base, 0, [{ ...base[0], coordinate: [9, 9] }, ...points.slice(1)])).toThrow();
  expect(() => applyManualDetour(base, 0, [base[0], { ...points[1], id: 'c' }, base[1]])).toThrow();
  expect(() => applyManualDetour(base, 0, [base[0], { ...points[1], coordinate: [NaN, 1] }, base[1]])).toThrow();
  const extras = Array.from({ length: 49 }, (_, i): Waypoint => ({ id: `extra${i}`, name: 'Extra', coordinate: [0.5, 0.2] }));
  expect(() => applyManualDetour(base, 0, [base[0], ...extras, base[1]])).toThrow(/50/);
});
