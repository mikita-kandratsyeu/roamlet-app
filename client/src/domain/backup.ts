import { routeDb } from './storage';
import { validateRoute, validTimestamp, withRouteDefaults } from './routeValidation';
import type { PlannedRoute } from './types';

export const BACKUP_VERSION = 1;
export const BACKUP_LIMITS = {
  bytes: 20 * 1024 * 1024,
  routes: 1000,
  pointsPerRoute: 100000,
  totalPoints: 500000,
} as const;
export type ConflictMode = 'skip' | 'replace' | 'copy';
export interface RouteBackup {
  version: 1;
  exportedAt: string;
  routes: PlannedRoute[];
}
export interface ImportResult {
  imported: number;
  skipped: number;
  copied: number;
  replaced: number;
}

/** Limits include geometry and waypoint coordinates, counting repeated points. */
export function validateBackup(value: unknown): asserts value is RouteBackup {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid library backup.');
  const data = value as Record<string, unknown>;
  if (data.version !== BACKUP_VERSION) throw new Error('Unsupported library backup version.');
  if (!validTimestamp(data.exportedAt) || !Array.isArray(data.routes))
    throw new Error('Invalid library backup.');
  if (data.routes.length > BACKUP_LIMITS.routes)
    throw new Error('Library backup exceeds route limits.');
  let total = 0;
  const ids = new Set<string>();
  for (const route of data.routes) {
    validateRoute(route);
    if (ids.has(route.id)) throw new Error('Duplicate route IDs in library backup.');
    ids.add(route.id);
    const points =
      route.segments.reduce((sum, segment) => sum + segment.length, 0) +
      route.waypoints.length +
      (route.directSegments?.reduce((sum, segment) => sum + segment.length, 0) ?? 0);
    total += points;
    if (points > BACKUP_LIMITS.pointsPerRoute || total > BACKUP_LIMITS.totalPoints)
      throw new Error('Library backup exceeds point limits.');
  }
}

export function parseBackup(text: string): RouteBackup {
  if (new TextEncoder().encode(text).byteLength > BACKUP_LIMITS.bytes)
    throw new Error('Library backup exceeds 20 MiB.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid library backup JSON.');
  }
  validateBackup(data);
  return data;
}

export async function readBackupFile(file: File): Promise<RouteBackup> {
  if (file.size > BACKUP_LIMITS.bytes) throw new Error('Library backup exceeds 20 MiB.');
  const text =
    typeof file.text === 'function'
      ? await file.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Unable to read library backup.'));
          reader.readAsText(file);
        });
  return parseBackup(text);
}

export function exportBackup(routes: PlannedRoute[]): string {
  const backup: RouteBackup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    routes,
  };
  validateBackup(backup);
  const text = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(text).byteLength > BACKUP_LIMITS.bytes)
    throw new Error('Library backup exceeds 20 MiB.');
  return text;
}

/** Conflicts are rechecked in the same transaction as all writes. No editor state is changed. */
export async function importBackup(
  value: unknown,
  mode: ConflictMode = 'copy',
): Promise<ImportResult> {
  validateBackup(value);
  if (!['skip', 'replace', 'copy'].includes(mode))
    throw new Error('Invalid import conflict choice.');
  const backup = parseBackup(JSON.stringify(value));
  return routeDb.transaction('rw', routeDb.routes, async () => {
    const result: ImportResult = { imported: 0, skipped: 0, copied: 0, replaced: 0 };
    for (const original of backup.routes) {
      const route = withRouteDefaults(structuredClone(original));
      const exists = await routeDb.routes.get(route.id);
      if (exists && mode === 'skip') {
        result.skipped++;
        continue;
      }
      if (exists && mode === 'copy') {
        do {
          route.id = crypto.randomUUID();
        } while (await routeDb.routes.get(route.id));
        route.waypoints = route.waypoints.map((waypoint) => ({
          ...waypoint,
          id: crypto.randomUUID(),
        }));
        result.copied++;
      } else if (exists) result.replaced++;
      await routeDb.routes.put(route);
      result.imported++;
    }
    return result;
  });
}
