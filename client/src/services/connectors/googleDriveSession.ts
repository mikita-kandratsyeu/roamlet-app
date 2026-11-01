import { connectorJson } from './http';
import { ConnectorError } from './types';
export interface GoogleDriveSession {
  available: boolean;
  connected: boolean;
  email?: string;
  accountId?: string;
}
export async function getGoogleDriveSession(signal?: AbortSignal): Promise<GoogleDriveSession> {
  const data = await connectorJson('google-drive', 'session', {}, signal);
  if (
    typeof data.available !== 'boolean' ||
    typeof data.connected !== 'boolean' ||
    (data.email !== undefined &&
      (typeof data.email !== 'string' ||
        data.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+$/.test(data.email))) ||
    (data.accountId !== undefined &&
      (typeof data.accountId !== 'string' || data.accountId.length > 200 || !data.accountId))
  )
    throw new ConnectorError('invalid-data');
  if (data.connected && (typeof data.accountId !== 'string' || typeof data.email !== 'string'))
    throw new ConnectorError('invalid-data');
  return {
    available: data.available,
    connected: data.connected,
    email: typeof data.email === 'string' ? data.email : undefined,
    accountId: typeof data.accountId === 'string' ? data.accountId : undefined,
  };
}
export async function logoutGoogleDrive(signal?: AbortSignal): Promise<void> {
  await connectorJson('google-drive', 'logout', {}, signal, null);
}
