export type Activity = 'cycling' | 'hiking';
export type Coordinate = [number, number] | [number, number, number];
export interface Waypoint {
  id: string;
  name: string;
  coordinate: Coordinate;
}
export interface RouteStats {
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
}
export interface PlannedRoute {
  id: string;
  name: string;
  description: string;
  favorite?: boolean;
  tags?: string[];
  activity: Activity;
  segments: Coordinate[][];
  waypoints: Waypoint[];
  stats: RouteStats;
  createdAt: string;
  updatedAt: string;
  source: 'openrouteservice' | 'mapbox' | 'gpx' | 'manual';
}
export interface RoutingResult {
  segments: Coordinate[][];
  stats: RouteStats;
}
export interface RoutingProvider {
  calculateRoute(
    waypoints: Waypoint[],
    activity: Activity,
    signal?: AbortSignal,
  ): Promise<RoutingResult>;
  calculateAlternatives(
    start: Waypoint,
    activity: Activity,
    distance: number,
    signal?: AbortSignal,
  ): Promise<RoutingResult[]>;
}
