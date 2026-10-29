import { useMemo, useReducer, useRef } from 'react';
import type { SetStateAction } from 'react';
import { initialEditor, type EditorSnapshot } from '../domain/editorSnapshot';

export interface EditorHistory {
  present: EditorSnapshot;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
}
type Action =
  | { type: 'patch'; key: keyof EditorSnapshot; value: unknown }
  | { type: 'checkpoint' }
  | { type: 'undo' | 'redo' }
  | { type: 'reset'; snapshot: EditorSnapshot };
export function editorReducer(state: EditorHistory, action: Action): EditorHistory {
  if (action.type === 'patch') {
    const previous = state.present[action.key];
    const value = typeof action.value === 'function' ? action.value(previous) : action.value;
    return { ...state, present: { ...state.present, [action.key]: value } };
  }
  if (action.type === 'checkpoint')
    return {
      ...state,
      past: [...state.past, structuredClone(state.present)].slice(-50),
      future: [],
    };
  if (action.type === 'reset')
    return { present: structuredClone(action.snapshot), past: [], future: [] };
  if (action.type === 'undo' && state.past.length)
    return {
      present: state.past.at(-1)!,
      past: state.past.slice(0, -1),
      future: [structuredClone(state.present), ...state.future].slice(0, 50),
    };
  if (action.type === 'redo' && state.future.length)
    return {
      present: state.future[0],
      past: [...state.past, structuredClone(state.present)].slice(-50),
      future: state.future.slice(1),
    };
  return state;
}
export function useRouteEditor(initial: EditorSnapshot = initialEditor()) {
  const [history, dispatch] = useReducer(editorReducer, { present: initial, past: [], future: [] });
  const routingAllowed = useRef(false);
  const setters = useMemo(() => {
    function setter<K extends keyof EditorSnapshot>(key: K) {
      return (value: SetStateAction<EditorSnapshot[K]>) => dispatch({ type: 'patch', key, value });
    }
    return {
      setActivity: setter('activity'),
      setWaypoints: setter('waypoints'),
      setResult: setter('result'),
      setMode: setter('mode'),
      setPlanningMode: setter('planningMode'),
      setAutomaticMode: setter('automaticMode'),
      setTargetKm: setter('targetKm'),
      setName: setter('name'),
      setDescription: setter('description'),
      setSpeeds: setter('speeds'),
      setStopsMinutes: setter('stopsMinutes'),
      setSavedRouteId: setter('savedRouteId'),
      setIdentity: setter('identity'),
    };
  }, []);
  return {
    ...history.present,
    ...setters,
    snapshot: history.present,
    routingAllowed,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    checkpoint: () => dispatch({ type: 'checkpoint' }),
    undo: () => {
      routingAllowed.current = false;
      dispatch({ type: 'undo' });
    },
    redo: () => {
      routingAllowed.current = false;
      dispatch({ type: 'redo' });
    },
    reset: (snapshot: EditorSnapshot) => {
      routingAllowed.current = false;
      dispatch({ type: 'reset', snapshot });
    },
  };
}
