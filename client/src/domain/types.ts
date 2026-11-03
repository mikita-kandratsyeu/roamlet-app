export type Activity = 'cycling' | 'hiking';
export type Coordinate = [number, number] | [number, number, number];
export type LegMode = 'automatic' | 'direct';
export type CyclingProfile = 'cycling-regular' | 'cycling-road' | 'cycling-mountain';
export interface RoutingOptions {
  cyclingProfile?: CyclingProfile;
  avoidFerries?: boolean;
  avoidSteps?: boolean;
}
export interface Waypoint {
  id: string;
  name: string;
  coordinate: Coordinate;
  /** Mode of the outgoing leg; omitted means automatic, the last waypoint is ignored. */
  legMode?: LegMode;
  /** Pause after arrival, in whole minutes (0–10080); omitted means zero. */
  pauseMinutes?: number;
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
  /** Floating local calendar time YYYY-MM-DDTHH:mm, without timezone/DST conversion. */
  departureLocal?: string;
  segments: Coordinate[][];
  waypoints: Waypoint[];
  stats: RouteStats;
  createdAt: string;
  updatedAt: string;
  source: 'openrouteservice' | 'mapbox' | 'gpx' | 'manual' | 'mixed';
  routingOptions?: RoutingOptions;
  /** Origin of known heights, not a guarantee of full-track coverage. */
  elevationSource?: 'openrouteservice';
  routingInputKey?: string;
  directSegments?: Coordinate[][];
}
export interface RoutingResult {
  segments: Coordinate[][];
  stats: RouteStats;
  directSegments?: Coordinate[][];
  /** Mixed routes can retain ORS heights while direct sections remain 2D. */
  elevationSource?: 'openrouteservice';
}
export interface RoutingProvider {
  calculateRoute(
    waypoints: Waypoint[],
    activity: Activity,
    signal?: AbortSignal,
    options?: RoutingOptions,
  ): Promise<RoutingResult>;
  calculatePointAlternatives?(
    waypoints: Waypoint[],
    activity: Activity,
    signal?: AbortSignal,
    options?: RoutingOptions,
  ): Promise<RoutingResult[]>;
  calculateAlternatives(
    start: Waypoint,
    activity: Activity,
    distance: number,
    signal?: AbortSignal,
    options?: RoutingOptions,
  ): Promise<RoutingResult[]>;
}
