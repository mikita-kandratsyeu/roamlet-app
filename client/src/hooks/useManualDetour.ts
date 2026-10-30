import { useState } from 'react';
import { applyManualDetour, detourEndpoints } from '../domain/manualDetour';
import { AUTOMATIC_POINT_LIMIT } from '../domain/waypointLegs';
import type { Coordinate, Waypoint } from '../domain/types';

interface Session {
  base: Waypoint[];
  index: number;
  points: Waypoint[];
  past: Waypoint[][];
  future: Waypoint[][];
}

export function useManualDetour(waypoints: Waypoint[], enabled: boolean) {
  const [session, setSession] = useState<Session | null>(null);
  if (session && (!enabled || session.base !== waypoints)) setSession(null);
  const active = enabled && session?.base === waypoints ? session : null;
  const edit = (update: (points: Waypoint[]) => Waypoint[]) => {
    setSession((current) => {
      if (!enabled || !current || current.base !== waypoints) return null;
      const next = update(current.points);
      if (next === current.points) return current;
      return { ...current, points: next, past: [...current.past, current.points].slice(-50), future: [] };
    });
  };
  const insert = (coordinate: Coordinate, index: number) => {
    edit((points) => {
      if (!active || !Number.isInteger(index) || index < 1 || index >= points.length ||
        waypoints.length + points.length - 2 >= AUTOMATIC_POINT_LIMIT) return points;
      const point: Waypoint = { id: crypto.randomUUID(),
        name: `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`,
        coordinate: [coordinate[0], coordinate[1]], legMode: 'direct' };
      return [...points.slice(0, index), point, ...points.slice(index)];
    });
  };
  return {
    active,
    canAdd: !!active && waypoints.length + active.points.length - 2 < AUTOMATIC_POINT_LIMIT,
    canApply: !!active && active.points.length > 2,
    canUndo: !!active?.past.length,
    canRedo: !!active?.future.length,
    start: (index: number) => {
      if (enabled && waypoints.length < AUTOMATIC_POINT_LIMIT)
        setSession({ base: waypoints, index, points: detourEndpoints(waypoints, index), past: [], future: [] });
    },
    cancel: () => setSession(null),
    apply: () => active ? applyManualDetour(waypoints, active.index, active.points) : null,
    insert,
    add: (coordinate: Coordinate) => { if (active) insert(coordinate, active.points.length - 1); },
    move: (id: string, coordinate: Coordinate) => edit((points) => {
      const target = points.slice(1, -1).find((point) => point.id === id);
      if (!target || (target.coordinate[0] === coordinate[0] && target.coordinate[1] === coordinate[1])) return points;
      return points.map((point) => point.id === id ? { ...point, coordinate: [coordinate[0], coordinate[1]] as Coordinate,
        name: `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}` } : point);
    }),
    remove: (id: string) => edit((points) => points.slice(1, -1).some((point) => point.id === id)
      ? points.filter((point) => point.id !== id) : points),
    undo: () => setSession((current) => !active || !current?.past.length ? current : {
      ...current, points: current.past.at(-1)!, past: current.past.slice(0, -1),
      future: [current.points, ...current.future],
    }),
    redo: () => setSession((current) => !active || !current?.future.length ? current : {
      ...current, points: current.future[0], future: current.future.slice(1),
      past: [...current.past, current.points].slice(-50),
    }),
  };
}
