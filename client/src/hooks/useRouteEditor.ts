import { useMemo, useReducer, useRef } from 'react';
import type { SetStateAction } from 'react';
import { initialEditor, migrateSnapshot, withEditorSchedule, type EditorSnapshot } from '../domain/editorSnapshot';
import { normalizeRoutingOptions } from '../domain/routingOptions';
import { validDepartureLocal, validPauseMinutes } from '../domain/schedule';
import type { Waypoint } from '../domain/types';

export interface EditorHistory {
  present: EditorSnapshot;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
  pastTiming?: boolean[];
  futureTiming?: boolean[];
}
function timingFlags(entries: EditorSnapshot[], flags?: boolean[]): boolean[] {
  return flags ?? entries.map(() => false);
}
function restoreTiming(present: EditorSnapshot, target: EditorSnapshot): EditorSnapshot {
  const points = new Map(target.waypoints.map((point) => [point.id, point]));
  const resultPoints = new Map(target.result?.waypoints.map((point) => [point.id, point]));
  const resultChanged = present.result?.waypoints.some((point) =>
    resultPoints.has(point.id) && resultPoints.get(point.id)!.pauseMinutes !== point.pauseMinutes);
  const result = resultChanged && present.result
    ? withEditorSchedule(present.result, {
      departureLocal: present.result.departureLocal, waypoints: target.result?.waypoints ?? [],
    }) : present.result;
  return { ...present, result, departureLocal: target.departureLocal,
    waypoints: present.waypoints.map((point) => {
      const saved = points.get(point.id);
      if (!saved || (saved.pauseMinutes === point.pauseMinutes && saved.name === point.name)) return point;
      const { pauseMinutes: _pause, ...rest } = point;
      void _pause;
      return { ...rest, name: saved.name, ...(saved.pauseMinutes === undefined ? {} : { pauseMinutes: saved.pauseMinutes }) };
    }),
  };
}
type Action =
  | { type: 'patch'; key: keyof EditorSnapshot; value: unknown }
  | { type: 'departure'; value: string | undefined }
  | { type: 'pause'; id: string; value: number | undefined }
  | { type: 'checkpoint'; localOnly?: boolean }
  | { type: 'undo' | 'redo' }
  | { type: 'reset'; snapshot: EditorSnapshot };
export function editorReducer(state: EditorHistory, action: Action): EditorHistory {
  if (action.type === 'departure' || action.type === 'pause') {
    let present: EditorSnapshot;
    if (action.type === 'departure') {
      if (action.value !== undefined && !validDepartureLocal(action.value))
        throw new Error('Invalid local departure.');
      if (state.present.departureLocal === action.value) return state;
      present = { ...state.present, departureLocal: action.value };
    } else {
      if (action.value !== undefined && !validPauseMinutes(action.value))
        throw new Error('Invalid waypoint pause.');
      const editorPoint = state.present.waypoints.find((point) => point.id === action.id);
      const point = editorPoint ?? state.present.result?.waypoints.find((point) => point.id === action.id);
      if (!point || point.pauseMinutes === action.value) return state;
      const update = (point: Waypoint) => {
        if (point.id !== action.id) return point;
        const { pauseMinutes: _pause, ...rest } = point;
        void _pause;
        return { ...rest, ...(action.value === undefined ? {} : { pauseMinutes: action.value }) };
      };
      present = editorPoint
        ? { ...state.present, waypoints: state.present.waypoints.map(update) }
        : { ...state.present, result: { ...state.present.result!,
          waypoints: state.present.result!.waypoints.map(update) } };
    }
    return { present, past: [...state.past, state.present].slice(-50), future: [],
      pastTiming: [...timingFlags(state.past, state.pastTiming), true].slice(-50), futureTiming: [] };
  }
  if (action.type === 'patch') {
    const previous = state.present[action.key];
    const value = typeof action.value === 'function' ? action.value(previous) : action.value;
    return { ...state, present: { ...state.present, [action.key]: value } };
  }
  if (action.type === 'checkpoint')
    return {
      ...state,
      past: [...state.past, state.present].slice(-50),
      future: [],
      pastTiming: [...timingFlags(state.past, state.pastTiming), action.localOnly ?? false].slice(-50),
      futureTiming: [],
    };
  if (action.type === 'reset')
    return { present: structuredClone(migrateSnapshot(action.snapshot)), past: [], future: [] };
  if (action.type === 'undo' && state.past.length)
    return {
      present: state.pastTiming?.at(-1)
        ? restoreTiming(state.present, state.past.at(-1)!) : state.past.at(-1)!,
      past: state.past.slice(0, -1),
      future: [state.present, ...state.future].slice(0, 50),
      pastTiming: timingFlags(state.past, state.pastTiming).slice(0, -1),
      futureTiming: [state.pastTiming?.at(-1) ?? false,
        ...timingFlags(state.future, state.futureTiming)].slice(0, 50),
    };
  if (action.type === 'redo' && state.future.length)
    return {
      present: state.futureTiming?.[0]
        ? restoreTiming(state.present, state.future[0]) : state.future[0],
      past: [...state.past, state.present].slice(-50),
      future: state.future.slice(1),
      pastTiming: [...timingFlags(state.past, state.pastTiming),
        state.futureTiming?.[0] ?? false].slice(-50),
      futureTiming: timingFlags(state.future, state.futureTiming).slice(1),
    };
  return state;
}
export function useRouteEditor(initial: EditorSnapshot = initialEditor()) {
  const [history, dispatch] = useReducer(editorReducer, { present: initial, past: [], future: [] });
  const routingAllowed = useRef(false);
  const routingOptions = useMemo(
    () => normalizeRoutingOptions(history.present.routingOptions),
    [history.present.routingOptions],
  );
  // Timing remains editor-local and is overlaid onto router results when rendering or saving.
  const routingWaypointsKey = JSON.stringify(history.present.waypoints.map((point) => {
    const { pauseMinutes: _pause, ...rest } = point;
    void _pause;
    return rest;
  }));
  const routingWaypoints = useMemo<Waypoint[]>(
    () => JSON.parse(routingWaypointsKey) as Waypoint[], [routingWaypointsKey],
  );
  const routingSnapshot = useMemo(
    () => ({ ...history.present, waypoints: routingWaypoints }),
    [history.present, routingWaypoints],
  );
  const setters = useMemo(() => {
    function setter<K extends keyof EditorSnapshot>(key: K) {
      return (value: SetStateAction<EditorSnapshot[K]>) => dispatch({ type: 'patch', key, value });
    }
    return {
      setActivity: setter('activity'),
      setWaypoints: setter('waypoints'),
      setResult: setter('result'),
      setRoutingOptions: setter('routingOptions'),
      setRouteStale: setter('routeStale'),
      setMode: setter('mode'),
      setPlanningMode: setter('planningMode'),
      setAutomaticMode: setter('automaticMode'),
      setTargetKm: setter('targetKm'),
      setName: setter('name'),
      setDescription: setter('description'),
      setSpeeds: setter('speeds'),
      setStopsMinutes: setter('stopsMinutes'),
      setDepartureLocal: (value: string | undefined) => dispatch({ type: 'departure', value }),
      setWaypointPause: (id: string, value: number | undefined) => dispatch({ type: 'pause', id, value }),
      setFitness: setter('fitness'),
      setSurface: setter('surface'),
      setSavedRouteId: setter('savedRouteId'),
      setIdentity: setter('identity'),
    };
  }, []);
  const { result, planningMode, waypoints } = history.present;
  const scheduleWaypoints = useMemo(() => result && planningMode === 'loop'
    ? withEditorSchedule(result, { waypoints }).waypoints : waypoints,
    [result, planningMode, waypoints]);
  return {
    ...history.present,
    ...setters,
    routingOptions,
    routeStale: history.present.routeStale ?? false,
    snapshot: history.present,
    scheduleWaypoints,
    routingSnapshot,
    routingAllowed,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undoChangesGeometry: history.pastTiming?.at(-1) !== true,
    redoChangesGeometry: history.futureTiming?.[0] !== true,
    checkpoint: (localOnly = false) => dispatch({ type: 'checkpoint', localOnly }),
    undo: () => {
      if (history.pastTiming?.at(-1) !== true) routingAllowed.current = false;
      dispatch({ type: 'undo' });
    },
    redo: () => {
      if (history.futureTiming?.[0] !== true) routingAllowed.current = false;
      dispatch({ type: 'redo' });
    },
    reset: (snapshot: EditorSnapshot) => {
      routingAllowed.current = false;
      dispatch({ type: 'reset', snapshot });
    },
  };
}
