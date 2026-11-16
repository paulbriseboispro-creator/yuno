/**
 * Une action sensible = un motif, au journal. `useReasonAction` rend une
 * seule fenêtre pour toute une page : `ask({ title, run })` l'ouvre, la
 * fenêtre appelle `run(motif)` (la RPC qui écrit le journal), puis rafraîchit
 * les lectures de la rubrique.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ReasonDialog, useAdminT } from '@/admin/ui';

export interface ReasonRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  tone?: 'primary' | 'danger';
  /** Champs en plus du motif (lus par `run`, par exemple via le DOM). */
  children?: ReactNode;
  run: (reason: string) => Promise<unknown>;
}

export function useReasonAction(invalidate: readonly unknown[] = ['admin']) {
  const { t } = useAdminT();
  const qc = useQueryClient();
  const [req, setReq] = useState<ReasonRequest | null>(null);
  const ask = useCallback((r: ReasonRequest) => setReq(r), []);
  const dialog = req ? (
    <ReasonDialog
      open onOpenChange={(v) => { if (!v) setReq(null); }}
      title={req.title} description={req.description} confirmLabel={req.confirmLabel} tone={req.tone}
      children={req.children}
      onConfirm={async (reason) => {
        await req.run(reason);
        await qc.invalidateQueries({ queryKey: [...invalidate] });
        toast.success(t('adm.sys.saved'));
        setReq(null);
      }}
    />
  ) : null;
  return { ask, dialog };
}
