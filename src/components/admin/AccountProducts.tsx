import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Layers, Mail, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Btn, Modal, Pill, Spinner, T1, T2, T3, F_BORDER } from '@/components/admin/ui';
import { fmtDate } from '@/lib/adminFormat';

/**
 * Les produits d'un compte (Billetterie, CRM) et l'ouverture de l'autre
 * (migration 20261006100000) : pastilles dans les listes du super admin, et une
 * fenêtre pour inviter le titulaire par email (style Yuno CRM, edge
 * admin-account-recovery → invite-product) ou ouvrir directement.
 */

export type Product = 'suite' | 'crm';

export interface AccountRef {
  venueId?: string | null;
  organizerUserId?: string | null;
  name: string;
  product: Product;
  extra: Product[];
}

interface ProductEvent { scope_key: string; product: Product; action: 'added' | 'invited'; via: string; email: string | null; created_at: string }
interface OpenInvite { scope_key: string; product: Product; email: string; created_at: string; expires_at: string }

export function normalizeProducts(product: unknown, extra: unknown): { product: Product; extra: Product[] } {
  const p: Product = product === 'crm' ? 'crm' : 'suite';
  const e = Array.isArray(extra) ? extra.filter((x): x is Product => (x === 'crm' || x === 'suite') && x !== p) : [];
  return { product: p, extra: e };
}

export function ProductPills({ product, extra }: { product: Product; extra: Product[] }) {
  const { t } = useLanguage();
  const label = (p: Product) => t(p === 'crm' ? 'adm.prod.crm' : 'adm.prod.suite');
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Pill size="xs" tone={product === 'crm' ? 'accent' : 'default'}>{label(product)}</Pill>
      {extra.map((p) => <Pill key={p} size="xs" tone="pos" title={t('adm.prod.addedTitle')}>+ {label(p)}</Pill>)}
    </span>
  );
}

export function AccountProductsButton({ account, onChanged }: { account: AccountRef; onChanged?: () => void }) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState<{ events: ProductEvent[]; open_invites: OpenInvite[] } | null>(null);

  const scopeKey = account.venueId ? `venue:${account.venueId}` : `org:${account.organizerUserId}`;
  const missing: Product | null = account.product === 'crm'
    ? (account.extra.includes('suite') ? null : 'suite')
    : (account.extra.includes('crm') ? null : 'crm');
  const productLabel = (p: Product) => t(p === 'crm' ? 'adm.prod.crm' : 'adm.prod.suite');

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_account_products' as never, { p_scope_keys: [scopeKey] } as never);
    if (!error) setHistory(data as unknown as { events: ProductEvent[]; open_invites: OpenInvite[] });
  }, [scopeKey]);
  useEffect(() => { if (open) void loadHistory(); }, [open, loadHistory]);

  const invite = async () => {
    if (!missing) return;
    setBusy('invite');
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
      body: { action: 'invite-product', product: missing, venueId: account.venueId ?? null, organizerUserId: account.venueId ? null : account.organizerUserId },
    });
    setBusy(null);
    const err = error?.message ?? (data as { error?: string })?.error;
    if (err) { toast.error(err.includes('already_has_product') ? t('adm.prod.already') : err); return; }
    const d = data as { emailSent?: boolean; email?: string };
    if (d?.emailSent) toast.success(t('adm.prod.inviteSent').replace('{email}', d.email ?? ''));
    else toast.error(t('adm.prod.inviteNotSent'));
    void loadHistory();
  };

  const addNow = async () => {
    if (!missing) return;
    setBusy('add');
    const { error } = await supabase.rpc('admin_add_account_product' as never, {
      p_venue_id: account.venueId ?? null,
      p_organizer_user_id: account.venueId ? null : account.organizerUserId,
      p_product: missing,
    } as never);
    setBusy(null);
    setConfirmOpen(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('adm.prod.added').replace('{product}', productLabel(missing)));
    onChanged?.();
    setOpen(false);
  };

  return (
    <>
      <Btn size="sm" variant="subtle" icon={Layers} onClick={() => setOpen(true)} title={t('adm.prod.manage')} />
      <Modal open={open} onClose={() => setOpen(false)} title={t('adm.prod.title').replace('{name}', account.name)} subtitle={t('adm.prod.subtitle')}
        footer={<Btn onClick={() => setOpen(false)}>{t('adm.common.close')}</Btn>}>
        <div className="flex items-center justify-between gap-3 py-2">
          <span style={{ color: T2, fontSize: 13 }}>{t('adm.prod.current')}</span>
          <ProductPills product={account.product} extra={account.extra} />
        </div>

        {missing ? (
          <div className="rounded-xl p-3.5 mt-2" style={{ border: `1px solid ${F_BORDER}` }}>
            <div style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('adm.prod.openOther').replace('{product}', productLabel(missing))}</div>
            <div style={{ color: T3, fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>{t(missing === 'crm' ? 'adm.prod.crmHint' : 'adm.prod.suiteHint')}</div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Btn variant="primary" size="sm" icon={Mail} loading={busy === 'invite'} onClick={() => void invite()}>{t('adm.prod.invite')}</Btn>
              {confirmOpen
                ? <Btn variant="danger" size="sm" icon={Plus} loading={busy === 'add'} onClick={() => void addNow()}>{t('adm.prod.confirmAdd')}</Btn>
                : <Btn size="sm" icon={Plus} onClick={() => setConfirmOpen(true)}>{t('adm.prod.addNow')}</Btn>}
            </div>
          </div>
        ) : (
          <p style={{ color: T2, fontSize: 13, marginTop: 8 }}>{t('adm.prod.both')}</p>
        )}

        <div style={{ color: T2, fontSize: 12, fontWeight: 600, marginTop: 18 }}>{t('adm.prod.history')}</div>
        {!history ? <Spinner /> : (history.events.length === 0 && history.open_invites.length === 0) ? (
          <p style={{ color: T3, fontSize: 12, marginTop: 6 }}>{t('adm.prod.noHistory')}</p>
        ) : (
          <div className="mt-1">
            {history.open_invites.map((i) => (
              <div key={`inv-${i.created_at}`} className="py-2" style={{ borderBottom: `1px solid ${F_BORDER}`, color: T2, fontSize: 12.5 }}>
                {t('adm.prod.openInvite').replace('{product}', productLabel(i.product)).replace('{email}', i.email).replace('{d}', fmtDate(i.expires_at, language))}
              </div>
            ))}
            {history.events.map((e) => (
              <div key={`${e.action}-${e.created_at}`} className="py-2 flex justify-between gap-3" style={{ borderBottom: `1px solid ${F_BORDER}`, color: T2, fontSize: 12.5 }}>
                <span>{t(`adm.prod.ev.${e.action}.${e.via}`).replace('{product}', productLabel(e.product))}</span>
                <span style={{ color: T3 }}>{fmtDate(e.created_at, language)}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
