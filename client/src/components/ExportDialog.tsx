import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { gpxFilename } from '../domain/gpx';
import { formatDistance } from '../domain/format';
import type { PlannedRoute } from '../domain/types';
import { translateMessage } from '../i18n';
import './ExportDialog.css';

export function ExportDialog({
  route,
  onDownload,
  onClose,
}: {
  route: PlannedRoute;
  onDownload: (route: PlannedRoute, filename: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [filename, setFilename] = useState(() => gpxFilename(route.name));
  const [error, setError] = useState<string | null>(null);
  const filenameInput = useRef<HTMLInputElement>(null);

  return (
    <Dialog title={t('Export route')} initialFocusRef={filenameInput} onClose={onClose}>
      <p className="export-route-summary">
        <strong>{route.name || t('Untitled adventure')}</strong>
        <span className="muted">{formatDistance(route.stats.distance)}</span>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!filename.trim()) return;
          setError(null);
          try {
            onDownload(route, gpxFilename(filename));
          } catch (error) {
            setError(
              error instanceof Error ? error.message : 'Something went wrong. Please try again.',
            );
          }
        }}
      >
        <Label htmlFor="export-filename">{t('File name')}</Label>
        <Input
          id="export-filename"
          ref={filenameInput}
          required
          maxLength={120}
          value={filename}
          aria-describedby="export-filename-hint"
          onChange={(event) => setFilename(event.target.value)}
        />
        <p id="export-filename-hint" className="muted export-copy">
          {t('Saved as {{filename}}', { filename: gpxFilename(filename) })}
        </p>
        <div className="export-format">
          <strong>{t('GPX for GPS devices and apps')}</strong>
          <p className="muted export-copy">
            {t('Includes track geometry, elevations when available, and waypoints.')}
          </p>
        </div>
        {error && (
          <p role="alert" className="error-inline">
            {translateMessage(error)}
          </p>
        )}
        <Button type="submit" className="primary export-download" disabled={!filename.trim()}>
          <Download size={17} aria-hidden="true" />
          {t('Download GPX')}
        </Button>
      </form>
      <details className="export-guide">
        <summary>{t('How to import into Komoot')}</summary>
        <p className="muted export-copy">
          {t('Import the downloaded file yourself. Roamlet does not send routes to Komoot.')}
        </p>
        <ol>
          <li>{t('Download the GPX file above.')}</li>
          <li>{t('In Komoot, open Profile → Saved routes → Import a GPS file.')}</li>
          <li>{t('Choose the downloaded file, import it as a planned route, and save.')}</li>
        </ol>
        <a
          href="https://support.komoot.com/hc/en-us/articles/10115477099674-Export-and-import-Routes-and-Activities"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('Komoot import instructions')}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      </details>
    </Dialog>
  );
}
