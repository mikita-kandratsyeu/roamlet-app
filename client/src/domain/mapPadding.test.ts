import { expect, it } from 'vitest';
import { mapPadding } from './mapPadding';

function bounds(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

it('reserves compact map controls rather than fitting the route behind their buttons', () => {
  const padding = mapPadding({
    viewport: bounds(0, 60, 412, 232),
    stylePicker: bounds(12, 72, 104, 52),
    controls: bounds(12, 190, 388, 44),
    planner: bounds(0, 292, 412, 600),
    compactPlanner: true,
  });
  expect(typeof padding).toBe('object');
  if (typeof padding === 'number') throw new Error('Expected directional padding');
  expect(padding.bottom).toBeGreaterThan(102);
  expect(padding.top + padding.bottom).toBeCloseTo(184);
  expect(292 - padding.bottom).toBeLessThan(190);
});

it('reserves a bottom-right style picker below the route without wasting top space', () => {
  expect(mapPadding({
    viewport: bounds(0, 0, 1200, 800),
    stylePicker: bounds(1080, 630, 104, 54),
    compactPlanner: false,
  })).toEqual({ top: 65, bottom: 182, left: 65, right: 65 });
});

it('reserves a bottom sheet below the route rather than a desktop left margin', () => {
  const padding = mapPadding({
    viewport: bounds(0, 0, 800, 800),
    planner: bounds(0, 500, 800, 300),
    compactPlanner: true,
  });
  expect(padding).toEqual({ top: 65, bottom: 324, left: 65, right: 65 });
});

it('retains desktop planner padding and ignores nonoverlapping overlays', () => {
  expect(mapPadding({
    viewport: bounds(0, 0, 1200, 800),
    planner: bounds(12, 12, 420, 700),
    controls: bounds(1400, 0, 44, 300),
    compactPlanner: false,
  })).toEqual({ top: 65, bottom: 65, left: 456, right: 65 });
});

it('keeps a focused detour above its editing toolbar', () => {
  expect(mapPadding({ viewport: bounds(0, 0, 412, 800),
    editingToolbar: bounds(12, 620, 388, 150), compactPlanner: true }))
    .toEqual({ top: 65, bottom: 204, left: 65, right: 65 });
});

it('handles an unmeasured viewport and keeps room in very small viewports', () => {
  expect(mapPadding({ compactPlanner: true })).toBe(65);
  expect(mapPadding({ viewport: bounds(0, 0, 50, 40), compactPlanner: true }))
    .toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
});
