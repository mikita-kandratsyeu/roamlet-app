import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, HardDrive, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import type { usePwa } from '../hooks/usePwa';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
import './PwaDialog.css';

export function PwaDialog({
  pwa,
  online,
  onClose,
  onLibrary,
}: {
  pwa: ReturnType<typeof usePwa>;
  online: boolean;
  onClose: () => void;
  onLibrary: () => void;
}) {
  const { t } = useTranslation();
  const offlineText = {
    checking: t('Checking offline readiness…'),
    ready: t('Ready to work offline'),
    error: t('Offline preparation could not be verified'),
    unsupported: t('Offline installation is unavailable in this browser'),
    development: t('Offline readiness is available in the production app'),
  }[pwa.offlineStatus];
  const storageText = {
    checking: t('Checking device storage…'),
    persistent: t('Persistent storage granted'),
    'best-effort': t('Storage managed by the browser'),
    unsupported: t('Storage protection is unavailable in this browser'),
    error: t('Storage protection status unavailable'),
  }[pwa.storageStatus];
  const canRequestStorage =
    !pwa.storageDeclined && (pwa.storageStatus === 'best-effort' || pwa.storageStatus === 'error');
  return (
    <Dialog
      title={t('App on this device')}
      description={t('Installation, offline availability and local data.')}
      onClose={onClose}
      footer={
        <Button variant="outline" className="pwa-library-action" onClick={onLibrary}>
          <HardDrive size={16} aria-hidden="true" />
          {t('Open My routes')}
        </Button>
      }
    >
      <div className="pwa-content">
        <section className="pwa-section" aria-label={t('Offline availability')}>
          <h3>
            <WifiOff size={18} aria-hidden="true" />
            {t('Offline availability')}
          </h3>
          <p className="pwa-status" role="status">
            {pwa.offlineStatus === 'checking' ? (
              <LoaderCircle size={18} className="pwa-spinner" aria-hidden="true" />
            ) : pwa.offlineStatus === 'ready' ? (
              <CheckCircle2 size={18} aria-hidden="true" />
            ) : null}
            <strong>{offlineText}</strong>
          </p>
          {pwa.offlineStatus === 'error' && (
            <>
              <p>
                {t(
                  'Keep the app open online and retry. Until preparation is confirmed, reopening offline may not work.',
                )}
              </p>
              <Button variant="outline" disabled={!online} onClick={() => void pwa.retryOffline()}>
                <RefreshCw size={16} aria-hidden="true" />
                {t('Retry offline preparation')}
              </Button>
              {!online && (
                <p className="fine-print">{t('Reconnect to prepare the app for offline use.')}</p>
              )}
            </>
          )}
          <div className="pwa-capabilities">
            <div>
              <h4>{t('Available offline')}</h4>
              <p>
                {t(
                  'Saved routes and their statistics, GPX import and export, JSON library backups and manual drawing by coordinates.',
                )}
              </p>
            </div>
            <div>
              <h4>{t('Internet required')}</h4>
              <p>
                {t(
                  'Map loading, automatic routes, round trips and cloud connections. No offline map regions or turn-by-turn navigation are included.',
                )}
              </p>
            </div>
          </div>
          {pwa.updateAvailable && (
            <p className="pwa-update" role="status">
              {t(
                'An update is ready. It will apply on the next app launch or reload, not while you are editing.',
              )}
            </p>
          )}
        </section>
        <section className="pwa-section" aria-label={t('Install Roamlet')}>
          <h3>
            <Download size={18} aria-hidden="true" />
            {t('Install Roamlet')}
          </h3>
          {pwa.installed ? (
            <p role="status">{t('Roamlet is open as an installed app.')}</p>
          ) : (
            <>
              <p>
                {t(
                  'Open Roamlet from your home screen or dock. Installation does not add offline maps or a backup of your routes.',
                )}
              </p>
              {pwa.installAvailable && (
                <Button disabled={pwa.installPending} onClick={() => void pwa.install()}>
                  {pwa.installPending && (
                    <LoaderCircle className="pwa-spinner" size={16} aria-hidden="true" />
                  )}
                  {t('Install app')}
                </Button>
              )}
              <details className="pwa-install-guide">
                <summary>{t('Installation instructions')}</summary>
                <ul>
                  <li>
                    {t(
                      'iPhone / iPad: open in Safari, then Share → Add to Home Screen. Enable Open as Web App if offered.',
                    )}
                  </li>
                  <li>
                    {t(
                      'Android / Chrome / Edge: use the browser menu → Install app or Add to Home Screen, when available.',
                    )}
                  </li>
                  <li>{t('Mac / Safari: use File → Add to Dock, when available.')}</li>
                </ul>
                <p className="fine-print">
                  {t(
                    'Installation options depend on the browser and OS. Open the HTTPS site in a regular browser, not a private or in-app window.',
                  )}
                </p>
              </details>
            </>
          )}
        </section>
        <section className="pwa-section" aria-label={t('Local data protection')}>
          <h3>
            <HardDrive size={18} aria-hidden="true" />
            {t('Local data protection')}
          </h3>
          <p className="pwa-status" data-state={pwa.storageStatus} role="status">
            {pwa.storageStatus === 'checking' ? (
              <LoaderCircle size={18} className="pwa-spinner" aria-hidden="true" />
            ) : pwa.storageStatus === 'persistent' ? (
              <CheckCircle2 size={18} aria-hidden="true" />
            ) : null}
            <strong>
              {pwa.storageDeclined ? t('Storage protection not granted') : storageText}
            </strong>
          </p>
          {canRequestStorage && (
            <p>
              {t('Ask the browser to reduce automatic removal of local routes. It may decline.')}
            </p>
          )}
          {canRequestStorage && (
            <Button
              variant="outline"
              disabled={pwa.storagePending}
              onClick={() => void pwa.requestStorage()}
            >
              {pwa.storagePending && (
                <LoaderCircle className="pwa-spinner" size={16} aria-hidden="true" />
              )}
              {t('Request storage protection')}
            </Button>
          )}
          <details className="pwa-backup-note">
            <summary>{t('Keep a separate backup')}</summary>
            <div className="pwa-backup-description">
              <p>
                {t(
                  'Clearing site data deletes local routes, even when storage protection is granted.',
                )}
              </p>
              <p>
                {t(
                  'Export a JSON library backup from My routes regularly and before reinstalling or clearing browser data. GPX saves individual routes, not the whole library. Cloud backups are optional and must be created explicitly.',
                )}
              </p>
            </div>
          </details>
        </section>
      </div>
    </Dialog>
  );
}
