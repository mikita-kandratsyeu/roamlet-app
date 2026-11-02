import { AiError } from './ai-contract.mjs';

export const REQUEST_LIMIT = 16 * 1024;
export async function readJson(req, signal) {
  if (signal.aborted) throw signal.reason;
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] ?? ''))
    throw new AiError('invalid-data', 415);
  const length = req.headers?.['content-length'];
  if (
    length !== undefined &&
    (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > REQUEST_LIMIT)
  ) {
    req.resume?.();
    throw new AiError('too-large', 413);
  }
  let raw = req.body;
  if (raw === undefined)
    raw = await new Promise((resolve, reject) => {
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
      const fail = (reason) => {
        cleanup();
        req.resume?.();
        reject(reason);
      };
      const error = () => fail(new AiError('invalid-data', 400));
      const abort = () => fail(signal.reason);
      const data = (chunk) => {
        const buffer = Buffer.from(chunk);
        count += buffer.length;
        if (count > REQUEST_LIMIT) return fail(new AiError('too-large', 413));
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
    });
  try {
    const serialized =
      raw instanceof Uint8Array
        ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
        : typeof raw === 'string'
          ? raw
          : JSON.stringify(raw);
    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > REQUEST_LIMIT) throw new AiError('too-large', 413);
    // Platform-parsed JSON no longer preserves the original wire whitespace or byte count.
    if (
      length !== undefined &&
      (typeof raw === 'string' || raw instanceof Uint8Array) &&
      Number(length) !== size
    )
      throw new AiError('invalid-data', 400);
    return JSON.parse(serialized);
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('invalid-data', 400);
  }
}
