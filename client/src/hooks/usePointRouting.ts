import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { EditorSnapshot } from '../domain/editorSnapshot';
import type { PlannedRoute } from '../domain/types';
import { manualRoute } from '../domain/manualRoute';
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
  setNotice,
}: Options) {
  const { activity, waypoints, mode, planningMode, identity, routeMetadata } = snapshot;
  useEffect(() => {
    if (!online && planningMode !== 'manual') {
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
    });
    if (planningMode === 'manual') {
      setBusy(false);
      setResult(route(manualRoute(waypoints, activity), 'manual'));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice(null);
    setResult(null);
    const timer = setTimeout(() => {
      routingProvider
        .calculateRoute(waypoints, activity, controller.signal)
        .then((calculated) => {
          if (!controller.signal.aborted) setResult(route(calculated, 'openrouteservice'));
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
    revision,
    online,
    allowed,
    request,
    setBusy,
    setResult,
    setNotice,
  ]);
}
