import { expect, it } from 'vitest';
import { estimateTime } from './time';
it('calculates movement separately from stops in seconds', () => {
  expect(estimateTime(18000, 18, 15)).toEqual({ moving: 3600, total: 4500 });
  expect(estimateTime(5000, 5, 0)).toEqual({ moving: 3600, total: 3600 });
});
it.each([0, -1, NaN, Infinity])('rejects invalid speed %s', speed => expect(estimateTime(1000, speed, 0)).toBeNull());
it.each([-1, NaN, Infinity])('rejects invalid stops %s', stops => expect(estimateTime(1000, 18, stops)).toBeNull());
