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
  activity: 'hiking',
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
  const gradients: { stops: [number, string][] }[] = [];
  const gradient = () => {
    const stops: [number, string][] = [];
    gradients.push({ stops });
    return { addColorStop: vi.fn((offset: number, color: string) => stops.push([offset, color])) };
  };
  const strokes: { width: number; color: string }[] = [];
  const texts: { text: string; x: number; y: number; font: string; width: number }[] = [];
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
    measureText: vi.fn((text: string) => ({
      width: Array.from(text).length * Number(context.font.match(/(\d+)px/)?.[1] ?? 32) * 0.6,
    })),
    createLinearGradient: vi.fn(gradient),
    createRadialGradient: vi.fn(gradient),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  };
  context.stroke.mockImplementation(() => {
    strokes.push({ width: context.lineWidth, color: context.strokeStyle });
  });
  context.fillText.mockImplementation((text: string, x: number, y: number) => {
    texts.push({ text, x, y, font: context.font, width: context.measureText(text).width });
  });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { value: vi.fn(() => context), configurable: true });
  Object.defineProperty(canvas, 'toBlob', {
    value: vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))),
    configurable: true,
  });
  return { canvas, context, gradients, strokes, texts };
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
  it.each(
    (['cycling', 'hiking'] as const).flatMap((activity) =>
      (['light', 'dark'] as const).map((theme) => ({ activity, theme })),
    ),
  )(
    'draws a lightweight $activity icon beside the localized label in $theme',
    async ({ activity, theme }) => {
      const { canvas, context, texts, strokes } = canvasMock();
      await renderRouteCard(
        { ...request, activity, theme, activityLabel: 'Локализованная активность' },
        canvas,
      );
      const label = texts.find((text) => text.font === '500 30px sans-serif')!;
      expect(label.x).toBe(116);
      const scale = 32 / 24;
      const radius = (activity === 'cycling' ? 4 : 2) * scale;
      const arcs = context.arc.mock.calls.filter((call) => call[2] === radius);
      expect(arcs).toHaveLength(activity === 'cycling' ? 2 : 1);
      expect(arcs[0][0]).toBe(72 + (activity === 'cycling' ? 5 : 13) * scale);
      expect(arcs[0][1]).toBe(label.y + (activity === 'cycling' ? 17 : 4) * scale);
      expect(strokes).toContainEqual({ width: 2, color: theme === 'dark' ? '#adc5b6' : '#597264' });
    },
  );

  it.each(
    (['light', 'dark'] as const).flatMap((theme) =>
      Array.from({ length: 7 }, (_, count) => ({ theme, count })),
    ),
  )(
    'separates $count metric cells without trailing dividers in $theme',
    async ({ theme, count }) => {
      const { canvas, context, texts } = canvasMock();
      const color = theme === 'dark' ? '#adc5b62e' : '#59726433';
      const dividers: { from: number[]; to: number[] }[] = [];
      context.stroke.mockImplementation(() => {
        if (context.strokeStyle === color) {
          expect(context.lineWidth).toBe(1.5);
          dividers.push({
            from: context.moveTo.mock.calls.at(-1) ?? [],
            to: context.lineTo.mock.calls.at(-1) ?? [],
          });
        }
      });
      await renderRouteCard(
        {
          ...request,
          theme,
          metrics: Array.from({ length: count }, (_, index) => ({
            label: `Metric ${index}`,
            value: '12.3 km',
          })),
        },
        canvas,
      );
      const columns = count === 4 ? 2 : Math.min(count, 3);
      const rows = columns ? Math.ceil(count / columns) : 0;
      expect(dividers).toHaveLength(count - rows);
      const labels = texts.filter((text) => text.font === '500 22px sans-serif');
      const expected = labels
        .filter((_, index) => index % columns > 0)
        .map((label) => ({
          from: [label.x - 24, label.y + 4],
          to: [label.x - 24, label.y + 108],
        }));
      expect(dividers).toEqual(expected);
      const values = texts.filter((text) => text.font === '700 44px sans-serif');
      expect(values).toHaveLength(count);
      if (count) expect(context.roundRect.mock.calls[2][4]).toBe(28);
    },
  );
  it.each(['light', 'dark'] as const)(
    'draws the actual offline app icon and prominent wordmark in %s',
    async (theme) => {
      const { canvas, context, texts } = canvasMock();
      const colors: string[] = [];
      context.fill.mockImplementation(() => {
        colors.push(context.fillStyle);
      });
      await renderRouteCard({ ...request, theme }, canvas);
      expect(colors).toEqual(expect.arrayContaining(['#173b30', '#faf7f2', '#bdd3a5']));
      expect(context.roundRect).toHaveBeenCalledWith(72, 72, 96, 96, 24);
      expect(context.bezierCurveTo.mock.calls.slice(54)).toEqual(
        [
          [70, 58, 126, 68, 126, 92],
          [126, 115, 73, 116, 73, 128],
          [73, 144, 136, 140, 169, 188],
          [102, 177, 33, 163, 33, 134],
          [33, 108, 98, 104, 98, 89],
          [98, 75, 29, 57, 38, 56],
        ].map((points) => points.map((coordinate) => 72 + coordinate / 2)),
      );
      expect(context.arc).toHaveBeenCalledWith(134.5, 96.5, 8.5, 0, Math.PI * 2);
      expect(context.fillText).toHaveBeenNthCalledWith(1, 'Roamlet', 200, 90);
      expect(texts[0].font).toBe('800 60px sans-serif');
      expect(context.fillText.mock.invocationCallOrder[0]).toBeLessThan(
        context.fillText.mock.invocationCallOrder[1],
      );
      expect(context.roundRect.mock.calls[1][1]).toBe(200);
    },
  );
  it.each(['light', 'dark'] as const)(
    'uses deterministic offline gradients and fixed decorative waves in %s',
    async (theme) => {
      const first = canvasMock();
      const second = canvasMock();
      await renderRouteCard({ ...request, theme }, first.canvas);
      await renderRouteCard(
        {
          ...request,
          theme,
          segments: [
            [
              [20, 30],
              [21, 32],
            ],
          ],
        },
        second.canvas,
      );
      expect(first.context.createLinearGradient).toHaveBeenCalledExactlyOnceWith(0, 0, 1080, 1350);
      expect(first.context.createRadialGradient).toHaveBeenCalledExactlyOnceWith(
        880,
        648,
        0,
        880,
        648,
        760,
      );
      expect(first.gradients.map((gradient) => gradient.stops)).toEqual(
        second.gradients.map((gradient) => gradient.stops),
      );
      expect(first.gradients[0].stops).toEqual([
        [0, theme === 'dark' ? '#173b30' : '#faf7f2'],
        [0.5, theme === 'dark' ? '#10251e' : '#edf2e7'],
        [1, theme === 'dark' ? '#213b2c' : '#dbe7d0'],
      ]);
      expect(first.context.bezierCurveTo.mock.calls.slice(0, 54)).toEqual(
        second.context.bezierCurveTo.mock.calls.slice(0, 54),
      );
      expect(first.strokes.slice(0, 18)).toEqual(
        Array.from({ length: 18 }, () => ({
          width: 1.5,
          color: theme === 'dark' ? '#bdd3a514' : '#173b3010',
        })),
      );
      expect(first.strokes.slice(19, 21)).toEqual([
        { width: 14, color: theme === 'dark' ? '#10251e' : '#faf7f2' },
        { width: 9, color: theme === 'dark' ? '#86d5a3' : '#287348' },
      ]);
    },
  );

  const layouts = (['post', 'story'] as const).flatMap((format) =>
    (['light', 'dark'] as const).flatMap((theme) =>
      (['en', 'ru'] as const).flatMap((language) =>
        Array.from({ length: 7 }, (_, count) => ({ format, theme, language, count })),
      ),
    ),
  );
  it.each(layouts)(
    'bounds long $language text and $count metrics in $theme $format',
    async ({ format, theme, language, count }) => {
      const { canvas, context, texts } = canvasMock();
      const long =
        language === 'ru' ? 'Очень длинное название маршрута ' : 'A very long route title ';
      await renderRouteCard(
        {
          ...request,
          format,
          theme,
          title: '🌲'.repeat(100) + long.repeat(40),
          plannedLabel: long.repeat(40),
          activityLabel: long.repeat(40),
          metrics: Array.from({ length: count }, () => ({
            label: long.repeat(40),
            value: '1234567890 '.repeat(40),
          })),
        },
        canvas,
      );
      const title = texts.filter((text) => text.font === '800 64px sans-serif');
      const activity = texts.filter((text) => text.font === '500 30px sans-serif');
      expect(title).toHaveLength(3);
      expect(title[0].text).not.toContain('…');
      expect(title[2].text).toContain('…');
      expect(activity).toHaveLength(2);
      expect(activity[0].y).toBeGreaterThan(title[2].y + 64);
      const [badgeX, badgeY, badgeWidth, badgeHeight] = context.roundRect.mock.calls[1];
      expect([badgeX, badgeY, badgeHeight]).toEqual([72, 200, 48]);
      expect(badgeWidth).toBeLessThanOrEqual(936);
      expect(texts[1].x + texts[1].width).toBeLessThanOrEqual(badgeX + badgeWidth - 24);
      expect(title[0].y).toBeGreaterThan(badgeY + badgeHeight);
      for (const text of texts) {
        expect(text.x).toBeGreaterThanOrEqual(72);
        expect(text.x + text.width).toBeLessThanOrEqual(1008);
        expect(text.y + Number(text.font.match(/(\d+)px/)![1])).toBeLessThanOrEqual(
          canvas.height - 72,
        );
      }
      const [routeX, routeY, routeWidth, routeHeight] = context.rect.mock.calls[0];
      expect(routeX).toBe(72);
      expect(routeWidth).toBe(936);
      expect(routeY).toBeGreaterThan(activity[1].y + 30);
      expect(routeHeight).toBeGreaterThan(250);
      const values = texts.filter((text) => text.font.startsWith('700 '));
      values.forEach((value) => {
        const size = Number(value.font.match(/(\d+)px/)![1]);
        expect(size).toBeGreaterThanOrEqual(32);
        expect(size).toBeLessThanOrEqual(44);
      });
      expect(values).toHaveLength(count);
      if (!count) {
        expect(context.roundRect).toHaveBeenCalledTimes(2);
        return;
      }
      const [panelX, panelY, panelWidth, panelHeight] = context.roundRect.mock.calls[2];
      expect([panelX, panelWidth, panelY + panelHeight]).toEqual([72, 936, canvas.height - 72]);
      expect(routeY + routeHeight).toBeLessThan(panelY);
      const columns = count === 4 ? 2 : Math.min(count, 3);
      const cellWidth = (856 - (columns - 1) * 48) / columns;
      const labels = texts.filter((text) => text.font === '500 22px sans-serif');
      expect(labels).toHaveLength(count * 2);
      values.forEach((value, index) => {
        const x = panelX + 40 + (index % columns) * (cellWidth + 48);
        const y = panelY + 36 + Math.floor(index / columns) * 128;
        expect(value.x).toBe(x);
        expect(value.y + Number(value.font.match(/(\d+)px/)![1])).toBe(y + 112);
        for (const text of [value, ...labels.slice(index * 2, index * 2 + 2)]) {
          expect(text.x).toBe(x);
          expect(text.width).toBeLessThanOrEqual(cellWidth);
          expect(text.y).toBeGreaterThanOrEqual(panelY + 32);
          expect(text.y + Number(text.font.match(/(\d+)px/)![1])).toBeLessThanOrEqual(
            panelY + panelHeight - 32,
          );
        }
        expect(labels[index * 2 + 1].y + 22).toBeLessThan(value.y);
      });
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
      const { canvas, context, texts } = canvasMock();
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
      expect(context.fillText).toHaveBeenCalledWith('Roamlet', 200, 90);
      expect(context.roundRect).toHaveBeenCalledWith(72, 72, 96, 96, 24);
      const title = texts.filter((call) => call.font === '800 64px sans-serif');
      expect(title).toHaveLength(3);
      expect(title.at(-1)!.text).toContain('…');
      for (const { x, y, width, font } of texts) {
        expect(x).toBeGreaterThanOrEqual(72);
        expect(x + width).toBeLessThanOrEqual(1008);
        expect(y).toBeGreaterThanOrEqual(72);
        expect(y + Number(font.match(/(\d+)px/)![1])).toBeLessThanOrEqual(canvas.height - 72);
      }
    },
  );
  it('clips each privacy area separately, so overlapping endpoint exclusions form a union', async () => {
    const { canvas, context, strokes } = canvasMock();
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
    expect(context.save).toHaveBeenCalledTimes(3);
    expect(context.clip).toHaveBeenCalledTimes(4);
    expect(context.clip.mock.calls).toEqual([[], [], ['evenodd'], ['evenodd']]);
    const firstRouteStroke = strokes.findIndex((stroke) => stroke.width === 14);
    for (let index = firstRouteStroke; index < strokes.length; index++) {
      if (strokes[index].width !== 14 && strokes[index].width !== 9) continue;
      expect(context.clip.mock.invocationCallOrder[3]).toBeLessThan(
        context.stroke.mock.invocationCallOrder[index],
      );
      expect(context.restore.mock.invocationCallOrder[2]).toBeGreaterThan(
        context.stroke.mock.invocationCallOrder[index],
      );
      expect(strokes[index].width / 2).toBeLessThan(8);
    }
    expect(firstRouteStroke).toBe(19);
    expect(context.restore).toHaveBeenCalledTimes(3);
    const metricCall = context.fillText.mock.calls.findIndex((call) => call[0] === 'Distance');
    expect(context.fillText.mock.invocationCallOrder[metricCall]).toBeGreaterThan(
      context.restore.mock.invocationCallOrder[2],
    );
    expect(context.fillRect).toHaveBeenCalledTimes(2);
  });
  it('supports dark themes and omits both endpoint markers with privacy', async () => {
    const { canvas, context, strokes } = canvasMock();
    await renderRouteCard({ ...request, theme: 'dark', privacyRadius: 500 }, canvas);
    expect(context.arc.mock.calls.some((call) => call[2] === 12)).toBe(false);
    expect(context.moveTo).toHaveBeenCalledTimes(26);
    expect(strokes).toContainEqual({ width: 9, color: '#86d5a3' });
    expect(context.strokeStyle).toBe('#adc5b62e');
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
    expect(context.moveTo).toHaveBeenCalledTimes(27);
    expect(context.stroke).toHaveBeenCalledTimes(25);
    const routeMoves = context.moveTo.mock.calls.slice(24, 26);
    expect(routeMoves).toHaveLength(2);
    expect(context.moveTo.mock.invocationCallOrder[25]).toBeGreaterThan(
      context.stroke.mock.invocationCallOrder[20],
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
