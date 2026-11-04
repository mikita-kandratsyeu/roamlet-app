import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { EditorSnapshot } from '../domain/editorSnapshot';
import type { PlannedRoute } from '../domain/types';
import { manualRoute } from '../domain/manualRoute';
import {
  routingCalculationKey,
  routingInputKey,
  isRouteResultCurrent,
} from '../domain/editorRouting';
import { automaticPointCount } from '../domain/waypointLegs';
import { normalizeRoutingOptions } from '../domain/routingOptions';
import { routingProvider } from '../services/routing';
import i18n from '../i18n';
import type { RoutingNotification } from './useRoutingToast';
interface Options {
  snapshot: EditorSnapshot;
  revision: number;
  online: boolean;
  allowed: MutableRefObject<boolean>;
  request: MutableRefObject<AbortController | null>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<PlannedRoute | null>>;
  setRouteStale?: (stale: boolean) => void;
  onStart?: (controller: AbortController) => RoutingNotification;
  setNotice: Dispatch<
    SetStateAction<{ text: string; error: boolean; kind?: 'routing' | 'map' } | null>
  >;
}
export function usePointRouting({
  snapshot,
  revision,
  online,
  allowed,
  request,
  setBusy,
  setResult,
  setRouteStale,
  setNotice,
  onStart,
}: Options) {
  const latest = useRef(snapshot);
  const calculationKey = routingCalculationKey(snapshot);
  const identityKey = JSON.stringify([
    snapshot.identity,
    snapshot.waypoints.map((point) => point.id),
  ]);
  const mode = snapshot.mode;
  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    if (snapshot.result && !snapshot.routeStale && !isRouteResultCurrent(snapshot))
      setRouteStale?.(true);
    if (
      snapshot.mode !== 'manual' ||
      snapshot.planningMode === 'loop' ||
      !isRouteResultCurrent(snapshot)
    )
      return;
    const points = snapshot.waypoints;
    if (
      !snapshot.result?.waypoints.some(
        (point, index) =>
          points[index] && (points[index].name !== point.name || points[index].id !== point.id),
      )
    )
      return;
    setResult((current) => {
      if (!current || current !== snapshot.result) return current;
      const waypoints = current.waypoints.map((point, index) => {
        const edited = points[index];
        return edited && (edited.name !== point.name || edited.id !== point.id)
          ? { ...point, name: edited.name, id: edited.id }
          : point;
      });
      return waypoints.some((point, index) => point !== current.waypoints[index])
        ? { ...current, waypoints }
        : current;
    });
  }, [snapshot, setRouteStale, setResult]);
  useEffect(() => {
    const { activity, waypoints, planningMode, routingOptions } = latest.current;
    const inputKey = routingInputKey(latest.current);
    const hasAutomaticLegs =
      planningMode === 'loop' || (planningMode === 'point' && automaticPointCount(waypoints) > 0);
    if (!online && hasAutomaticLegs) {
      allowed.current = false;
      request.current?.abort();
      setBusy(false);
      return;
    }
    if (!allowed.current || mode !== 'manual' || planningMode === 'loop' || waypoints.length < 2)
      return;
    const route = (
      calculated: ReturnType<typeof manualRoute>,
      source: PlannedRoute['source'],
    ): PlannedRoute => ({
      ...latest.current.identity,
      ...latest.current.routeMetadata,
      name: latest.current.name || i18n.t('Untitled adventure'),
      description: '',
      activity,
      waypoints: latest.current.waypoints,
      ...calculated,
      updatedAt: new Date().toISOString(),
      source,
      routingOptions: normalizeRoutingOptions(routingOptions),
      routingInputKey: inputKey,
    });
    if (!hasAutomaticLegs) {
      try {
        setBusy(false);
        const calculated = manualRoute(waypoints, activity);
        if (planningMode === 'point') calculated.directSegments = calculated.segments;
        setResult(route(calculated, 'manual'));
        setRouteStale?.(false);
      } catch (error) {
        setRouteStale?.(true);
        setNotice({
          text: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
          error: true,
          kind: 'routing',
        });
      }
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice(null);
    setRouteStale?.(true);
    const notification = onStart?.(controller);
    const timer = setTimeout(() => {
      routingProvider
        .calculateRoute(waypoints, activity, controller.signal, routingOptions)
        .then((calculated) => {
          if (!controller.signal.aborted) {
            setResult(
              route(calculated, calculated.directSegments?.length ? 'mixed' : 'openrouteservice'),
            );
            setRouteStale?.(false);
            notification?.success();
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            const text =
              error instanceof Error ? error.message : 'Something went wrong. Please try again.';
            setNotice({ text, error: true, kind: 'routing' });
            notification?.error(text);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    calculationKey,
    identityKey,
    mode,
    revision,
    online,
    allowed,
    request,
    setBusy,
    setResult,
    setRouteStale,
    setNotice,
    onStart,
  ]);
}
