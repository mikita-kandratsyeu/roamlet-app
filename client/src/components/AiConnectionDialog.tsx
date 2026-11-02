import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import type { useAiConnection } from '../hooks/useAiConnection';
import { Dialog } from './Dialog';
import { PlannerChoice } from './PlannerChoice';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Alert } from './ui/alert';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Notification } from './Notification';
import './AiConnector.css';
export function AiConnectionDialog({ ai, onClose, disconnectInitially = false }: { ai: ReturnType<typeof useAiConnection>; onClose: () => void; disconnectInitially?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [changing, setChanging] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(disconnectInitially);
  const cancelDisconnect = useRef<HTMLButtonElement>(null);
  const providers = ai.session?.providers ?? [];
  const provider = baseUrl || providers[0] || '';
  const connected = ai.session?.connected && !changing;
  const close = () => { ai.cancel(); setApiKey(''); onClose(); };
  return <Dialog title={t('AI connection settings')} description={t('Use your own API key to get route setting suggestions. Nothing changes without your approval.')} onClose={close}
    footer={<Button variant="outline" onClick={close}>{t(ai.loading ? 'Stop and close' : 'Close dialog')}</Button>}>
    <div className="ai-stack">
      <Alert>{t('API usage is billed by your provider, separately from chat subscriptions. Connection verification and each suggestion may cost money. Cancellation may not prevent billing.')}</Alert>
      {ai.session?.available === false && <p role="status">{t('AI is not configured on this deployment. Local planning remains available.')}</p>}
      {connected ? <>
        <Card className="ai-summary"><Badge>{t('Connected')}</Badge><strong>{ai.session?.connection?.model}</strong><span>{ai.session?.connection?.baseUrl}</span></Card>
        <p>{t('Connection lasts up to one hour in this browser. Re-enter the key after expiry. Keys are not included in local storage or backups.')}</p>
        <div className="button-row"><Button variant="outline" disabled={ai.loading} onClick={() => {
          setBaseUrl(ai.session?.connection?.baseUrl ?? ''); setModel(ai.session?.connection?.model ?? ''); setChanging(true);
        }}>{t('Change AI connection')}</Button><Button variant="outline" disabled={ai.loading} onClick={() => setConfirmDisconnect(true)}>{t('Disconnect')}</Button></div>
      </> : <form className="ai-stack" onSubmit={(event) => {
        event.preventDefault();
        void ai.connect({ baseUrl: provider, model: model.trim(), apiKey: apiKey.trim() }).then((done) => {
          if (done) { setApiKey(''); setVisible(false); setChanging(false); }
        });
      }}>
        <Label>{t('AI provider')}<PlannerChoice label={t('AI provider')} value={provider} options={providers.map((url) => ({ value: url, label: url }))} onChange={setBaseUrl} disabled={ai.loading || !providers.length} /></Label>
        <Label htmlFor={`${id}-model`}>{t('Model ID')}</Label>
        <Input id={`${id}-model`} value={model} maxLength={128} autoComplete="off" required disabled={ai.loading} onChange={(event) => setModel(event.target.value)} aria-describedby={`${id}-model-help`} />
        <p id={`${id}-model-help`}>{t('Enter the exact model ID from your provider. It must support Chat Completions with JSON responses.')}</p>
        <Label htmlFor={`${id}-key`}>{t('API key')}</Label>
        <div className="ai-key"><Input id={`${id}-key`} type={visible ? 'text' : 'password'} value={apiKey} maxLength={1024} autoComplete="off" spellCheck={false} required disabled={ai.loading} onChange={(event) => setApiKey(event.target.value)} />
          <Button type="button" variant="outline" aria-label={t(visible ? 'Hide API key' : 'Show API key')} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</Button></div>
        <p>{t('The key is sent to the Roamlet server and your selected provider. It is kept in an encrypted, protected browser cookie for up to one hour, never in backups or logs.')}</p>
        <Button type="submit" disabled={ai.loading || !ai.session?.available || !provider || !model.trim() || !apiKey.trim()}>{ai.loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}{t(ai.loading ? 'Checking connection' : 'Verify and connect (uses API quota)')}</Button>
      </form>}
      {ai.error && <Notification title={t('AI connection settings')} message={t(ai.error)} variant="error" onDismiss={ai.dismissError} />}
    </div>
    {confirmDisconnect && <Dialog compact initialFocusRef={cancelDisconnect} title={t('Disconnect AI?')} description={t('This ends the AI connection across browser tabs. It does not revoke your provider key or delete routes.')} onClose={() => setConfirmDisconnect(false)}>
      <div className="button-row"><Button ref={cancelDisconnect} variant="outline" disabled={ai.loading} onClick={() => setConfirmDisconnect(false)}>{t('Cancel')}</Button><Button disabled={ai.loading} onClick={() => { void ai.disconnect().then((done) => { if (done) { setConfirmDisconnect(false); close(); } }); }}>{t('Disconnect')}</Button></div>
    </Dialog>}
  </Dialog>;
}
