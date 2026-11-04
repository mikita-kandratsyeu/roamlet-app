import { GithubError as ConnectorError, abortable } from './github-http.mjs';
export const BODY_LIMIT = 32 * 1024;
export const EVENT_ID = /^[a-v0-9]{32}$/;
function invalid() {
  throw new ConnectorError('invalid-data', 400);
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}
function text(value, max, multiline = false) {
  if (
    typeof value !== 'string' ||
    value.length > max * 2 ||
    [...value].length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code === 127 || (code < 32 && !(multiline && [9, 10, 13].includes(code)));
    })
  )
    invalid();
}
export function dateTime(value) {
  exact(value, ['dateTime', 'timeZone']);
  if (
    typeof value.timeZone !== 'string' ||
    value.timeZone.length > 100 ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value.timeZone) ||
    typeof value.dateTime !== 'string'
  )
    invalid();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value.dateTime,
    );
  if (!match) invalid();
  const [, year, month, day, hour, minute, second = '00', fraction = '', offset] = match;
  const civil = [year, month, day, hour, minute, second].map(Number);
  if (
    civil[0] < 1900 ||
    civil[0] > 2100 ||
    civil[1] < 1 ||
    civil[1] > 12 ||
    civil[2] < 1 ||
    civil[2] > 31 ||
    civil[3] > 23 ||
    civil[4] > 59 ||
    civil[5] > 59 ||
    (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))
  )
    invalid();
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, '0')}${offset}`;
  const instant = Date.parse(normalized);
  if (!Number.isFinite(instant)) invalid();
  const local = new Date(0);
  local.setUTCFullYear(civil[0], civil[1] - 1, civil[2]);
  local.setUTCHours(civil[3], civil[4], civil[5], Number(fraction.padEnd(3, '0')));
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (offset[0] === '+' ? 1 : -1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)));
  if (
    local.getUTCFullYear() !== civil[0] ||
    local.getUTCMonth() !== civil[1] - 1 ||
    local.getUTCDate() !== civil[2] ||
    local.getTime() - offsetMinutes * 60000 !== instant
  )
    invalid();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: value.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      era: 'short',
    }).formatToParts(new Date(instant));
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (
      fields.era !== 'AD' ||
      ['year', 'month', 'day', 'hour', 'minute', 'second'].some(
        (key, index) => Number(fields[key]) !== civil[index],
      )
    )
      invalid();
  } catch {
    invalid();
  }
  return instant;
}
export function publication(value) {
  exact(value, [
    'eventId',
    'summary',
    'description',
    'location',
    'start',
    'end',
    'reminderMinutes',
  ]);
  if (typeof value.eventId !== 'string' || !EVENT_ID.test(value.eventId)) invalid();
  text(value.summary, 200);
  if (!value.summary.trim()) invalid();
  text(value.description, 4000, true);
  text(value.location, 500);
  if (
    !Number.isInteger(value.reminderMinutes) ||
    value.reminderMinutes < 0 ||
    value.reminderMinutes > 40320
  )
    invalid();
  const start = dateTime(value.start);
  const end = dateTime(value.end);
  if (end <= start || end - start > 28 * 24 * 3600 * 1000) invalid();
  return value;
}
export async function readPublication(req, signal) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers?.['content-type'] ?? ''))
    throw new ConnectorError('invalid-data', 415);
  const length = req.headers?.['content-length'];
  if (
    length !== undefined &&
    (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > BODY_LIMIT)
  )
    throw new ConnectorError('too-large', 413);
  let bytes;
  if (req.body !== undefined) {
    if (signal.aborted) throw signal.reason;
    if (req.body instanceof Uint8Array || typeof req.body === 'string')
      bytes = Buffer.from(req.body);
    else {
      // Validate before serializing pre-decoded Vercel input, including rejecting extra keys.
      publication(req.body);
      let encoded;
      try {
        encoded = JSON.stringify(req.body);
      } catch {
        invalid();
      }
      if (typeof encoded !== 'string') invalid();
      bytes = Buffer.from(encoded);
    }
  } else {
    bytes = await abortable(
      new Promise((resolve, reject) => {
        const chunks = [];
        let count = 0;
        const cleanup = () => {
          for (const [event, fn] of [
            ['data', data],
            ['end', end],
            ['error', error],
            ['aborted', error],
          ])
            req.removeListener(event, fn);
          signal.removeEventListener('abort', abort);
        };
        const fail = (error) => {
          cleanup();
          req.resume?.();
          reject(error);
        };
        const error = () => fail(new ConnectorError('invalid-data', 400));
        const abort = () => fail(signal.reason);
        const data = (chunk) => {
          const buffer = Buffer.from(chunk);
          count += buffer.length;
          if (count > BODY_LIMIT) return fail(new ConnectorError('too-large', 413));
          chunks.push(buffer);
        };
        const end = () => {
          cleanup();
          resolve(Buffer.concat(chunks));
        };
        req.on('data', data);
        req.on('end', end);
        req.on('error', error);
        req.on('aborted', error);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        else if (req.aborted || req.readableEnded) error();
      }),
      signal,
    );
  }
  if (bytes.length > BODY_LIMIT) throw new ConnectorError('too-large', 413);
  if (
    length !== undefined &&
    (req.body === undefined || req.body instanceof Uint8Array || typeof req.body === 'string') &&
    Number(length) !== bytes.length
  )
    invalid();
  try {
    return publication(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    invalid();
  }
}
