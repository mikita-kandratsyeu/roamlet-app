import type { RouteCardRequest } from '../domain/routeCard';

export type { RouteCardRequest };
export type RouteCardResponse =
  | { status: 'success'; blob: Blob }
  | { status: 'error'; message: string }
  | { status: 'unsupported' };
