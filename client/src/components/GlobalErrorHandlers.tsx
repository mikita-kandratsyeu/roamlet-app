import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  GLOBAL_UNHANDLED_TOAST_ID,
  registerGlobalErrorHandlers,
} from '../domain/globalErrors';
import { translateMessage } from '../i18n';

export function GlobalErrorHandlers() {
  useEffect(() => {
    return registerGlobalErrorHandlers((message) => {
      toast.error(translateMessage(message), { id: GLOBAL_UNHANDLED_TOAST_ID });
    });
  }, []);
  return null;
}