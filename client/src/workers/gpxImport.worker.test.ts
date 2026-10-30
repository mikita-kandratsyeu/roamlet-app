import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importGpx } from '../domain/gpx';
import type { GpxImportResponse } from './gpxImport.protocol';
import { runGpxImport } from './gpxImport.worker';

const fixture = `<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1">
<g:metadata><g:name> Hill &amp; lake 😀 </g:name><g:desc><![CDATA[&literal; <outside>]]></g:desc></g:metadata>
<g:trk><g:trkseg><g:trkpt lat="50" lon="10"><g:ele>100</g:ele></g:trkpt><g:trkpt lat="50.001" lon="10.002"><g:ele>125</g:ele></g:trkpt></g:trkseg><g:trkseg/></g:trk>
<g:rte><g:rtept lat="51" lon="11"><g:ele>900</g:ele></g:rtept><g:rtept lat="51.001" lon="11.002"><g:ele>880</g:ele></g:rtept></g:rte>
<g:trk><g:trkseg><g:trkpt lat="52" lon="12"/></g:trkseg></g:trk>
<g:wpt lat="50.002" lon="10.003"><g:ele>130</g:ele><g:name>Cafe &amp; rest</g:name></g:wpt>
</g:gpx>`;

function textFile(xml: string): File {
  const file = new File([xml], 'route.gpx');
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(xml) });
  return file;
}

function successful(response: GpxImportResponse) {
  if (response.status !== 'success') throw new Error(response.message);
  return response.route;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('GPX worker parsing', () => {
  it('runs File.text and unchanged parsing/statistics preserving all exact data', async () => {
    const expected = importGpx(fixture);
    const file = textFile(fixture);
    const result = successful(await runGpxImport({ file, language: 'en' }));
    expect(file.text).toHaveBeenCalledExactlyOnceWith();
    expect(result).toMatchObject({
      name: expected.name,
      description: expected.description,
      activity: expected.activity,
      source: expected.source,
      segments: expected.segments,
      stats: expected.stats,
    });
    expect(result.waypoints.map(({ name, coordinate }) => ({ name, coordinate }))).toEqual(
      expected.waypoints.map(({ name, coordinate }) => ({ name, coordinate })),
    );
    expect(result.id).not.toBe(expected.id);
    expect(result.createdAt).toBe(result.updatedAt);
  });

  it.each(['en', 'ru'] as const)(
    'works without DOM/storage globals with %s fallback names',
    async (language) => {
      vi.stubGlobal('window', undefined);
      vi.stubGlobal('document', undefined);
      vi.stubGlobal('localStorage', undefined);
      vi.stubGlobal('navigator', { language: 'en', languages: ['en'] });
      const result = successful(
        await runGpxImport({
          file: textFile('<gpx><wpt lat="0" lon="0"/></gpx>'),
          language,
        }),
      );
      expect(window).toBeInstanceOf(EventTarget);
      expect(result.name).toBe(language === 'ru' ? 'Импортированный маршрут' : 'Imported route');
      expect(result.waypoints[0].name).toBe(language === 'ru' ? 'Точка' : 'Waypoint');
      expect(result.segments).toEqual([]);
      expect(result.waypoints[0].coordinate).toEqual([0, 0]);
    },
  );

  it('retains explicitly empty names and partial elevations without fabricating heights', async () => {
    const result = successful(
      await runGpxImport({
        file: textFile(
          '<gpx><metadata><name/></metadata><trk><trkseg><trkpt lat="0" lon="0"><ele>100</ele></trkpt><trkpt lat="1" lon="1"/></trkseg></trk><wpt lat="0" lon="0"><name/></wpt></gpx>',
        ),
        language: 'ru',
      }),
    );
    expect(result.name).toBe('');
    expect(result.waypoints[0].name).toBe('');
    expect(result.segments).toEqual([
      [
        [0, 0, 100],
        [1, 1],
      ],
    ]);
    expect(result.stats.ascent).toBeUndefined();
    expect(result.stats.descent).toBeUndefined();
  });

  it.each([
    ['', 'GPX file is empty.'],
    ['<gpx>', 'Malformed GPX XML:'],
    ['<other/>', 'Invalid GPX: expected a gpx root element.'],
    ['<gpx/>', 'GPX contains no track, route, or waypoint points.'],
    ['<gpx><wpt lat="91" lon="0"/></gpx>', 'GPX coordinate is out of bounds.'],
    ['<gpx><wpt lat="0" lon="0"><ele>Infinity</ele></wpt></gpx>', 'Invalid GPX elevation.'],
    ['<!DOCTYPE gpx><gpx/>', 'GPX DTDs and entity declarations are not allowed.'],
    ['<gpx><name>&unknown;</name></gpx>', 'Invalid GPX: undeclared XML entity.'],
  ])('serializes unchanged validation errors for %s', async (xml, message) => {
    const response = await runGpxImport({ file: textFile(xml), language: 'ru' });
    expect(response.status).toBe('error');
    if (response.status === 'error') expect(response.message).toContain(message);
  });

  it('enforces file size before reading it', async () => {
    const file = textFile('');
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });
    expect(await runGpxImport({ file, language: 'en' })).toEqual({
      status: 'error',
      message: 'GPX file exceeds the 10 MiB limit.',
    });
    expect(file.text).not.toHaveBeenCalled();
  });

  it('retains nesting and point limits in the real domain parser', async () => {
    const nesting = '<gpx>' + '<x>'.repeat(65) + '</x>'.repeat(65) + '</gpx>';
    expect(await runGpxImport({ file: textFile(nesting), language: 'en' })).toEqual({
      status: 'error',
      message: 'GPX nesting exceeds the safe limit.',
    });
    const points = '<gpx><rte>' + '<rtept lat="0" lon="0"/>'.repeat(100_001) + '</rte></gpx>';
    expect(await runGpxImport({ file: textFile(points), language: 'en' })).toEqual({
      status: 'error',
      message: 'GPX exceeds the 100,000 point limit.',
    });
  });

  it.each([false, true])(
    'posts worker results and handles response serialization failure: %s',
    async (failPost) => {
      const addEventListener =
        vi.fn<(type: string, listener: (event: MessageEvent) => void) => void>();
      const postMessage = vi.fn();
      if (failPost)
        postMessage.mockImplementationOnce(() => {
          throw new Error('DataCloneError');
        });
      vi.stubGlobal('window', undefined);
      vi.stubGlobal('document', undefined);
      vi.stubGlobal('localStorage', undefined);
      vi.stubGlobal('self', { addEventListener, postMessage });
      await import('./gpxImport.worker');
      expect(window).toBeInstanceOf(EventTarget);
      expect(document).toBeUndefined();
      expect(addEventListener).toHaveBeenCalledOnce();
      expect(addEventListener.mock.calls[0][0]).toBe('message');
      addEventListener.mock.calls[0][1](
        new MessageEvent('message', {
          data: { file: textFile('<gpx><wpt lat="0" lon="0"/></gpx>'), language: 'en' },
        }),
      );
      await vi.waitFor(() => {
        if (failPost) {
          expect(postMessage).toHaveBeenCalledTimes(2);
          expect(postMessage).toHaveBeenLastCalledWith({
            status: 'error',
            message: 'Something went wrong. Please try again.',
          });
        } else {
          expect(postMessage).toHaveBeenCalledExactlyOnceWith({
            status: 'success',
            route: expect.objectContaining({ source: 'gpx', name: 'Imported route' }),
          });
        }
      });
    },
  );

  it('returns file-read failures without trying to parse', async () => {
    const file = textFile('');
    vi.mocked(file.text).mockRejectedValue(new Error('Unable to read GPX.'));
    expect(await runGpxImport({ file, language: 'en' })).toEqual({
      status: 'error',
      message: 'Unable to read GPX.',
    });
  });
});
