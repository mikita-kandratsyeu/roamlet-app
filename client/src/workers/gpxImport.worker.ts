import { ensureGpxWorkerEnvironment } from './gpxImport.environment';
import type { GpxImportRequest, GpxImportResponse } from './gpxImport.protocol';

export async function runGpxImport(request: GpxImportRequest): Promise<GpxImportResponse> {
  try {
    if (request.file.size > 10 * 1024 * 1024) {
      throw new Error('GPX file exceeds the 10 MiB limit.');
    }
    const text = await request.file.text();
    ensureGpxWorkerEnvironment();
    const [{ importGpx }, { default: i18n }] = await Promise.all([
      import('../domain/gpx'),
      import('../i18n'),
    ]);
    await i18n.changeLanguage(request.language);
    return { status: 'success', route: importGpx(text) };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
    };
  }
}

if (typeof document === 'undefined' && typeof self !== 'undefined') {
  self.addEventListener('message', (event: MessageEvent<GpxImportRequest>) => {
    void runGpxImport(event.data).then((response) => {
      try {
        self.postMessage(response);
      } catch {
        self.postMessage({ status: 'error', message: 'Something went wrong. Please try again.' });
      }
    });
  });
}
