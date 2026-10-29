import { expect, it } from 'vitest';
import {
  estimateTime,
  estimatePersonalTime,
  reliableAscent,
  outwardMinutes,
  speedToPace,
  paceToSpeed,
  type PersonalTimeOptions,
} from './time';
import type { Coordinate, PlannedRoute } from './types';

const options: PersonalTimeOptions = {
  speedKmh: 5,
  stopsMinutes: 10,
  fitness: 'regular',
  surface: 'paved',
};
function route(patch: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: 'time',
    name: '',
    description: '',
    activity: 'hiking',
    source: 'gpx',
    segments: [
      [
        [0, 0, 0],
        [0.01, 0, 600],
      ],
    ],
    waypoints: [],
    stats: { distance: 5000, duration: 999, ascent: 99999 },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...patch,
  };
}
it('calculates movement separately from stops in seconds', () => {
  expect(estimateTime(18000, 18, 15)).toEqual({ moving: 3600, total: 4500 });
  expect(estimateTime(5000, 5, 0)).toEqual({ moving: 3600, total: 3600 });
});
it.each([0, -1, NaN, Infinity])('rejects invalid speed %s', (speed) =>
  expect(estimateTime(1000, speed, 0)).toBeNull(),
);
it.each([-1, NaN, Infinity])('rejects invalid stops %s', (stops) =>
  expect(estimateTime(1000, 18, stops)).toBeNull(),
);

it('uses saved distance, measured pace and independent GPX ascent without double counting stats', () => {
  const snapshot = route(),
    original = structuredClone(snapshot);
  expect(estimatePersonalTime(snapshot, options)).toMatchObject({
    moving: 7200,
    total: 7800,
    ascentMetres: 600,
    climbSeconds: 3600,
    surfaceFactor: 1,
    movingRange: { lower: 5760, upper: 8640 },
    totalRange: { lower: 6360, upper: 9240 },
  });
  expect(snapshot).toEqual(original);
});
it('changes climbing and uncertainty by fitness, never measured flat movement', () => {
  const flat = route({
    segments: [
      [
        [0, 0, 0],
        [0.01, 0, 0],
      ],
    ],
  });
  for (const fitness of ['beginner', 'regular', 'trained'] as const) {
    expect(estimatePersonalTime(flat, { ...options, fitness })?.moving).toBe(3600);
  }
  expect(estimatePersonalTime(route(), { ...options, fitness: 'beginner' })?.climbSeconds).toBe(
    4680,
  );
  expect(estimatePersonalTime(route(), { ...options, fitness: 'trained' })?.climbSeconds).toBe(
    3240,
  );
});
it.each([
  ['hiking', 'paved', 1],
  ['hiking', 'mixed', 1.1],
  ['hiking', 'rough', 1.25],
  ['cycling', 'paved', 1],
  ['cycling', 'mixed', 1.2],
  ['cycling', 'rough', 1.5],
] as const)('applies explicit %s %s factor only to flat time', (activity, surface, factor) => {
  const result = estimatePersonalTime(route({ activity }), { ...options, surface })!;
  expect(result.surfaceFactor).toBe(factor);
  expect(result.moving).toBeCloseTo(3600 * factor + result.climbSeconds);
});
it.each([
  ['beginner', 7200],
  ['regular', 4800],
  ['trained', 3600],
] as const)('uses explicit rough cycling climb allowance for %s', (fitness, seconds) => {
  const result = estimatePersonalTime(route({ activity: 'cycling' }), { ...options, fitness })!;
  expect(result.climbSeconds).toBe(seconds);
  expect(result.warnings).toContain('cycling-climb');
});
it('filters sub-threshold GPS oscillations, keeps sustained climbs, and never joins segment gaps', () => {
  const segments: Coordinate[][] = [
    [
      [0, 0, 100],
      [0.01, 0, 102],
      [0.02, 0, 100],
      [0.03, 0, 101],
      [0.04, 0, 100],
    ],
    [
      [1, 0, 1000],
      [1.01, 0, 1002],
      [1.02, 0, 1004],
      [1.03, 0, 1006],
      [1.04, 0, 1002],
      [1.05, 0, 1005],
    ],
  ];
  const original = structuredClone(segments);
  expect(reliableAscent(segments)).toBe(9);
  expect(segments).toEqual(original);
  expect(
    reliableAscent([
      [
        [0, 0, 0],
        [0.01, 0, 10],
      ],
      [
        [1, 0, 500],
        [1.01, 0, 510],
      ],
    ]),
  ).toBe(20);
  expect(
    reliableAscent([
      [
        [0, 0, 10],
        [0.01, 0, 0],
      ],
    ]),
  ).toBe(0);
});
it.each(
  (
    [
      [],
      [[[0, 0, 10]]],
      [
        [
          [0, 0],
          [0.01, 0],
        ],
      ],
      [
        [
          [0, 0, 10],
          [0.01, 0],
        ],
      ],
      [
        [
          [0, 0, 0],
          [0.01, 0, Infinity],
        ],
      ],
    ] as Coordinate[][][]
  ).map((segments) => [segments]),
)('does not invent ascent for missing or incomplete GPX heights %j', (segments) => {
  expect(reliableAscent(segments)).toBeNull();
  const result = estimatePersonalTime(route({ segments }), options)!;
  expect(result.climbSeconds).toBe(0);
  expect(result.warnings).toContain('missing-elevation');
});
it.each(['openrouteservice', 'mapbox', 'manual'] as const)(
  'preserves original %s stats and ignores untrusted heights',
  (source) => {
    const snapshot = route({ source }),
      original = structuredClone(snapshot);
    const result = estimatePersonalTime(snapshot, options)!;
    expect(result.moving).toBe(3600);
    expect(result.ascentMetres).toBeNull();
    expect(snapshot).toEqual(original);
    expect(result.warnings.includes('manual-distance')).toBe(source === 'manual');
  },
);
it('widens unknown surface, missing-height and manual ranges while adding stops only once', () => {
  const known = estimatePersonalTime(route(), options)!;
  const unknown = estimatePersonalTime(route(), { ...options, surface: 'unknown' })!;
  expect(unknown.moving).toBe(known.moving);
  expect(unknown.movingRange.lower).toBeLessThan(known.movingRange.lower);
  expect(unknown.movingRange.upper).toBeGreaterThan(known.movingRange.upper);
  const auto = estimatePersonalTime(route({ source: 'mapbox' }), options)!;
  const manual = estimatePersonalTime(route({ source: 'manual' }), options)!;
  expect(manual.movingRange.upper).toBeGreaterThan(auto.movingRange.upper);
  expect(unknown.totalRange.lower - unknown.movingRange.lower).toBe(600);
  expect(unknown.totalRange.upper - unknown.movingRange.upper).toBe(600);
});
it('handles zero distance/stops, unit conversion, outward rounding and overflow safely', () => {
  expect(
    estimatePersonalTime(route({ source: 'manual', stats: { distance: 0, duration: 0 } }), {
      ...options,
      stopsMinutes: 0,
    })?.totalRange,
  ).toEqual({ lower: 0, upper: 0 });
  expect(speedToPace(5)).toBe(12);
  expect(paceToSpeed(12.5)).toBe(4.8);
  expect(speedToPace(Infinity)).toBeNull();
  expect(paceToSpeed(Number.MIN_VALUE)).toBeNull();
  expect(outwardMinutes({ lower: 60.1, upper: 119.9 })).toEqual({ lower: 1, upper: 2 });
  expect(outwardMinutes({ lower: 0, upper: 0.01 })).toEqual({ lower: 0, upper: 1 });
  expect(outwardMinutes({ lower: 5, upper: 4 })).toBeNull();
  expect(outwardMinutes({ lower: 0, upper: Infinity })).toBeNull();
  expect(estimatePersonalTime(route(), { ...options, speedKmh: Number.MIN_VALUE })).toBeNull();
  expect(estimatePersonalTime(route(), { ...options, stopsMinutes: Number.MAX_VALUE })).toBeNull();
  expect(
    estimatePersonalTime(route({ stats: { distance: Number.MAX_VALUE, duration: 0 } }), {
      ...options,
      speedKmh: 1,
    }),
  ).toBeNull();
});
it.each([
  { fitness: 'expert' },
  { surface: 'gravel' },
  { speedKmh: 0 },
  { speedKmh: Infinity },
  { stopsMinutes: -1 },
])('rejects invalid runtime inputs %j', (patch) => {
  expect(estimatePersonalTime(route(), { ...options, ...patch } as PersonalTimeOptions)).toBeNull();
});

it.each(['openrouteservice', 'mapbox'] as const)(
  'combines %s conservatively using the larger moving estimate and stops once',
  (source) => {
    const snapshot = route({ source, stats: { distance: 1344, duration: 3600 } });
    const original = structuredClone(snapshot);
    const faster = estimatePersonalTime(snapshot, { ...options, speedKmh: 18, stopsMinutes: 15 })!;
    expect(faster.moving).toBeCloseTo(268.8);
    expect(faster.planningReference).toBe(4500);
    const slower = estimatePersonalTime(snapshot, { ...options, speedKmh: 1, stopsMinutes: 15 })!;
    expect(slower.moving).toBeCloseTo(4838.4);
    expect(slower.planningReference).toBeCloseTo(5738.4);
    expect(snapshot).toEqual(original);
  },
);
it.each(['gpx', 'manual'] as const)(
  'does not combine original heuristic durations for %s',
  (source) => {
    expect(estimatePersonalTime(route({ source }), options)?.planningReference).toBeNull();
  },
);
it('rejects invalid or overflowing automatic provider references', () => {
  for (const duration of [-1, NaN, Infinity]) {
    expect(
      estimatePersonalTime(
        route({ source: 'mapbox', stats: { distance: 1344, duration } }),
        options,
      ),
    ).toBeNull();
  }
  expect(
    estimatePersonalTime(
      route({ source: 'mapbox', stats: { distance: 1344, duration: Number.MAX_VALUE } }),
      { ...options, stopsMinutes: Number.MAX_VALUE / 100 },
    ),
  ).toBeNull();
});
