import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { calculateStats } from './stats';
import type { Coordinate, PlannedRoute, Waypoint } from './types';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_POINTS = 100_000;
const MAX_DEPTH = 64;
type XmlNode = { [key: string]: XmlNode[] | Record<string, string> | string };
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&([^;]*);/g, (_match, entity: string) => {
    if (Object.hasOwn(XML_ENTITIES, entity)) return XML_ENTITIES[entity];
    if (!/^#(?:\d+|x[\da-fA-F]+)$/.test(entity)) throw new Error('Invalid GPX: undeclared XML entity.');
    const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xD7FF)
      || (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF))) {
      throw new Error('Invalid GPX XML character reference.');
    }
    return String.fromCodePoint(code);
  });
}

function children(node: XmlNode, name: string): XmlNode[] {
  return (node[name] as XmlNode[] | undefined) ?? [];
}
function named(nodes: XmlNode[], name: string): XmlNode[] {
  return nodes.filter(node => Object.hasOwn(node, name));
}
function text(nodes: XmlNode[], name: string): string | undefined {
  const node = named(nodes, name)[0];
  if (!node) return undefined;
  const content = children(node, name);
  if (content.some(part => !Object.hasOwn(part, '#text') && !Object.hasOwn(part, '#cdata'))) {
    throw new Error(`Invalid GPX ${name}: expected text.`);
  }
  return content.map(part => Object.hasOwn(part, '#cdata')
    ? children(part, '#cdata').map(value => String(value['#text'] ?? '')).join('')
    : decodeXml(String(part['#text'] ?? ''))).join('');
}
function number(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    throw new Error(`Invalid GPX ${label}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid GPX ${label}.`);
  return parsed;
}
function coordinate(node: XmlNode, tag: string): Coordinate {
  const attributes = node[':@'] as Record<string, string> | undefined;
  const latitude = number(attributes?.['@_lat'] === undefined ? undefined : decodeXml(attributes['@_lat']), 'latitude');
  const longitude = number(attributes?.['@_lon'] === undefined ? undefined : decodeXml(attributes['@_lon']), 'longitude');
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('GPX coordinate is out of bounds.');
  const elevation = text(children(node, tag), 'ele');
  return elevation === undefined ? [longitude, latitude] : [longitude, latitude, number(elevation, 'elevation')];
}

function checkXml(text: string): void {
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) {
    throw new Error('GPX file exceeds the 10 MiB limit.');
  }
  if (!text.trim()) throw new Error('GPX file is empty.');
  xmlText(text);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('GPX DTDs and entity declarations are not allowed.');
  // Bound nesting before invoking the parser, including ignored extension elements.
  const markup = text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '');
  decodeXml(markup);
  let depth = 0;
  for (const match of markup.matchAll(/<\/?[A-Za-z_][^>]*>/g)) {
    if (match[0].startsWith('</')) depth--;
    else if (!match[0].endsWith('/>') && ++depth > MAX_DEPTH) throw new Error('GPX nesting exceeds the safe limit.');
  }
  const validation = XMLValidator.validate(text);
  if (validation !== true) throw new Error(`Malformed GPX XML: ${validation.err.msg}`);
}

export function importGpx(input: string): PlannedRoute {
  checkXml(input);
  let nodes: XmlNode[];
  try {
    nodes = new XMLParser({ preserveOrder: true, ignoreAttributes: false, removeNSPrefix: true,
      parseTagValue: false, parseAttributeValue: false, trimValues: false,
      processEntities: false, cdataPropName: '#cdata' }).parse(input) as XmlNode[];
  } catch {
    throw new Error('Malformed GPX XML.');
  }
  const roots = nodes.filter(node => !Object.keys(node).some(key => key.startsWith('?')));
  if (roots.length !== 1 || !Object.hasOwn(roots[0], 'gpx')) throw new Error('Invalid GPX: expected a gpx root element.');
  const root = children(roots[0], 'gpx');
  const segments: Coordinate[][] = [];
  const waypoints: Waypoint[] = [];
  let count = 0;
  const point = (node: XmlNode, tag: string): Coordinate => {
    if (++count > MAX_POINTS) throw new Error('GPX exceeds the 100,000 point limit.');
    return coordinate(node, tag);
  };
  let routeName: string | undefined;
  let description: string | undefined;
  for (const node of root) {
    if (Object.hasOwn(node, 'trk')) {
      const track = children(node, 'trk');
      routeName ??= text(track, 'name');
      description ??= text(track, 'desc');
      for (const segment of named(track, 'trkseg')) {
        segments.push(named(children(segment, 'trkseg'), 'trkpt').map(node => point(node, 'trkpt')));
      }
    } else if (Object.hasOwn(node, 'rte')) {
      const route = children(node, 'rte');
      routeName ??= text(route, 'name');
      description ??= text(route, 'desc');
      segments.push(named(route, 'rtept').map(node => point(node, 'rtept')));
    } else if (Object.hasOwn(node, 'wpt')) {
      waypoints.push({ id: crypto.randomUUID(), name: text(children(node, 'wpt'), 'name') ?? 'Waypoint', coordinate: point(node, 'wpt') });
    }
  }
  if (!count) throw new Error('GPX contains no track, route, or waypoint points.');
  const metadata = children(named(root, 'metadata')[0] ?? {}, 'metadata');
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: text(metadata, 'name') ?? text(root, 'name') ?? routeName ?? 'Imported route',
    description: text(metadata, 'desc') ?? text(root, 'desc') ?? description ?? '', activity: 'hiking',
    segments, waypoints, stats: calculateStats(segments, 'hiking'), createdAt: now, updatedAt: now, source: 'gpx' };
}

function xmlText(value: string): string {
  // eslint-disable-next-line no-control-regex -- Intentionally reject control characters forbidden in XML.
  if (typeof value !== 'string' || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value)
    || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid text for GPX XML.');
  return value;
}
function xmlPoint(point: Coordinate): Record<string, number> {
  calculateStats([[point]], 'hiking');
  return { '@_lat': point[1], '@_lon': point[0], ...(point.length === 3 ? { ele: point[2] } : {}) };
}

export function exportGpx(route: PlannedRoute): string {
  const count = route.segments.reduce((sum, segment) => sum + segment.length, 0) + route.waypoints.length;
  if (!count) throw new Error('Cannot export an empty GPX route.');
  if (count > MAX_POINTS) throw new Error('GPX exceeds the 100,000 point limit.');
  const result = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLBuilder({ ignoreAttributes: false, format: true }).build({
    gpx: { '@_xmlns': 'http://www.topografix.com/GPX/1/1', '@_version': '1.1', '@_creator': 'Roamlet',
      metadata: { name: xmlText(route.name), desc: xmlText(route.description) },
      wpt: route.waypoints.map(waypoint => ({ ...xmlPoint(waypoint.coordinate), name: xmlText(waypoint.name) })),
      trk: { name: xmlText(route.name), desc: xmlText(route.description),
        trkseg: route.segments.map(segment => ({ trkpt: segment.map(xmlPoint) })) } },
  });
  if (new TextEncoder().encode(result).length > MAX_BYTES) throw new Error('GPX file exceeds the 10 MiB limit.');
  return result;
}

export function gpxFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- Intentionally sanitize control characters in filenames.
  const safe = name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, '-').replace(/\.gpx$/i, '')
    .replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100).replace(/[.\s]+$/g, '') || 'route';
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `route-${safe}` : safe}.gpx`;
}
