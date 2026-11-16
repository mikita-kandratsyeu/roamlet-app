import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Copy, FileDown, LoaderCircle } from 'lucide-react';
import { buildAiExport, describeAiExportContents } from '../domain/aiExport';
import { exportRouteBasename } from '../domain/gpx';
import type { PersonalTimeOptions } from '../domain/time';
import type { PlannedRoute } from '../domain/types';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Notification } from './Notification';
import { formatNumber } from '../i18n';

export function AiRouteExport({
  route,
  personalTime,
  actionsContainer,
}: {
  route: PlannedRoute;
  personalTime?: PersonalTimeOptions;
  actionsContainer?: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const text = useMemo(
    () => buildAiExport(route, { personalTime, includeSensitive, translate: t }),
    [route, personalTime, includeSensitive, t],
  );
  const contents = useMemo(
    () =>
      describeAiExportContents(route, {
        personalTime,
        includeSensitive,
        translate: t,
      }),
    [route, personalTime, includeSensitive, t],
  );
  const [status, setStatus] = useState<{
    text: string;
    state: 'copying' | 'copied' | 'error';
  } | null>(null);
  const request = useRef({ generation: 0 });
  useEffect(() => {
    const current = request.current;
    setStatus(null);
    return () => {
      current.generation++;
    };
  }, [text]);
  const state = status?.text === text ? status.state : null;
  const charCount = text.length;

  async function copy() {
    const token = ++request.current.generation;
    setStatus({ text, state: 'copying' });
    try {
      await navigator.clipboard.writeText(text);
      if (token === request.current.generation) setStatus({ text, state: 'copied' });
    } catch {
      if (token === request.current.generation) setStatus({ text, state: 'error' });
    }
  }

  const downloadMarkdown = () => {
    const filename = `${exportRouteBasename(route.name)}-ai.md`;
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    try {
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
    } finally {
      URL.revokeObjectURL(url);
      link.remove();
    }
  };

  const placeActions = (actions: ReactNode) =>
    actionsContainer === undefined
      ? actions
      : actionsContainer
        ? createPortal(actions, actionsContainer)
        : null;

  return (
    <section className="ai-route-export" aria-label={t('For AI')}>
      <div className="ai-export-layout">
        <div className="ai-export-controls">
          <fieldset className="ai-export-contents">
            <legend>{t('What goes into the request')}</legend>
            <ul className="ai-export-chips" aria-live="polite">
              {contents.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </fieldset>
          <Label className="ai-export-privacy" htmlFor="ai-export-sensitive">
            <span className="ai-export-checkbox">
              <input
                id="ai-export-sensitive"
                type="checkbox"
                checked={includeSensitive}
                aria-labelledby="ai-export-privacy-title"
                aria-describedby="ai-export-privacy-hint ai-export-sharing-hint"
                onChange={(event) => setIncludeSensitive(event.target.checked)}
              />
              <Check size={14} strokeWidth={3} aria-hidden="true" />
            </span>
            <span className="ai-export-privacy-content">
              <span id="ai-export-privacy-title">
                {t('Include names, coordinates and departure date')}
              </span>
              <span id="ai-export-privacy-hint" className="muted export-copy">
                {t(
                  'Off by default. Adds the full track and stop names, which may reveal your home address and travel plans.',
                )}
              </span>
            </span>
          </Label>
          <details className="ai-export-privacy-details">
            <summary>{t('Before sharing with AI')}</summary>
            <aside className="ai-export-disclaimer" aria-labelledby="ai-export-disclaimer-title">
              <h3 id="ai-export-disclaimer-title" className="sr-only">
                {t('Before sharing with AI')}
              </h3>
              <p id="ai-export-sharing-hint" className="export-copy">
                {t(
                  'Review the preview before sharing. Even route statistics do not guarantee anonymity. How your data is stored and used depends on the AI service.',
                )}
              </p>
              <p className="muted export-copy">
                {t(
                  'Descriptions, account data and keys are never included. AI answers may be wrong and do not confirm that a route is safe.',
                )}
              </p>
            </aside>
          </details>
        </div>
        <div className="ai-export-preview">
          <div className="ai-export-preview-heading">
            <Label htmlFor="ai-export-text">{t('Request preview')}</Label>
            <span className="ai-export-size muted">
              {t('{{count}} characters', { count: formatNumber(charCount) })}
            </span>
          </div>
          <Textarea
            id="ai-export-text"
            className="ai-export-text"
            readOnly
            value={text}
            spellCheck={false}
            aria-describedby="ai-export-manual-hint"
          />
          <p id="ai-export-manual-hint" className="muted export-copy">
            {t('You can also select and copy the preview manually.')}
          </p>
        </div>
      </div>
      {placeActions(
        <div
          className={`export-mode-actions${actionsContainer === undefined ? ' export-mode-actions--inline' : ''}`}
        >
          <Button
            type="button"
            variant="outline"
            className="export-ai-download"
            onClick={downloadMarkdown}
          >
            <FileDown size={17} aria-hidden="true" />
            {t('Download Markdown')}
          </Button>
          <Button
            type="button"
            className="export-download primary"
            disabled={state === 'copying'}
            onClick={() => void copy()}
          >
            {state === 'copying' ? (
              <LoaderCircle size={17} className="spin" aria-hidden="true" />
            ) : (
              <Copy size={17} aria-hidden="true" />
            )}
            {t(state === 'copying' ? 'Copying…' : 'Copy for AI')}
          </Button>
        </div>,
      )}
      {(state === 'copied' || state === 'error') && (
        <Notification
          key={state}
          title={t('Notification')}
          variant={state === 'copied' ? 'success' : 'error'}
          message={t(
            state === 'copied'
              ? 'Request copied. Paste it into your AI chat.'
              : 'Copying failed. Select the preview and copy it manually, or try again.',
          )}
          onDismiss={() => setStatus(null)}
        />
      )}
    </section>
  );
}