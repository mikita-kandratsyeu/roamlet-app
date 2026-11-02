import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronDown, Eye, EyeOff, LoaderCircle, ShieldCheck, Unplug } from 'lucide-react';
import type { useAiConnection } from '../hooks/useAiConnection';
import { aiProviderChoices, aiProviderTemplate } from '../domain/aiProviders';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Notification } from './Notification';
import './AiConnector.css';
export function AiConnectionDialog({ ai, onClose, disconnectInitially = false }: {
  ai: ReturnType<typeof useAiConnection>; onClose: () => void; disconnectInitially?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [changing, setChanging] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(disconnectInitially);
  const cancelDisconnect = useRef<HTMLButtonElement>(null);
  const providerTrigger = useRef<HTMLButtonElement>(null);
  const providers = ai.session?.providers ?? [];
  const provider = baseUrl || providers[0] || '';
  const template = aiProviderTemplate(provider);
  const selectedModel = model ?? template?.model ?? '';
  const connected = ai.session?.connected && !changing;
  const connectionTemplate = aiProviderTemplate(ai.session?.connection?.baseUrl ?? '');
  const close = () => { ai.cancel(); setApiKey(''); onClose(); };
  const change = () => {
    setBaseUrl(ai.session?.connection?.baseUrl ?? '');
    setModel(ai.session?.connection?.model ?? null);
    setApiKey(''); setVisible(false); setChanging(true);
  };
  const blocked = ai.loading || !ai.online || !ai.session?.available || !provider || !selectedModel.trim() || !apiKey.trim();
  return <Dialog title={t('AI connection settings')}
    description={t('Choose a provider template and connect with your own API key.')}
    onClose={close} initialFocusRef={connected ? undefined : providerTrigger}
    footer={<div className="ai-dialog-footer">
      {!connected && <p className="ai-quota-note">{t('Verification uses your API quota. Cancellation may still be billed.')}</p>}
      <div className="ai-footer-actions">
        <Button variant="outline" onClick={close}>{t(ai.loading ? 'Stop and close' : 'Close dialog')}</Button>
        {connected ? <Button onClick={change} disabled={ai.loading}>{t('Change AI connection')}</Button> :
          <Button type="submit" form={`${id}-form`} className="ai-primary" disabled={blocked}>
            {ai.loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {t(ai.loading ? 'Checking connection' : 'Verify and connect (uses API quota)')}
          </Button>}
      </div>
    </div>}>
    <div className="ai-stack ai-connection-content">
      {!ai.online && <Alert><AlertDescription>{t('AI needs an internet connection. Manual planning and saved routes remain available.')}</AlertDescription></Alert>}
      {ai.online && ai.session?.available === false && <Alert><AlertDescription>{t('AI is not configured on this deployment. Local planning remains available.')}</AlertDescription></Alert>}
      {connected ? <>
        <section className="ai-connected-overview" aria-label={t('Connection overview')}>
          <div className="ai-connection-heading"><img src="/ai-connector.svg" width="40" height="40" alt="" />
            <div><strong>{connectionTemplate?.name ?? t('OpenAI-compatible provider')}</strong><span>{ai.session?.connection?.model}</span></div>
            <Badge className="ai-connected-badge"><CheckCircle2 size={14} aria-hidden="true" />{t('Connected')}</Badge>
          </div>
          <code className="ai-endpoint">{ai.session?.connection?.baseUrl}</code>
          <p>{t('Connection lasts up to one hour in this browser. Re-enter the key after expiry. Keys are not included in local storage or backups.')}</p>
          <Button variant="ghost" className="ai-disconnect" disabled={ai.loading || !ai.online} onClick={() => setConfirmDisconnect(true)}><Unplug size={16} aria-hidden="true" />{t('Disconnect')}</Button>
        </section>
      </> : <form id={`${id}-form`} className="ai-settings-form" onSubmit={(event) => {
        event.preventDefault(); if (blocked) return;
        void ai.connect({ baseUrl: provider, model: selectedModel.trim(), apiKey: apiKey.trim() }).then((done) => {
          if (done) { setApiKey(''); setVisible(false); setChanging(false); }
        });
      }}>
        <div className="ai-field">
          <Label>{t('AI provider')}</Label>
          <DropdownMenu><DropdownMenuTrigger asChild>
            <Button ref={providerTrigger} variant="outline" className="ai-provider-choice" aria-label={t('AI provider')} disabled={ai.loading}>
              <span>{template?.name ?? (provider || t('Choose a provider'))}</span><ChevronDown size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger><DropdownMenuContent align="start" collisionPadding={12} className="ai-provider-menu">
            <DropdownMenuRadioGroup value={provider} onValueChange={(next) => {
              if (!providers.includes(next)) return;
              setBaseUrl(next); setModel(null);
            }}>
              {aiProviderChoices(providers).map((choice) => <DropdownMenuRadioItem key={choice.value} value={choice.value} disabled={!choice.enabled}>
                <span className="ai-provider-option"><span>{choice.name}</span>{!choice.enabled && <span className="ai-provider-unavailable">{t('Not enabled')}</span>}</span>
              </DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent></DropdownMenu>
          {provider && <code className="ai-endpoint">{provider}</code>}
          <p className="ai-field-help">{t('Only providers enabled for this deployment can be selected. Templates do not grant API access.')}</p>
        </div>
        <div className="ai-field">
          <Label htmlFor={`${id}-model`}>{t('Model ID')}</Label>
          <Input id={`${id}-model`} value={selectedModel} maxLength={128} autoComplete="off" required disabled={ai.loading} onChange={(event) => setModel(event.target.value)} aria-describedby={`${id}-model-help`} />
          <p id={`${id}-model-help`} className="ai-field-help">{t('The template provides an editable model example. Check model access and pricing with your provider.')}</p>
        </div>
        <div className="ai-field">
          <Label htmlFor={`${id}-key`}>{t('API key')}</Label>
          <div className="ai-key"><Input id={`${id}-key`} type={visible ? 'text' : 'password'} value={apiKey} maxLength={1024} autoComplete="off" spellCheck={false} required disabled={ai.loading} onChange={(event) => setApiKey(event.target.value)} aria-describedby={`${id}-key-help`} />
            <Button type="button" variant="outline" className="ai-key-visibility" aria-label={t(visible ? 'Hide API key' : 'Show API key')} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</Button>
          </div>
          <p id={`${id}-key-help`} className="ai-field-help">{t('Your key is kept in a protected, encrypted cookie for up to one hour. It is never added to backups.')}</p>
        </div>
        {changing && <Button type="button" variant="ghost" onClick={() => { setApiKey(''); setChanging(false); }}>{t('Keep current connection')}</Button>}
      </form>}
      <details className="ai-disclosure"><summary><ShieldCheck size={16} aria-hidden="true" /><span>{t('Privacy, billing and limits')}</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="ai-disclosure-body">
          <p>{t('API usage is billed by your provider, separately from chat subscriptions. Connection verification and each suggestion may cost money. Cancellation may not prevent billing.')}</p>
          <p>{t('The key is sent to the Roamlet server and your selected provider. It is kept in an encrypted, protected browser cookie for up to one hour, never in backups or logs.')}</p>
          <p>{t('Enter the exact model ID from your provider. It must support Chat Completions with JSON responses.')}</p>
        </div>
      </details>
      {ai.error && <Notification title={t('AI connection settings')} message={t(ai.error)} variant="error" onDismiss={ai.dismissError} />}
    </div>
    {confirmDisconnect && <Dialog compact initialFocusRef={cancelDisconnect} title={t('Disconnect AI?')} description={t('This ends the AI connection across browser tabs. It does not revoke your provider key or delete routes.')} onClose={() => setConfirmDisconnect(false)}>
      <div className="button-row"><Button ref={cancelDisconnect} variant="outline" disabled={ai.loading} onClick={() => setConfirmDisconnect(false)}>{t('Cancel')}</Button><Button disabled={ai.loading || !ai.online} onClick={() => { void ai.disconnect().then((done) => { if (done) { setConfirmDisconnect(false); close(); } }); }}>{t('Disconnect')}</Button></div>
    </Dialog>}
  </Dialog>;
}
