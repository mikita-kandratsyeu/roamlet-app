import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorSnapshot } from '../domain/editorSnapshot';
import { importGpxFile } from '../services/gpxImport';

export function useGpxImport(snapshot: EditorSnapshot) {
  const request = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  const cancelImport = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setImporting(false);
  }, []);
  useEffect(() => {
    cancelImport();
  }, [snapshot, cancelImport]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  const importFile = useCallback(async (file: File) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setImporting(true);
    try {
      const route = await importGpxFile(file, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return null;
      // Keep the signal alive through the unsaved-changes confirmation.
      return { route, signal: controller.signal };
    } catch (error) {
      if (controller.signal.aborted || request.current !== controller) return null;
      throw error;
    } finally {
      if (request.current === controller) setImporting(false);
    }
  }, []);
  return { importFile, importing, cancelImport };
}
