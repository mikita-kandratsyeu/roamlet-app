import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clipRouteCardGeometry,
  projectRouteCardGeometry,
  projectRouteCardDrawing,
  renderRouteCard,
  type RouteCardRequest,
} from './routeCard';
import { calculateStats } from './stats';
import type { Coordinate } from './types';

const request: RouteCardRequest = {
  segments: [
    [
      [0, 0],
      [0.02, 0.01],
      [0.03, 0],
    ],
  ],
  format: 'post',
  theme: 'light',
  privacyRadius: 0,
  title: 'Morning hills',
  activityLabel: 'Hiking',
  plannedLabel: 'Planned route',
  metrics: [
    { label: 'Distance', value: '4.2 km' },
    { label: 'Time', value: '1 h' },
  ],
};
const noVisible = 'No route remains visible. Reduce the privacy radius.';
const renderError = 'Could not generate the image. Please try again.';
function canvasMock() {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 32 })),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  };
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { value: vi.fn(() => context), configurable: true });
  Object.defineProperty(canvas, 'toBlob', {
    value: vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))),
    configurable: true,
  });
  return { canvas, context };
}
afterEach(() => vi.restoreAllMocks());

describe('route card geometry', () => {
  it('clips endpoint discs in metres and does not invent elevations or mutate inputs', () => {
    const source: Coordinate[][] = [
      [
        [0, 0, 100],
        [0.02, 0, 200],
        [0.04, 0],
      ],
    ];
    const before = JSON.stringify(source);
    source.forEach((segment) => segment.forEach(Object.freeze));
    const result = clipRouteCardGeometry(source, 500);
    expect(calculateStats([[source[0][0], result[0][0]]], 'hiking').distance).toBeCloseTo(500, 3);
    expect(calculateStats([[source[0][2], result[0].at(-1)!]], 'hiking').distance).toBeCloseTo(
      500,
      3,
    );
    expect(result[0][0]).toHaveLength(2);
    expect(result[0][1]).toEqual([0.02, 0, 200]);
    expect(result[0].at(-1)).toHaveLength(2);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('clips sparse edges with both vertices outside, including later revisits and gaps', () => {
    const result = clipRouteCardGeometry(
      [
        [
          [0, 0],
          [0.03, 0],
        ],
        [
          [-0.03, 0],
          [0.03, 0],
        ],
        [
          [0.04, 0],
          [0.05, 0],
        ],
      ],
      1000,
    );
    expect(result).toHaveLength(4);
    expect(result[1][0]).toEqual([-0.03, 0]);
    expect(result[1].at(-1)![0]).toBeCloseTo(-0.0089932, 6);
    expect(result[2][0][0]).toBeCloseTo(0.0089932, 6);
    expect(result[2].at(-1)).toEqual([0.03, 0]);
    for (const segment of result) {
      const a = segment[0],
        b = segment.at(-1)!;
      for (let step = 0; step <= 10; step++) {
        const point: Coordinate = [a[0] + ((b[0] - a[0]) * step) / 10, 0];
        for (const center of [
          [0, 0],
          [0.05, 0],
        ] satisfies Coordinate[]) {
          expect(calculateStats([[center, point]], 'hiking').distance).toBeGreaterThanOrEqual(
            999.999,
          );
        }
      }
    }
  });

  it('removes multiple loop revisits rather than trimming only the beginning and end', () => {
    const result = clipRouteCardGeometry(
      [
        [
          [0, 0],
          [0.02, 0],
          [0, 0],
          [-0.02, 0],
          [0, 0],
        ],
      ],
      500,
    );
    expect(result).toHaveLength(2);
    expect(result[0].map((point) => point[0])).toEqual([
      expect.closeTo(0.0044966, 6),
      0.02,
      expect.closeTo(0.0044966, 6),
    ]);
    expect(result[1][1]).toEqual([-0.02, 0]);
  });

  it('uses the short dateline arc for privacy and projection', () => {
    const visible = clipRouteCardGeometry(
      [
        [
          [179.98, 0],
          [-179.98, 0],
        ],
      ],
      500,
    );
    expect(calculateStats(visible, 'hiking').distance).toBeCloseTo(3447.8, 0);
    const result = projectRouteCardGeometry(visible, { x: 10, y: 20, width: 100, height: 200 });
    expect(result[0][0][0]).toBeCloseTo(10);
    expect(result[0][1][0]).toBeCloseTo(110);
    expect(result[0][0][1]).toBeCloseTo(120);
    expect(result[0][1][1]).toBeCloseTo(120);
  });

  it('preserves separate segments and actual source elevations without privacy', () => {
    const input: Coordinate[][] = [
      [
        [0, 0, 0],
        [0, 0],
        [1, 1],
      ],
      [],
      [
        [2, 2],
        [3, 3],
      ],
    ];
    const visible = clipRouteCardGeometry(input, 0);
    expect(visible).toEqual([input[0], input[2]]);
    expect(visible[0][0]).not.toBe(input[0][0]);
    expect(projectRouteCardGeometry(visible, { x: 0, y: 0, width: 500, height: 500 })).toHaveLength(
      2,
    );
  });

  const invalidGeometry: Coordinate[][][] = [
    [],
    [[]],
    [[[NaN, 0]]],
    [[[181, 0]]],
    [[[0, 91]]],
    [[[0, 0, Infinity]]],
  ];
  it.each(invalidGeometry.map((segments) => ({ segments })))(
    'rejects invalid or empty raw input $segments',
    ({ segments }) => {
      expect(() => clipRouteCardGeometry(segments, 0)).toThrow('No route geometry is available.');
    },
  );
  const invisibleGeometry: Coordinate[][][] = [
    [[[0, 0]]],
    [
      [
        [0, 0],
        [0, 0],
      ],
    ],
    [
      [
        [0, 0],
        [0.001, 0],
      ],
    ],
  ];
  it.each(invisibleGeometry.map((segments) => ({ segments })))(
    'rejects geometry with no drawable remainder $segments',
    ({ segments }) => {
      expect(() => clipRouteCardGeometry(segments, 500)).toThrow(noVisible);
    },
  );
  it.each([-1, 10001, NaN, Infinity])('rejects invalid privacy radius %s', (radius) => {
    expect(() => clipRouteCardGeometry(request.segments, radius)).toThrow(renderError);
  });
  it.each([0.01, 0.1, 1, 10_000])('clips radius %s accurately even below one metre', (radius) => {
    const geometry: Coordinate[][] = [
      [
        [10, 40],
        [10, 41],
      ],
    ];
    const result = clipRouteCardGeometry(geometry, radius);
    expect(calculateStats([[geometry[0][0], result[0][0]]], 'hiking').distance).toBeCloseTo(
      radius,
      4,
    );
    expect(calculateStats([[geometry[0][1], result[0].at(-1)!]], 'hiking').distance).toBeCloseTo(
      radius,
      4,
    );
  });
  it('does not collapse valid routes above Mercator latitude limits', () => {
    const result = projectRouteCardGeometry(
      clipRouteCardGeometry(
        [
          [
            [0, 86],
            [0, 87],
          ],
        ],
        0,
      ),
      { x: 0, y: 0, width: 500, height: 700 },
    );
    expect(Math.abs(result[0][0][1] - result[0][1][1])).toBeCloseTo(700);
  });
  it('handles polar and antipodal geometry without nonfinite projection', () => {
    const geometry = clipRouteCardGeometry(
      [
        [
          [0, 90],
          [180, -90],
        ],
      ],
      500,
    );
    const points = projectRouteCardGeometry(geometry, { x: 0, y: 0, width: 500, height: 700 });
    expect(points.flat(2).every(Number.isFinite)).toBe(true);
  });
  it('handles a large route without argument spreading or unbounded simplification', () => {
    const segment: Coordinate[] = Array.from({ length: 100_000 }, (_, index) => [
      index / 100_000,
      Math.sin(index / 1000) / 100,
    ]);
    const result = projectRouteCardGeometry(clipRouteCardGeometry([segment], 0), {
      x: 0,
      y: 0,
      width: 100,
      height: 200,
    });
    expect(result[0]).toHaveLength(100_000);
    expect(result[0].flat().every(Number.isFinite)).toBe(true);
  });
});

describe('conservative projected privacy areas', () => {
  const bounds = { x: 104, y: 400, width: 872, height: 600 };
  it.each([0, 179.98])(
    'protects endpoints outside visible bounds, including longitude %s',
    (longitude) => {
      const finish = longitude + 0.04 > 180 ? longitude + 0.04 - 360 : longitude + 0.04;
      const source: Coordinate[][] = [
        [
          [longitude, 0],
          [finish, 0],
        ],
      ];
      const before = JSON.stringify(source);
      const geometry = clipRouteCardGeometry(source, 500);
      const { points, privacyAreas } = projectRouteCardDrawing(geometry, source, 500, bounds);
      expect(privacyAreas).toHaveLength(2);
      const [start, end] = privacyAreas;
      expect(start.x).toBeLessThan(bounds.x);
      expect(start.x + start.width).toBeGreaterThanOrEqual(points[0][0][0] + 8);
      expect(end.x).toBeLessThanOrEqual(points[0].at(-1)![0] - 8);
      expect(end.x + end.width).toBeGreaterThan(bounds.x + bounds.width);
      expect(start.y).toBeLessThan(700 - 8);
      expect(start.y + start.height).toBeGreaterThan(700 + 8);
      expect(JSON.stringify(source)).toBe(before);
    },
  );
  it('keeps overlapping spherical-cap envelopes as separate exclusions', () => {
    const source: Coordinate[][] = [
      [
        [0, 0],
        [0.0025, 0.004],
        [0.02, 0.02],
        [0.005, 0],
      ],
    ];
    const { privacyAreas } = projectRouteCardDrawing(
      clipRouteCardGeometry(source, 500),
      source,
      500,
      bounds,
    );
    expect(privacyAreas).toHaveLength(2);
    const [a, b] = privacyAreas;
    expect(Math.max(a.x, b.x)).toBeLessThan(Math.min(a.x + a.width, b.x + b.width));
    expect(Math.max(a.y, b.y)).toBeLessThan(Math.min(a.y + a.height, b.y + b.height));
  });
  it('uses spherical rather than equatorial longitude bounds at high latitude', () => {
    const source: Coordinate[][] = [
      [
        [10, 84],
        [10.2, 84],
      ],
    ];
    const visible = clipRouteCardGeometry(source, 500);
    const { points, privacyAreas } = projectRouteCardDrawing(visible, source, 500, bounds);
    expect(privacyAreas[0].x + privacyAreas[0].width).toBeGreaterThanOrEqual(points[0][0][0] + 8);
    expect(privacyAreas[1].x).toBeLessThanOrEqual(points[0].at(-1)![0] - 8);
  });
});

describe('offline PNG rendering', () => {
  it.each(['light', 'dark'] as const)(
    'draws the actual offline app icon and prominent wordmark in %s',
    async (theme) => {
      const { canvas, context } = canvasMock();
      const colors: string[] = [];
      context.fill.mockImplementation(() => {
        colors.push(context.fillStyle);
      });
      await renderRouteCard({ ...request, theme }, canvas);
      expect(colors).toEqual(expect.arrayContaining(['#173b30', '#faf7f2', '#bdd3a5']));
      expect(context.roundRect).toHaveBeenCalledExactlyOnceWith(72, 1224, 72, 72, 18);
      expect(context.bezierCurveTo).toHaveBeenCalledTimes(6);
      expect(context.arc).toHaveBeenCalledWith(118.875, 1242.375, 6.375, 0, Math.PI * 2);
      expect(context.fillText).toHaveBeenLastCalledWith('Roamlet', 164, 1239);
      expect(context.font).toBe('700 42px sans-serif');
    },
  );
  it('rejects a card whose conservative privacy mask hides its whole visible route', async () => {
    const { canvas } = canvasMock();
    await expect(
      renderRouteCard(
        {
          ...request,
          segments: [
            [
              [0, 0],
              [0.004, 0.004],
              [0, 0],
            ],
          ],
          privacyRadius: 500,
        },
        canvas,
      ),
    ).rejects.toThrow(noVisible);
  });
  const ambiguous: Coordinate[][][] = [
    [
      [
        [0, 86],
        [1, 86],
      ],
    ],
    [
      [
        [0, 0],
        [180, 0],
      ],
    ],
  ];
  it.each(ambiguous.map((segments) => ({ segments })))(
    'rejects ambiguous polar/antipodal privacy geometry $segments',
    async ({ segments }) => {
      const { canvas } = canvasMock();
      await expect(
        renderRouteCard({ ...request, segments, privacyRadius: 500 }, canvas),
      ).rejects.toThrow(renderError);
    },
  );
  it.each(['post', 'story'] as const)(
    'renders fixed %s dimensions, bounded labels, metrics and branding',
    async (format) => {
      const { canvas, context } = canvasMock();
      const blob = await renderRouteCard(
        {
          ...request,
          format,
          title: 'Long title '.repeat(100),
          activityLabel: 'Hike '.repeat(100),
          metrics: Array.from({ length: 6 }, () => ({
            label: 'Time '.repeat(100),
            value: '1234567890 '.repeat(100),
          })),
        },
        canvas,
      );
      expect([canvas.width, canvas.height]).toEqual([1080, format === 'post' ? 1350 : 1920]);
      expect(blob.type).toBe('image/png');
      expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
      expect(context.fillText).toHaveBeenCalledWith('Roamlet', 164, canvas.height - 111);
      expect(context.roundRect).toHaveBeenCalledWith(72, canvas.height - 126, 72, 72, 18);
      expect(context.bezierCurveTo).toHaveBeenCalledTimes(6);
      const title = context.fillText.mock.calls.filter((call) => call[2] >= 126 && call[2] <= 278);
      expect(title).toHaveLength(3);
      expect(title.at(-1)![0]).toContain('…');
      for (const [text, x, y] of context.fillText.mock.calls) {
        expect(Array.from(text).length * 32).toBeLessThanOrEqual(936);
        expect(x).toBeGreaterThanOrEqual(72);
        expect(y).toBeLessThan(canvas.height);
      }
    },
  );
  it('clips each privacy area separately, so overlapping endpoint exclusions form a union', async () => {
    const { canvas, context } = canvasMock();
    await renderRouteCard(
      {
        ...request,
        segments: [
          [
            [0, 0],
            [0.0025, 0.004],
            [0.02, 0.02],
            [0.005, 0],
          ],
        ],
        privacyRadius: 500,
      },
      canvas,
    );
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.clip).toHaveBeenCalledTimes(4);
    expect(context.clip.mock.calls).toEqual([[], ['evenodd'], ['evenodd'], []]);
    expect(context.clip.mock.invocationCallOrder[2]).toBeLessThan(
      context.stroke.mock.invocationCallOrder[0],
    );
    expect(context.restore).toHaveBeenCalledTimes(2);
    expect(context.restore.mock.invocationCallOrder[0]).toBeGreaterThan(
      context.stroke.mock.invocationCallOrder.at(-1)!,
    );
    const metricCall = context.fillText.mock.calls.findIndex((call) => call[0] === 'Distance');
    expect(context.fillText.mock.invocationCallOrder[metricCall]).toBeGreaterThan(
      context.restore.mock.invocationCallOrder[0],
    );
    expect(context.fillRect).toHaveBeenCalledTimes(2);
  });
  it('supports dark themes and omits both endpoint markers with privacy', async () => {
    const { canvas, context } = canvasMock();
    await renderRouteCard({ ...request, theme: 'dark', privacyRadius: 500 }, canvas);
    expect(context.arc.mock.calls.some((call) => call[2] === 12)).toBe(false);
    expect(context.moveTo).toHaveBeenCalledTimes(2);
    expect(context.strokeStyle).toBe('#86d5a3');
  });
  it('follows sparse geodesic arcs rather than drawing a chord through a protected endpoint', () => {
    const visible = clipRouteCardGeometry(
      [
        [[0, 60]],
        [
          [-30, 60],
          [30, 60],
        ],
        [[80, 60]],
      ],
      1000,
    );
    const projected = projectRouteCardGeometry(visible, { x: 0, y: 0, width: 800, height: 600 });
    expect(projected[0].length).toBeGreaterThan(20);
    const first = projected[0][0],
      last = projected[0].at(-1)!;
    expect(first[1]).toBeCloseTo(last[1]);
    expect(Math.min(...projected[0].map((point) => point[1]))).toBeLessThan(first[1] - 10);
  });
  it('never bridges segment gaps', async () => {
    const { canvas, context } = canvasMock();
    await renderRouteCard(
      {
        ...request,
        segments: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [2, 2],
            [3, 3],
          ],
        ],
        privacyRadius: 500,
      },
      canvas,
    );
    expect(context.moveTo).toHaveBeenCalledTimes(3);
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.moveTo.mock.invocationCallOrder[1]).toBeGreaterThan(
      context.stroke.mock.invocationCallOrder[0],
    );
  });
  it('deduplicates subpixel points before drawing', async () => {
    const { canvas, context } = canvasMock();
    const segment: Coordinate[] = Array.from({ length: 10_000 }, (_, index) => [index / 10_000, 0]);
    await renderRouteCard({ ...request, segments: [segment] }, canvas);
    expect(context.lineTo.mock.calls.length).toBeLessThan(1200);
  });
  it('retains geometry errors instead of hiding them as canvas failures', async () => {
    const { canvas } = canvasMock();
    await expect(renderRouteCard({ ...request, segments: [] }, canvas)).rejects.toThrow(
      'No route geometry is available.',
    );
    await expect(renderRouteCard({ ...request, privacyRadius: 10_000 }, canvas)).rejects.toThrow(
      noVisible,
    );
    expect(canvas.getContext).not.toHaveBeenCalled();
  });
  it.each(['context', 'draw', 'empty', 'wrong-format', 'encode'] as const)(
    'normalizes %s rendering failures',
    async (failure) => {
      const { canvas, context } = canvasMock();
      if (failure === 'context') Object.defineProperty(canvas, 'getContext', { value: () => null });
      if (failure === 'draw')
        context.fillRect.mockImplementation(() => {
          throw new Error('failed');
        });
      if (failure === 'empty')
        Object.defineProperty(canvas, 'toBlob', {
          value: (callback: BlobCallback) => callback(null),
        });
      if (failure === 'wrong-format')
        Object.defineProperty(canvas, 'toBlob', {
          value: (callback: BlobCallback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })),
        });
      if (failure === 'encode')
        Object.defineProperty(canvas, 'toBlob', {
          value: () => {
            throw new Error('encode failed');
          },
        });
      await expect(renderRouteCard(request, canvas)).rejects.toThrow(renderError);
    },
  );
});
