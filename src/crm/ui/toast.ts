/**
 * Le toast de la Console CRM : le contexte et son crochet. Le fournisseur
 * (qui dessine la pastille) vit dans kit.tsx.
 */
import { createContext, useContext } from 'react';

export type ToastFn = (msg: string, action?: { label: string; onClick: () => void }) => void;

export const ToastCtx = createContext<ToastFn>(() => {});

export function useCrmToast(): ToastFn {
  return useContext(ToastCtx);
}
