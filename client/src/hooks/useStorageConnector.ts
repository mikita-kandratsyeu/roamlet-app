import { useCallback, useEffect, useRef, useState } from 'react';
import { exportBackup, importBackup, type ConflictMode, type RouteBackup } from '../domain/backup';
import { decryptBackup, encryptBackup } from '../domain/encryptedBackup';
import { listRoutes } from '../domain/storage';
import { createStorageConnector } from '../services/connectors/registry';
import { ConnectorError, type BackupEntry, type StorageConnection, type StorageConnector } from '../services/connectors/types';

export type ConnectorOperation = 'connecting' | 'listing' | 'uploading' | 'previewing' | 'restoring';
export type ConnectorFailure = 'local' | 'password' | ConnectorError['code'];
export interface BackupPreview {
  backup: RouteBackup;
  conflicts: number;
}

export function useStorageConnector() {
  const connector = useRef<StorageConnector | null>(null);
  const request = useRef<AbortController | null>(null);
  const [connection, setConnection] = useState<{ owner: string; repository: string } | null>(null);
  const [operation, setOperation] = useState<ConnectorOperation | null>(null);
  const operationRef = useRef<ConnectorOperation | null>(null);
  const [error, setError] = useState<ConnectorFailure | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [listed, setListed] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [success, setSuccess] = useState<'uploaded' | 'restored' | null>(null);

  const cancel = useCallback(() => {
    // The local import is an atomic transaction, not an interruptible network request.
    if (operationRef.current === 'restoring') return;
    request.current?.abort();
    request.current = null;
    operationRef.current = null;
    setOperation(null);
    setError(null);
    setSuccess(null);
    setPreview(null);
  }, []);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
    connector.current = null;
  }, []);

  async function run(
    kind: ConnectorOperation,
    task: (signal: AbortSignal, current: () => boolean) => Promise<void>,
    fallback: ConnectorFailure,
  ) {
    if (operationRef.current) return;
    const controller = new AbortController();
    request.current = controller;
    operationRef.current = kind;
    setOperation(kind);
    setError(null);
    setSuccess(null);
    const current = () => request.current === controller && !controller.signal.aborted;
    try {
      await task(controller.signal, current);
    } catch (failure) {
      if (current()) setError(failure instanceof ConnectorError ? failure.code : fallback);
    } finally {
      if (request.current === controller) {
        request.current = null;
        operationRef.current = null;
        setOperation(null);
      }
    }
  }

  async function connect(config: StorageConnection) {
    await run('connecting', async (signal, current) => {
      const next = createStorageConnector(config);
      await next.checkConnection(signal);
      if (!current()) return;
      connector.current = next;
      setConnection({ owner: config.owner.trim(), repository: config.repository.trim() });
      setBackups([]);
      setListed(false);
      setPreview(null);
    }, 'network');
  }

  function disconnect() {
    if (operationRef.current === 'restoring') return;
    cancel();
    connector.current = null;
    setConnection(null);
    setBackups([]);
    setListed(false);
  }

  async function refresh() {
    const storage = connector.current;
    if (!storage) return;
    await run('listing', async (signal, current) => {
      const entries = await storage.listBackups(signal);
      if (current()) {
        setBackups(entries);
        setListed(true);
      }
    }, 'network');
  }

  async function upload(password: string) {
    const storage = connector.current;
    if (!storage) return;
    await run('uploading', async (signal, current) => {
      if (password.length < 12) { setError('password'); return; }
      let invalid = 0;
      const routes = await listRoutes((count) => { invalid = count; });
      if (!current()) return;
      if (invalid) throw new Error('Invalid local routes');
      const payload = await encryptBackup(exportBackup(routes), password);
      if (!current()) return;
      const entry = await storage.uploadBackup(payload, signal);
      if (current()) {
        setBackups((entries) => [entry, ...entries.filter((item) => item.id !== entry.id)]);
        setSuccess('uploaded');
      }
    }, 'local');
  }

  async function prepareRestore(entry: BackupEntry, password: string) {
    const storage = connector.current;
    if (!storage) return;
    setPreview(null);
    await run('previewing', async (signal, current) => {
      const payload = await storage.downloadBackup(entry, signal);
      if (!current()) return;
      let backup: RouteBackup;
      try { backup = await decryptBackup(payload, password); }
      catch { if (current()) setError('password'); return; }
      if (!current()) return;
      const routes = await listRoutes();
      if (current()) setPreview({ backup, conflicts: backup.routes.filter((route) => routes.some((local) => local.id === route.id)).length });
    }, 'local');
  }

  async function restore(mode: ConflictMode) {
    const value = preview;
    if (!value) return;
    await run('restoring', async (_signal, current) => {
      await importBackup(value.backup, mode);
      if (current()) {
        setPreview(null);
        setSuccess('restored');
      }
    }, 'local');
  }

  return { connection, operation, error, backups, listed, preview, success, connect, disconnect, refresh, upload, prepareRestore, restore, cancel, dismissPreview: () => setPreview(null) };
}
