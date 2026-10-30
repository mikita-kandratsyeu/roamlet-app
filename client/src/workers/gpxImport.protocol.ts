import type { PlannedRoute } from '../domain/types';

export interface GpxImportRequest {
  file: File;
  language: 'en' | 'ru';
}

export type GpxImportResponse =
  { status: 'success'; route: PlannedRoute } | { status: 'error'; message: string };
