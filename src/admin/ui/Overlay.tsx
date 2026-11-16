/**
 * Les fenêtres de l'admin, sur Radix Dialog (focus piégé, Échap, lecteurs
 * d'écran), montées DANS la coquille pour garder le kit :
 *   - Dialog : une question, deux boutons ;
 *   - ReasonDialog : une action sensible, le motif est OBLIGATOIRE (il part
 *     au journal d'audit par la RPC appelée dans `onConfirm`) ;
 *   - Drawer : un tiroir latéral (aperçu d'une fiche sans quitter la liste).
 */
import { useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminPortal } from './portal';
import { useAdminT } from './i18n';

function Shell({ open, onOpenChange, children, side }: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode; side?: 'center' | 'right' }) {
  const container = useAdminPortal();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal container={container ?? undefined}>
        <D.Overlay className="fixed inset-0 z-[90]" style={{ background: 'var(--a-overlay)' }} />
        <D.Content
          className={cn('fixed z-[91] flex flex-col outline-none',
            side === 'right'
              ? 'inset-y-0 right-0 w-[min(560px,100vw)] border-l'
              : 'left-1/2 top-[12vh] w-[min(480px,calc(100vw-24px))] -translate-x-1/2 rounded-xl border')}
          style={{ background: 'var(--a-panel)', boxShadow: 'var(--a-shadow-pop)', maxHeight: side === 'right' ? undefined : '76vh' }}>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Dialog({
  open, onOpenChange, title, description, children, confirmLabel, cancelLabel, onConfirm, tone = 'primary', busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  onConfirm?: () => void;
  tone?: 'primary' | 'danger';
  busy?: boolean;
}) {
  const { t } = useAdminT();
  return (
    <Shell open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-1.5 px-5 pt-5">
        <D.Title className="a-t1 text-[15px] font-semibold">{title}</D.Title>
        {description ? <D.Description className="a-t2 text-[13px] leading-relaxed">{description}</D.Description> : <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>}
      </div>
      {children && <div className="min-h-0 overflow-y-auto px-5 pt-4">{children}</div>}
      <div className="flex justify-end gap-2 px-5 pb-5 pt-5">
        <button type="button" className="a-btn" onClick={() => onOpenChange(false)}>{cancelLabel ?? t('adm.ui.cancel')}</button>
        {onConfirm && (
          <button type="button" className={cn('a-btn', tone === 'danger' ? 'a-btn--danger' : 'a-btn--primary')} onClick={onConfirm} disabled={busy}>
            {busy ? t('adm.ui.working') : confirmLabel ?? t('adm.ui.confirm')}
          </button>
        )}
      </div>
    </Shell>
  );
}

/** Motif d'au moins 4 caractères : assez pour relire le journal six mois après. */
export const MIN_REASON_LENGTH = 4;

export function ReasonDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm, tone = 'primary', children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  /** Reçoit le motif ; une erreur levée reste affichée dans la fenêtre. */
  onConfirm: (reason: string) => Promise<void> | void;
  tone?: 'primary' | 'danger';
  children?: ReactNode;
}) {
  const { t } = useAdminT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = reason.trim().length >= MIN_REASON_LENGTH;

  const close = (v: boolean) => { if (!v) { setReason(''); setErr(null); } onOpenChange(v); };
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true); setErr(null);
    try {
      await onConfirm(reason.trim());
      close(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('adm.ui.error.title'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close} title={title} description={description}
      confirmLabel={confirmLabel} tone={tone} busy={busy} onConfirm={ok ? () => void submit() : undefined}>
      <div className="flex flex-col gap-3">
        {children}
        <label className="flex flex-col gap-1.5">
          <span className="a-t1 text-[12.5px] font-medium">{t('adm.ui.reason.label')}</span>
          <textarea className="a-input" rows={3} value={reason} autoFocus
            onChange={(e) => setReason(e.target.value)} placeholder={t('adm.ui.reason.placeholder')} />
          <span className="a-t3 text-[12px]">{t('adm.ui.reason.hint')}</span>
        </label>
        {err && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{err}</p>}
      </div>
    </Dialog>
  );
}

export function Drawer({ open, onOpenChange, title, description, actions, children }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useAdminT();
  return (
    <Shell open={open} onOpenChange={onOpenChange} side="right">
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <D.Title className="a-t1 truncate text-[15px] font-semibold">{title}</D.Title>
          {description ? <D.Description className="a-t2 mt-0.5 text-[12.5px]">{description}</D.Description> : <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>}
        </div>
        {actions}
        <D.Close className="a-btn a-btn--ghost a-btn--icon" aria-label={t('adm.ui.close')}><X className="h-4 w-4" /></D.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </Shell>
  );
}
