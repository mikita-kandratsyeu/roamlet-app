import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Sparkles } from 'lucide-react';
import type { EditorSnapshot } from '../domain/editorSnapshot';
import { aiChanges, type AiContext, type AiProposal } from '../domain/ai';
import { normalizeRoutingOptions } from '../domain/routingOptions';
import { AiError, proposeAi } from '../services/ai';
import { useAiConnection } from '../hooks/useAiConnection';
import { AiConnectionDialog } from './AiConnectionDialog';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Notification } from './Notification';
import './AiConnector.css';
const labels = {
  cyclingProfile: 'Cycling profile',
  avoidFerries: 'Avoid ferries',
  avoidSteps: 'Avoid steps',
};
const profiles: Record<string, string> = {
  'cycling-regular': 'Regular cycling',
  'cycling-road': 'Road cycling',
  'cycling-mountain': 'Mountain biking',
};
export function AiAssistantDialog({
  snapshot,
  canApply,
  applying,
  onApply,
  onCancelApply,
  onClose,
}: {
  snapshot: EditorSnapshot;
  canApply: boolean;
  applying: boolean;
  onApply: (proposal: AiProposal) => Promise<boolean>;
  onCancelApply: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ai = useAiConnection(true);
  const [settings, setSettings] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    value: AiProposal;
    key: string;
    context: AiContext;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const context: AiContext = {
    activity: snapshot.activity,
    routingOptions: normalizeRoutingOptions(snapshot.routingOptions),
  };
  const key = JSON.stringify([snapshot, ai.session?.connection, ai.session?.connected, canApply]);
  useEffect(() => {
    revision.current++;
    request.current?.abort();
    onCancelApply();
    setLoading(false);
    return () => {
      request.current?.abort();
      onCancelApply();
    };
  }, [key, onCancelApply]);
  useEffect(() => {
    if (proposal) resultHeading.current?.focus();
  }, [proposal]);
  const stale = proposal !== null && proposal.key !== key;
  const changes = proposal ? aiChanges(proposal.context, proposal.value) : [];
  const online = ai.online;
  const cancel = () => {
    revision.current++;
    request.current?.abort();
    setLoading(false);
    onCancelApply();
  };
  const close = () => {
    cancel();
    onClose();
  };
  const valueLabel = (value: boolean | string) =>
    typeof value === 'boolean' ? t(value ? 'Yes' : 'No') : t(profiles[value] ?? value);
  async function suggest() {
    if (!online || !ai.session?.connected || !prompt.trim() || loading || applying) return;
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    const current = ++revision.current;
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      const value = await proposeAi(prompt.trim(), context, abort.signal);
      if (!abort.signal.aborted && current === revision.current)
        setProposal({ value, key, context });
    } catch (failure) {
      if (!abort.signal.aborted && current === revision.current) {
        setError(
          failure instanceof AiError
            ? failure.message
            : 'Could not reach the AI provider. Check your connection and retry.',
        );
        if (failure instanceof AiError && failure.code === 'auth') void ai.refresh();
      }
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }
  return (
    <Dialog
      wide
      title={t('AI route assistant')}
      description={t(
        'Describe a wish, review the suggestion, then approve changes. AI does not draw routes or save them automatically.',
      )}
      initialFocusRef={input}
      onClose={close}
      footer={
        <div className="button-row ai-footer">
          <Button variant="outline" onClick={close}>
            {t(loading || applying ? 'Stop and close' : 'Cancel')}
          </Button>
          {proposal && (
            <Button
              disabled={
                stale ||
                !changes.length ||
                !canApply ||
                applying ||
                loading ||
                !online ||
                !ai.session?.connected
              }
              onClick={() => {
                if (stale || !canApply) return;
                setError(null);
                void onApply(proposal.value)
                  .then((done) => {
                    if (done) close();
                  })
                  .catch(() =>
                    setError('Recalculation failed. The original route and settings were kept.'),
                  );
              }}
            >
              {applying && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {t(applying ? 'Recalculating route' : 'Apply and recalculate')}
            </Button>
          )}
        </div>
      }
    >
      <div className="ai-stack">
        <Card className="ai-summary">
          <Badge>{t(ai.session?.connected ? 'Connected' : 'Not connected')}</Badge>
          {ai.session?.connected && (
            <span>
              {ai.session.connection?.model} · {ai.session.connection?.baseUrl}
            </span>
          )}
          <Button
            variant="outline"
            disabled={ai.loading || loading || applying}
            onClick={() => setSettings(true)}
          >
            {t(ai.session?.connected ? 'Manage connection' : 'Set up connection')}
          </Button>
        </Card>
        <Alert>
          <AlertDescription>
            {t(
              'AI can suggest cycling profiles and avoidance of ferries or steps. It cannot guarantee duration, find cafes, or verify road access. Routing rules are preferences, not safety guarantees.',
            )}
          </AlertDescription>
        </Alert>
        {!canApply && (
          <p role="status">
            {t(
              'To apply suggestions, use editable point-to-point routing with at least two stops and a road/path section. Saved snapshots, loops and manual drawing are not changed here.',
            )}
          </p>
        )}
        {!online && (
          <p role="status">
            {t(
              'AI needs an internet connection. Manual planning and saved routes remain available.',
            )}
          </p>
        )}
        <Label htmlFor={`${id}-prompt`}>{t('What would you like to change?')}</Label>
        <Textarea
          ref={input}
          id={`${id}-prompt`}
          value={prompt}
          maxLength={2000}
          disabled={loading || applying}
          onChange={(event) => {
            setPrompt(event.target.value);
            setProposal(null);
          }}
          placeholder={t('For example: avoid ferries and steps')}
        />
        <div className="button-row">
          <Button
            variant="outline"
            disabled={loading || applying}
            onClick={() => {
              setPrompt(t('Avoid ferries and steps'));
              setProposal(null);
              input.current?.focus();
            }}
          >
            {t('Avoid ferries and steps')}
          </Button>
          {snapshot.activity === 'cycling' && (
            <Button
              variant="outline"
              disabled={loading || applying}
              onClick={() => {
                setPrompt(t('Use the mountain biking profile'));
                setProposal(null);
                input.current?.focus();
              }}
            >
              {t('Use the mountain biking profile')}
            </Button>
          )}
        </div>
        <Card className="ai-summary">
          <strong>{t('What will be sent')}</strong>
          <p>
            {t(
              'Only your request text, activity and the settings below are sent to the selected AI provider through Roamlet. Coordinates, route geometry, names and the library are not included automatically. Do not put private data in the request text.',
            )}
          </p>
          <span>{t(snapshot.activity === 'cycling' ? 'Cycling' : 'Hiking')}</span>
          {Object.entries(context.routingOptions).map(([setting, value]) => (
            <span key={setting}>
              {t(labels[setting as keyof typeof labels])}: {valueLabel(value)}
            </span>
          ))}
          <p>
            {t(
              'Each request uses your paid API quota. There are no automatic retries. Cancellation may still be billed.',
            )}
          </p>
        </Card>
        <Button
          disabled={
            !online || !ai.session?.connected || ai.loading || loading || applying || !prompt.trim()
          }
          onClick={() => void suggest()}
        >
          {loading ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles aria-hidden="true" />
          )}
          {t(loading ? 'Getting a suggestion' : 'Get suggestion (uses API quota)')}
        </Button>
        {(loading || applying) && (
          <Button variant="outline" onClick={cancel}>
            {t('Stop request')}
          </Button>
        )}
        {proposal && (
          <Card className="ai-summary">
            <h3 ref={resultHeading} tabIndex={-1}>
              {t('Suggested changes')}
            </h3>
            {stale && (
              <Alert role="status">
                <AlertDescription>
                  {t('The route or connection changed. Get a new suggestion before applying.')}
                </AlertDescription>
              </Alert>
            )}
            <p className="ai-explanation">{proposal.value.explanation}</p>
            <Separator />
            {changes.length ? (
              <div className="ai-table-scroll">
                <table className="ai-changes">
                  <caption className="sr-only">{t('Suggested changes')}</caption>
                  <thead>
                    <tr>
                      <th>{t('Setting')}</th>
                      <th>{t('Current')}</th>
                      <th>{t('Suggested')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((change) => (
                      <tr key={change.key}>
                        <th scope="row">{t(labels[change.key])}</th>
                        <td>{valueLabel(change.before)}</td>
                        <td>{valueLabel(change.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p role="status">
                {t('No supported setting changes were suggested. Nothing will be applied.')}
              </p>
            )}
            <p>
              {t(
                'Applying recalculates road/path geometry and may change the route. Save or export your original first. Failed recalculation keeps the original route and settings.',
              )}
            </p>
            <Button
              variant="outline"
              disabled={applying}
              onClick={() => {
                setProposal(null);
                input.current?.focus();
              }}
            >
              {t('Refine request')}
            </Button>
          </Card>
        )}
        {(error || ai.error) && (
          <Notification
            title={t('AI route assistant')}
            variant="error"
            message={t(error || ai.error || '')}
            onDismiss={() => {
              setError(null);
              ai.dismissError();
            }}
          />
        )}
      </div>
      {settings && <AiConnectionDialog ai={ai} onClose={() => setSettings(false)} />}
    </Dialog>
  );
}
