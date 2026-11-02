import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { EditorSnapshot } from '../domain/editorSnapshot';
import type { AiProposal } from '../domain/ai';
import { useAiConnection } from '../hooks/useAiConnection';
import { AiAssistantDialog } from './AiAssistantDialog';
import { Button } from './ui/button';
import './AiConnector.css';
export function AiPlannerAction({ snapshot, disabled, canApply, applying, onApply, onCancelApply }: {
  snapshot: EditorSnapshot; disabled: boolean; canApply: boolean; applying: boolean;
  onApply: (proposal: AiProposal) => Promise<boolean>; onCancelApply: () => void;
}) {
  const { t } = useTranslation();
  const connection = useAiConnection(true);
  const [open, setOpen] = useState(false);
  return <>
    {connection.session?.connected && connection.online && <Button variant="ghost" className="ai-planner-action" aria-label={t('AI route assistant')} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)}>
      <Sparkles size={15} aria-hidden="true" /><span>{t('AI assistant')}</span>
    </Button>}
    {open && <AiAssistantDialog connection={connection} snapshot={snapshot} canApply={canApply} applying={applying} onApply={onApply} onCancelApply={onCancelApply} onClose={() => setOpen(false)} />}
  </>;
}
