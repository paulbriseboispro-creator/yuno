/**
 * Le toast des écrans Clients de Yuno Tickets : même signature que celui du CRM
 * (`useCrmToast`), dessiné par le toast de la Console (sonner), comme les
 * Analyses.
 */
import { useCallback } from 'react';
import { toast as sonner } from 'sonner';

export type ToastFn = (msg: string, action?: { label: string; onClick: () => void }) => void;

export function useTixToast(): ToastFn {
  return useCallback<ToastFn>((msg, action) => {
    sonner(msg, action ? { action: { label: action.label, onClick: action.onClick } } : undefined);
  }, []);
}
