import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, LoaderCircle } from 'lucide-react';
import { buildAiExport } from '../domain/aiExport';
import type { PersonalTimeOptions } from '../domain/time';
import type { PlannedRoute } from '../domain/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

export function AiRouteExport({
  route,
  personalTime,
}: {
  route: PlannedRoute;
  personalTime?: PersonalTimeOptions;
}) {
  const { t } = useTranslation();
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const text = useMemo(
    () => buildAiExport(route, { personalTime, includeSensitive, translate: t }),
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
  return (
    <section className="ai-route-export" aria-label={t('For AI')}>
      <p className="muted export-copy">
        {t(
          'Copy this request into an AI chat. No API key is needed and Roamlet sends nothing automatically. Review the text before sharing; statistics alone do not guarantee anonymity.',
        )}
      </p>
      <Label className="ai-export-privacy" htmlFor="ai-export-sensitive">
        <Input
          id="ai-export-sensitive"
          type="checkbox"
          checked={includeSensitive}
          aria-describedby="ai-export-privacy-hint"
          onChange={(event) => setIncludeSensitive(event.target.checked)}
        />
        {t('Include names, coordinates and departure date')}
      </Label>
      <p id="ai-export-privacy-hint" className="muted export-copy">
        {t(
          'Off by default. Enabling this includes the full track and can reveal your home address and travel plans. Descriptions, account data and keys are never included.',
        )}
      </p>
      <Label htmlFor="ai-export-text">{t('Request preview')}</Label>
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
      <Button
        type="button"
        className="export-download"
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
      {state === 'copied' && (
        <p role="status">{t('Request copied. Paste it into your AI chat.')}</p>
      )}
      {state === 'error' && (
        <p role="alert">
          {t('Copying failed. Select the preview and copy it manually, or try again.')}
        </p>
      )}
    </section>
  );
}
