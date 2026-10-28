import { describe, expect, it } from 'vitest';
import { exportGpx, gpxFilename, importGpx } from './gpx';

const fixture = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
<metadata><name>Hill &amp; lake</name><desc>Walk &lt;outside&gt;</desc></metadata>
<trk><trkseg><trkpt lat="50" lon="10"><ele>100</ele></trkpt><trkpt lat="50.001" lon="10.002"><ele>125</ele></trkpt></trkseg><trkseg/></trk>
<rte><rtept lat="51" lon="11"><ele>900</ele></rtept><rtept lat="51.001" lon="11.002"><ele>880</ele></rtept></rte>
<trk><trkseg><trkpt lat="52" lon="12"><ele>150</ele></trkpt></trkseg></trk>
<wpt lat="50.002" lon="10.003"><ele>130</ele><name>Cafe &amp; rest</name></wpt>
</gpx>`;

describe('GPX', () => {
  it('attributes new Mapbox exports without relicensing provider data as ODbL', () => {
    const route = importGpx(fixture);
    route.source = 'mapbox';
    const xml = exportGpx(route);
    expect(xml).toContain('Routing and terrain by Mapbox');
    expect(xml).toContain('https://www.mapbox.com/about/maps/');
    expect(xml).toContain('Mapbox / OpenStreetMap contributors');
    expect(xml).not.toContain('<license>');
    expect(importGpx(xml).segments).toEqual(route.segments);
  });
  it('roundtrips every track/route point, empty segment, elevation and standalone waypoint', () => {
    const route = importGpx(fixture);
    expect(route.segments).toEqual([
      [
        [10, 50, 100],
        [10.002, 50.001, 125],
      ],
      [],
      [
        [11, 51, 900],
        [11.002, 51.001, 880],
      ],
      [[12, 52, 150]],
    ]);
    expect(route.stats.ascent).toBe(25);
    expect(route.stats.descent).toBe(20);
    const imported = importGpx(exportGpx(route));
    expect(imported.segments).toEqual(route.segments);
    expect(imported.waypoints.map(({ name, coordinate }) => ({ name, coordinate }))).toEqual([
      { name: 'Cafe & rest', coordinate: [10.003, 50.002, 130] },
    ]);
    expect(imported.name).toBe('Hill & lake');
    expect(imported.description).toBe('Walk <outside>');
    expect(imported.id).not.toBe(route.id);
  });

  it('escapes markup, quotes, Unicode and entity-looking text safely', () => {
    const route = importGpx(fixture);
    route.name = '<script> & "quotes" 😀';
    route.description = 'literal &foo; and ]]>';
    const xml = exportGpx(route);
    expect(xml).not.toContain('<script>');
    const result = importGpx(xml);
    expect(result.name).toBe(route.name);
    expect(result.description).toBe(route.description);
  });

  it('decodes XML references once, preserves whitespace and leaves CDATA literal', () => {
    const route = importGpx(
      '<gpx><metadata><name> &#x1F600; &amp;amp; </name><desc><![CDATA[&unknown; <literal>]]></desc></metadata><wpt lat="&#49;" lon="0"/></gpx>',
    );
    expect(route.name).toBe(' 😀 &amp; ');
    expect(route.description).toBe('&unknown; <literal>');
    expect(route.waypoints[0].coordinate).toEqual([0, 1]);
    expect(importGpx(exportGpx(route)).name).toBe(route.name);
  });

  it('supports prefixes, missing elevations and waypoint-only GPX', () => {
    const route = importGpx(
      '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:name>Track</g:name><g:desc>Details</g:desc><g:trkseg><g:trkpt lat="-90" lon="180"/></g:trkseg></g:trk></g:gpx>',
    );
    expect(route.name).toBe('Track');
    expect(route.description).toBe('Details');
    expect(route.segments).toEqual([[[180, -90]]]);
    expect(route.stats.ascent).toBeUndefined();
    expect(importGpx(exportGpx(route)).segments).toEqual(route.segments);
    expect(importGpx('<gpx><wpt lat="0" lon="0"/></gpx>').waypoints).toHaveLength(1);
  });

  it.each([
    ['', /empty/],
    ['<gpx>', /Malformed/],
    ['<other/>', /root/],
    ['<gpx/><gpx/>', /Malformed|root/],
    ['<gpx/>', /no .*points/],
    ['<gpx><trk><trkseg/></trk></gpx>', /no .*points/],
    ['<gpx><name>&unknown;</name></gpx>', /entity/],
    ['<gpx><name>&#0;</name></gpx>', /character reference/],
    ['<gpx><name>&#x110000;</name></gpx>', /character reference/],
    ['<!DOCTYPE gpx [<!ENTITY x "boom">]><gpx/>', /DTD/],
    ['<!DOCTYPE gpx SYSTEM "file:///etc/passwd"><gpx/>', /DTD/],
    ['<gpx><wpt lat="91" lon="0"/></gpx>', /bounds/],
    ['<gpx><wpt lat="0" lon="181"/></gpx>', /bounds/],
    ['<gpx><wpt lat="0"/></gpx>', /longitude/],
    ['<gpx><wpt lat="NaN" lon="0"/></gpx>', /latitude/],
    ['<gpx><wpt lat="" lon="0"/></gpx>', /latitude/],
    ['<gpx><wpt lat="0" lon="0"><ele>Infinity</ele></wpt></gpx>', /elevation/],
  ])('rejects invalid GPX: %s', (xml, error) => {
    expect(() => importGpx(xml)).toThrow(error);
  });

  it('bounds file size, nesting and point count', () => {
    expect(() => importGpx(' '.repeat(10 * 1024 * 1024) + '<gpx/>')).toThrow(/10 MiB/);
    expect(() => importGpx('<gpx>' + '<x>'.repeat(65) + '</x>'.repeat(65) + '</gpx>')).toThrow(
      /nesting/,
    );
    expect(() =>
      importGpx('<gpx><rte>' + '<rtept lat="0" lon="0"/>'.repeat(100_001) + '</rte></gpx>'),
    ).toThrow(/point limit/);
    const route = importGpx(fixture);
    route.name = 'bad\u0000text';
    expect(() => exportGpx(route)).toThrow(/Invalid text/);
    route.name = 'valid';
    route.segments[0][0] = [181, 0];
    expect(() => exportGpx(route)).toThrow(/coordinate/);
    route.segments = [];
    route.waypoints = [];
    expect(() => exportGpx(route)).toThrow(/empty/);
  });

  it('produces bounded portable filenames', () => {
    expect(gpxFilename('../bad/name.gpx')).toBe('-bad-name.gpx');
    expect(gpxFilename(' .. ')).toBe('route.gpx');
    expect(gpxFilename('CON')).toBe('route-CON.gpx');
    expect(gpxFilename('a'.repeat(500)).length).toBe(104);
    expect(gpxFilename('walk.GPX')).toBe('walk.gpx');
  });
});
