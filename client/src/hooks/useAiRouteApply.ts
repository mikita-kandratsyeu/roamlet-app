import { useEffect, useRef, useState } from 'react';
import type { EditorSnapshot } from '../domain/editorSnapshot';
import type { AiProposal } from '../domain/ai';
import type { PlannedRoute, RoutingOptions } from '../domain/types';
import { validAiProposal } from '../domain/ai';
import { normalizeRoutingOptions } from '../domain/routingOptions';
import { routingInputKey } from '../domain/editorRouting';
import { automaticPointCount } from '../domain/waypointLegs';
import { routingProvider } from '../services/routing';
export function useAiRouteApply(snapshot: EditorSnapshot, commit: (route: PlannedRoute, options: Required<RoutingOptions>) => void) {
  const [applying, setApplying] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const currentSnapshot = useRef(snapshot);
  useEffect(() => {
    currentSnapshot.current = snapshot;
    controller.current?.abort();
    setApplying(false);
    return () => controller.current?.abort();
  }, [snapshot]);
  function cancel() { controller.current?.abort(); setApplying(false); }
  async function apply(proposal: AiProposal): Promise<boolean> {
    if (!validAiProposal(proposal, snapshot.activity) || snapshot.mode !== 'manual' ||
      snapshot.planningMode !== 'point' || snapshot.waypoints.length < 2 ||
      automaticPointCount(snapshot.waypoints) === 0 || navigator.onLine === false) return false;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setApplying(true);
    try {
      const options = normalizeRoutingOptions({ ...snapshot.routingOptions, ...proposal.routingOptions });
      const calculated = await routingProvider.calculateRoute(snapshot.waypoints, snapshot.activity, abort.signal, options);
      if (abort.signal.aborted || currentSnapshot.current !== snapshot) return false;
      const route: PlannedRoute = {
        ...snapshot.identity, ...snapshot.routeMetadata, ...calculated,
        name: snapshot.name, description: snapshot.description, activity: snapshot.activity,
        departureLocal: snapshot.departureLocal, waypoints: snapshot.waypoints,
        createdAt: snapshot.identity.createdAt, updatedAt: new Date().toISOString(),
        source: calculated.directSegments?.length ? 'mixed' : 'openrouteservice',
        routingOptions: options, routingInputKey: routingInputKey({ ...snapshot, routingOptions: options }),
      };
      commit(route, options);
      return true;
    } catch (error) { if (!abort.signal.aborted) throw error; return false; }
    finally { if (controller.current === abort) setApplying(false); }
  }
  return { applying, apply, cancel };
}
