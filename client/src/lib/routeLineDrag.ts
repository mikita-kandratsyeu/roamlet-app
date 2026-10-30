import type { Map as RouteMap } from 'maplibre-gl';
import type { Coordinate, Waypoint } from '../domain/types';
import { routeInsertion } from '../domain/routeInsertion';

interface DragRoute {
  editable: boolean;
  comparisonMode?: boolean;
  routeStale?: boolean;
  segments: Coordinate[][];
  waypoints: Waypoint[];
  onInsert?: (coordinate: Coordinate, index: number) => void;
}

export function installRouteLineDrag(
  map: RouteMap,
  current: () => DragRoute,
  preview: (coordinates: Coordinate[] | null) => void,
  suppressClick: (until: number) => void,
) {
  const canvas = map.getCanvas();
  let drag: {
    pointerId: number;
    x: number;
    y: number;
    index: number;
    coordinate: Coordinate;
    route: DragRoute;
    moved: boolean;
    panEnabled: boolean;
  } | null = null;
  const valid = () => {
    const route = current();
    return drag && route.editable && !route.comparisonMode && !route.routeStale &&
      route.onInsert && route.segments === drag.route.segments &&
      route.waypoints === drag.route.waypoints;
  };
  const cancel = () => {
    if (!drag) return;
    const { panEnabled } = drag;
    drag = null;
    if (panEnabled) map.dragPan.enable();
    canvas.style.cursor = '';
    preview(null);
    suppressClick(Date.now() + 250);
  };
  const point = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const down = (event: PointerEvent) => {
    if (drag) {
      if (event.pointerId !== drag.pointerId) cancel();
      return;
    }
    const route = current();
    if (!route.editable || route.comparisonMode || route.routeStale || !route.onInsert ||
      event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
      (event.target instanceof Element && event.target.closest('.waypoint-marker'))) return;
    const position = point(event);
    if (!map.getLayer('route-hit') ||
      !map.queryRenderedFeatures([position.x, position.y], { layers: ['route-hit'] }).length) return;
    const location = map.unproject([position.x, position.y]);
    const insertion = routeInsertion([location.lng, location.lat], route.segments, route.waypoints);
    if (!insertion) return;
    drag = { pointerId: event.pointerId, x: position.x, y: position.y,
      index: insertion.index, coordinate: insertion.coordinate, route, moved: false,
      panEnabled: map.dragPan.isEnabled() };
    map.dragPan.disable();
    suppressClick(Infinity);
    canvas.style.cursor = 'grabbing';
    event.preventDefault();
    event.stopPropagation();
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!valid()) { cancel(); return; }
    const position = point(event);
    if (!drag.moved && Math.hypot(position.x - drag.x, position.y - drag.y) < 5) return;
    drag.moved = true;
    const location = map.unproject([position.x, position.y]);
    drag.coordinate = [location.lng, location.lat];
    // This is a geometric preview, not a routed or access-verified path.
    preview([drag.route.waypoints[drag.index - 1].coordinate, drag.coordinate,
      drag.route.waypoints[drag.index].coordinate]);
    event.preventDefault();
    event.stopPropagation();
  };
  const up = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    if (!valid() || event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) { cancel(); return; }
    move(event);
    const finished = drag;
    cancel();
    if (finished) current().onInsert?.(finished.coordinate, finished.index);
    event.preventDefault();
    event.stopPropagation();
  };
  const pointerCancel = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) cancel();
  };
  const keydown = (event: KeyboardEvent) => {
    if (drag && event.key === 'Escape') {
      cancel();
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const blockMapGesture = (event: Event) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
  };
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('mousedown', blockMapGesture, true);
  canvas.addEventListener('touchstart', blockMapGesture, { capture: true, passive: false });
  window.addEventListener('pointermove', move, { capture: true, passive: false });
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', pointerCancel, true);
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('blur', cancel);
  return {
    cancel,
    isActive: () => drag !== null,
    destroy: () => {
      cancel();
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('mousedown', blockMapGesture, true);
      canvas.removeEventListener('touchstart', blockMapGesture, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('blur', cancel);
    },
  };
}
