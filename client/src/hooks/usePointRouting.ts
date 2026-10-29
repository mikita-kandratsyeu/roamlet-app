import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { EditorSnapshot } from '../domain/editorSnapshot';
import type { PlannedRoute } from '../domain/types';
import { manualRoute } from '../domain/manualRoute';
import { routingInputKey, isRouteResultCurrent } from '../domain/editorRouting';
import { automaticPointCount } from '../domain/waypointLegs';
import { normalizeRoutingOptions } from '../domain/routingOptions';
import { routingProvider } from '../services/routing';
import i18n from '../i18n';
interface Options {
  snapshot: EditorSnapshot;
  revision: number;
  online: boolean;
  allowed: MutableRefObject<boolean>;
  request: MutableRefObject<AbortController | null>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<PlannedRoute | null>>;
  setRouteStale?: (stale: boolean) => void;
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
}: Options) {
  const { activity, waypoints, mode, planningMode, identity, routeMetadata, routingOptions } =
    snapshot;
  const inputKey = routingInputKey(snapshot);
  useEffect(() => {
    if (snapshot.result && !snapshot.routeStale && !isRouteResultCurrent(snapshot))
      setRouteStale?.(true);
  }, [snapshot, setRouteStale]);
  useEffect(() => {
    const hasAutomaticLegs =
      planningMode === 'loop' || (planningMode === 'point' && automaticPointCount(waypoints) > 0);
    if (!online && hasAutomaticLegs) {
      if (allowed.current && mode === 'manual' && waypoints.length >= 2) setRouteStale?.(true);
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
      ...identity,
      ...routeMetadata,
      name: i18n.t('Untitled adventure'),
      description: '',
      activity,
      waypoints,
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
    const timer = setTimeout(() => {
      routingProvider
        .calculateRoute(waypoints, activity, controller.signal, routingOptions)
        .then((calculated) => {
          if (!controller.signal.aborted) {
            setResult(
              route(calculated, calculated.directSegments?.length ? 'mixed' : 'openrouteservice'),
            );
            setRouteStale?.(false);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setNotice({
              text:
                error instanceof Error ? error.message : 'Something went wrong. Please try again.',
              error: true,
              kind: 'routing',
            });
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
    activity,
    waypoints,
    mode,
    planningMode,
    identity,
    routeMetadata,
    routingOptions,
    inputKey,
    revision,
    online,
    allowed,
    request,
    setBusy,
    setResult,
    setRouteStale,
    setNotice,
  ]);
}
