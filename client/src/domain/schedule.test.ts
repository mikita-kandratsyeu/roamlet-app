import { describe, expect, it, vi } from 'vitest';
import { addLocalSeconds, estimateRouteSchedule, localDayOffset, validDepartureLocal, validPauseMinutes } from './schedule';
import type { Coordinate, PlannedRoute, Waypoint } from './types';
const point = (id: string, coordinate: Coordinate, pauseMinutes?: number): Waypoint =>
  ({ id, name: id, coordinate, ...(pauseMinutes === undefined ? {} : { pauseMinutes }) });
const route = (segments: Coordinate[][], waypoints: Waypoint[]): Pick<PlannedRoute, 'segments' | 'waypoints' | 'departureLocal'> =>
  ({ segments, waypoints, departureLocal: '2026-10-29T23:30' });

describe('floating local calendar', () => {
  it.each(['2024-02-29T12:15', '0001-01-01T00:00', '9999-12-31T23:59'])('accepts %s', (value) => {
    expect(validDepartureLocal(value)).toBe(true);
  });
  it.each(['2026-02-29T12:00', '2026-04-31T12:00', '2026-13-01T00:00', '2026-01-01T24:00',
    '2026-01-01T12:60', '2026-01-01', '2026-01-01T12:00Z', '2026-01-01T12:00:00',
    '0000-01-01T00:00', '', undefined, null])('rejects %s', (value) => {
    expect(validDepartureLocal(value)).toBe(false);
  });
  it('rolls over days, leap days and years without applying timezone/DST transitions', () => {
    expect(addLocalSeconds('2024-02-28T23:30', 3600)).toBe('2024-02-29T00:30');
    expect(addLocalSeconds('2026-12-31T23:30', 3600)).toBe('2027-01-01T00:30');
    // These wall times may be nonexistent or ambiguous in some timezones; neither is an instant.
    expect(addLocalSeconds('2026-03-29T01:30', 3600)).toBe('2026-03-29T02:30');
    expect(addLocalSeconds('2026-10-25T01:30', 3600)).toBe('2026-10-25T02:30');
    expect(localDayOffset('2026-10-29T23:30', '2026-10-31T00:30')).toBe(2);
    expect(addLocalSeconds('9999-12-31T23:59', 120)).toBeNull();
    expect(addLocalSeconds('bad', 1)).toBeNull();
    expect(addLocalSeconds('2026-01-01T00:00', -1)).toBeNull();
  });
  it.each([-1, 0.5, 10081, NaN, Infinity, '5', null])('rejects invalid pause %s', (value) => {
    expect(validPauseMinutes(value)).toBe(false);
  });
});

describe('geometry-based arrival schedule', () => {
  it('does not inspect geometry before departure and moving time are usable', () => {
    const segments = [[[0, 0], [0.01, 0]]] as Coordinate[][];
    const inspect = vi.spyOn(segments, Symbol.iterator);
    const input = route(segments, [point('a', [0, 0], 5), point('b', [0.01, 0], 10)]);
    expect(estimateRouteSchedule({ ...input, departureLocal: undefined }, 3600)).toMatchObject({
      unavailable: 'departure', finishLocal: null, pauseMinutes: 15,
    });
    expect(estimateRouteSchedule(input, NaN).unavailable).toBe('moving-time');
    expect(inspect).not.toHaveBeenCalled();
    inspect.mockRestore();
  });
  it('uses actual along-route distance, not waypoint count or straight-line fractions, and pauses after arrival', () => {
    const input = route([[[0, 0], [0.03, 0], [0.03, 0.01], [0, 0.01]]],
      [point('start', [0, 0], 10), point('bend', [0.03, 0], 15), point('finish', [0, 0.01], 5)]);
    const schedule = estimateRouteSchedule(input, 4200);
    expect(schedule.rows[0].arrivalLocal).toBe('2026-10-29T23:30');
    expect(schedule.rows[0].departureLocal).toBe('2026-10-29T23:40');
    expect(schedule.rows[1].arrivalLocal).toBe('2026-10-30T00:10');
    expect(schedule.rows[1].departureLocal).toBe('2026-10-30T00:25');
    expect(schedule.rows[2].arrivalLocal).toBe('2026-10-30T01:05');
    expect(schedule.rows[2].departureLocal).toBe('2026-10-30T01:10');
    expect(schedule.rows[2].dayOffset).toBe(1);
    expect(schedule.pauseMinutes).toBe(30);
    expect(schedule.finishLocal).toBe('2026-10-30T01:10');
    expect(schedule.unavailable).toBeNull();
  });
  it('projects interior pins on curved geometry and carries seconds rather than rounding every leg', () => {
    const schedule = estimateRouteSchedule(route([[[0, 0], [0.01, 0], [0.02, 0]]],
      [point('a', [0, 0]), point('b', [0.01, 0], 1), point('c', [0.02, 0])]), 119);
    expect(schedule.rows[1].arrivalLocal).toBe('2026-10-29T23:30');
    expect(schedule.rows[2].arrivalLocal).toBe('2026-10-29T23:32');
    const interior = estimateRouteSchedule(route([[[0, 0], [0.02, 0]]],
      [point('a', [0.005, 0]), point('b', [0.015, 0])]), 3600);
    expect(interior.rows.map((row) => row.arrivalLocal)).toEqual(['2026-10-29T23:45', '2026-10-30T00:15']);
  });
  it('matches repeated coordinates monotonically on a return trip and anchors a closed finish', () => {
    const schedule = estimateRouteSchedule(route([[[0, 0], [0.02, 0], [0, 0]]],
      [point('a', [0, 0]), point('b', [0.01, 0]), point('c', [0.02, 0]),
        point('d', [0.01, 0]), point('e', [0, 0])]), 2400);
    expect(schedule.rows.map((row) => row.arrivalLocal)).toEqual([
      '2026-10-29T23:30', '2026-10-29T23:40', '2026-10-29T23:50', '2026-10-30T00:00', '2026-10-30T00:10',
    ]);
  });
  it('supports the antimeridian without wrapping the route around the world', () => {
    const schedule = estimateRouteSchedule(route([[[179.9, 0], [-179.9, 0]]],
      [point('a', [179.9, 0]), point('b', [180, 0]), point('c', [-179.9, 0])]), 3600);
    expect(schedule.rows[1].arrivalLocal).toBe('2026-10-30T00:00');
    expect(schedule.rows[2].distanceMetres).toBeCloseTo(22239, -1);
  });
  it('never invents travel across disconnected GPX segments, but allows touching segments', () => {
    const split = route([[[0, 0], [0.01, 0]], [[2, 0], [2.01, 0]]],
      [point('a', [0, 0]), point('b', [0.01, 0]), point('c', [2.01, 0])]);
    const schedule = estimateRouteSchedule(split, 3600);
    expect(schedule.rows[1].arrivalLocal).toBe('2026-10-30T00:00');
    expect(schedule.rows[2].arrivalLocal).toBeNull();
    expect(schedule.rows[2].unavailable).toBe('disconnected');
    expect(schedule.finishLocal).toBeNull();
    const touching = estimateRouteSchedule(route([[[0, 0], [0.01, 0]], [[0.01, 0], [0.02, 0]]],
      [point('a', [0, 0]), point('b', [0.02, 0])]), 3600);
    expect(touching.finishLocal).toBe('2026-10-30T00:30');
  });
  it('does not fabricate a full finish when a gap lies beyond all matched waypoints', () => {
    const schedule = estimateRouteSchedule(route([[[0, 0], [0.01, 0]], [[2, 0], [2.01, 0]]],
      [point('a', [0, 0]), point('b', [0.01, 0])]), 3600);
    expect(schedule.rows.every((row) => row.arrivalLocal !== null)).toBe(true);
    expect(schedule.unavailable).toBe('disconnected');
    expect(schedule.finishLocal).toBeNull();
  });
  it('rejects far/off-route and out-of-order pins without silently redistributing their pauses', () => {
    for (const middle of [[1, 1], [0.003, 0]] as Coordinate[]) {
      const schedule = estimateRouteSchedule(route([[[0, 0], [0.03, 0]]],
        [point('a', [0, 0]), point('b', [0.02, 0]), point('c', middle, 10), point('d', [0.03, 0])]), 3600);
      expect(schedule.rows[2].unavailable).toBe('unmatched-waypoint');
      expect(schedule.rows[3].arrivalLocal).toBeNull();
    }
    const snapped = estimateRouteSchedule(route([[[0, 0], [0.03, 0]]],
      [point('a', [0, 0.0001]), point('b', [0.03, 0])]), 3600);
    expect(snapped.unavailable).toBeNull();
  });
  it('requires ordered usable pins and geometry, not isolated GPX samples or duplicate pins', () => {
    for (const waypoints of [[], [point('a', [0, 0])], [point('a', [0, 0.01]), point('b', [0, 0.01])]]) {
      const schedule = estimateRouteSchedule(route([[[0, 0], [0.02, 0]]], waypoints), 3600);
      expect(schedule.unavailable).toBe('waypoints');
      expect(schedule.rows.every((row) => row.arrivalLocal === null)).toBe(true);
    }
    expect(estimateRouteSchedule(route([[[0, 0]], [[1, 1]]], []), 10).unavailable).toBe('geometry');
  });
  it('rejects invalid moving estimates, dates and pauses, and handles calendar overflow', () => {
    const input = route([[[0, 0], [0.01, 0]]], [point('a', [0, 0]), point('b', [0.01, 0])]);
    for (const moving of [-1, NaN, Infinity]) expect(estimateRouteSchedule(input, moving).unavailable).toBe('moving-time');
    expect(estimateRouteSchedule({ ...input, departureLocal: 'invalid' }, 0).unavailable).toBe('departure');
    expect(estimateRouteSchedule({ ...input, departureLocal: '9999-12-31T23:59' }, 120).unavailable).toBe('date-overflow');
    input.waypoints[0].pauseMinutes = -1;
    expect(estimateRouteSchedule(input, 3600).unavailable).toBe('pause');
  });
});
