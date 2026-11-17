import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Gift, Layers, Loader2, Mail, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge, Drawer, useAdminT } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';

/**
 * Les produits d'un compte (Billetterie, CRM) et l'ouverture de l'autre
 * (migration 20261006100000) : pastilles et un tiroir de la fiche d'un pro
 * (Pros), avec de quoi pour inviter le titulaire par email (style Yuno CRM, edge
 * admin-account-recovery → invite-product), ouvrir directement, ou OFFRIR
 * Yuno CRM : socle accordé sans abonnement ni date de fin
 * (`admin_grant_crm_plan(scope, 'base', null)`), Yunits du mois compris —
 * pour les comptes de Yuno et les partenaires, jamais pour un client qui paie.
 * Le don se lit dans `admin_account_products().crm` et s'écrit dans
 * l'historique + l'audit (migration 20261018195500) : rouverte, la fenêtre dit
 * qui l'a offert et quand.
 */

export type Product = 'suite' | 'crm';

export interface AccountRef {
  venueId?: string | null;
  organizerUserId?: string | null;
  name: string;
  product: Product;
  extra: Product[];
}

interface ProductEvent { scope_key: string; product: Product; action: 'added' | 'invited' | 'gifted' | 'grant_ended'; via: string; email: string | null; created_at: string }
interface OpenInvite { scope_key: string; product: Product; email: string; created_at: string; expires_at: string }

/** L'abonnement CRM d'une portée, tel que le rend `admin_account_products`. */
export interface CrmState {
  status: string;
  plan: string;
  stripe: boolean;
  /** Actif sans abonnement Stripe (la règle de get_crm_billing). */
  granted: boolean;
  /** Offre datée échue : le CRM est en pause. */
  expired: boolean;
  granted_by: string | null;
  granted_by_name: string | null;
  granted_at: string | null;
  until: string | null;
  trial_ends_at: string | null;
  yunits: number;
}
interface ProductsData { events: ProductEvent[]; open_invites: OpenInvite[]; crm?: Record<string, CrmState> }

/** Un don en cours : offert, pas échu. */
export const isCrmGifted = (s: CrmState | null | undefined): boolean => !!s?.granted && !s.expired;

export function normalizeProducts(product: unknown, extra: unknown): { product: Product; extra: Product[] } {
  const p: Product = product === 'crm' ? 'crm' : 'suite';
  const e = Array.isArray(extra) ? extra.filter((x): x is Product => (x === 'crm' || x === 'suite') && x !== p) : [];
  return { product: p, extra: e };
}

function ProductPills({ product, extra }: { product: Product; extra: Product[] }) {
  const { t } = useAdminT();
  const label = (p: Product) => t(p === 'crm' ? 'adm.prod.crm' : 'adm.prod.suite');
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={product === 'crm' ? 'accent' : 'neutral'}>{label(product)}</Badge>
      {extra.map((p) => <Badge key={p} tone="positive">+ {label(p)}</Badge>)}
    </span>
  );
}

export function AccountProductsButton({ account, onChanged }: { account: AccountRef; onChanged?: () => void }) {
  const { t, lang: language } = useAdminT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmGift, setConfirmGift] = useState(false);
  const [history, setHistory] = useState<ProductsData | null>(null);

  const scopeKey = account.venueId ? `venue:${account.venueId}` : `org:${account.organizerUserId}`;
  const missing: Product | null = account.product === 'crm'
    ? (account.extra.includes('suite') ? null : 'suite')
    : (account.extra.includes('crm') ? null : 'crm');
  const productLabel = (p: Product) => t(p === 'crm' ? 'adm.prod.crm' : 'adm.prod.suite');
  const hasCrm = account.product === 'crm' || account.extra.includes('crm');

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_account_products' as never, { p_scope_keys: [scopeKey] } as never);
    if (!error) setHistory(data as unknown as ProductsData);
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

  /** Offrir Yuno CRM : l'ouvrir s'il manque, puis l'accorder sans fin. */
  const gift = async () => {
    setBusy('gift');
    if (!hasCrm) {
      const { error } = await supabase.rpc('admin_add_account_product' as never, {
        p_venue_id: account.venueId ?? null,
        p_organizer_user_id: account.venueId ? null : account.organizerUserId,
        p_product: 'crm',
      } as never);
      if (error) { setBusy(null); setConfirmGift(false); toast.error(error.message); return; }
    }
    const { error } = await supabase.rpc('admin_grant_crm_plan' as never, {
      p_scope_key: scopeKey, p_plan: 'base', p_until: null,
    } as never);
    setBusy(null);
    setConfirmGift(false);
    if (error) {
      toast.error(error.message.includes('has_stripe_subscription') ? t('adm.prod.giftHasStripe') : error.message);
      if (!hasCrm) onChanged?.();
      return;
    }
    toast.success(t('adm.prod.gifted').replace('{name}', account.name));
    // La fenêtre reste ouverte : elle dit tout de suite « Offert le … ».
    onChanged?.();
    void loadHistory();
  };

  const spin = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  const giftButton = confirmGift
    ? <button type="button" className="a-btn a-btn--danger a-btn--sm" disabled={busy === 'gift'} onClick={() => void gift()}>{busy === 'gift' ? spin : <Gift className="h-3.5 w-3.5" />}{t('adm.prod.confirmGift')}</button>
    : <button type="button" className="a-btn a-btn--sm" onClick={() => setConfirmGift(true)}><Gift className="h-3.5 w-3.5" />{t('adm.prod.gift')}</button>;
  const loading = <div className="mt-2 flex flex-col gap-2"><div className="a-skel h-4 w-2/3" /><div className="a-skel h-4 w-1/2" /></div>;

  const crm = history?.crm?.[scopeKey] ?? null;
  const gifted = isCrmGifted(crm);
  const paysStripe = !!crm?.stripe && ['trialing', 'active', 'past_due'].includes(crm.status);
  const giftedLine = (s: CrmState) => {
    const until = s.until ? fmtDate(s.until, language) : null;
    const key = s.granted_by_name
      ? (until ? 'adm.prod.giftedByUntil' : 'adm.prod.giftedBy')
      : (until ? 'adm.prod.giftedUntil' : 'adm.prod.giftedOn');
    return t(key).replace('{d}', fmtDate(s.granted_at, language)).replace('{name}', s.granted_by_name ?? '').replace('{until}', until ?? '');
  };

  return (
    <>
      <button type="button" className="a-btn" onClick={() => setOpen(true)} title={t('adm.prod.manage')}><Layers className="h-4 w-4" />{t('adm.prod.manage')}</button>
      <Drawer open={open} onOpenChange={setOpen} title={t('adm.prod.title').replace('{name}', account.name)} description={t('adm.prod.subtitle')}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="a-t2 text-[13px]">{t('adm.prod.current')}</span>
            <ProductPills product={account.product} extra={account.extra} />
          </div>

          {missing ? (
            <div className="a-card p-4">
              <div className="a-t1 text-[14px] font-semibold">{t('adm.prod.openOther').replace('{product}', productLabel(missing))}</div>
              <p className="a-t3 mt-1 text-[12.5px] leading-relaxed">{t(missing === 'crm' ? 'adm.prod.crmHint' : 'adm.prod.suiteHint')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={busy === 'invite'} onClick={() => void invite()}>{busy === 'invite' ? spin : <Mail className="h-3.5 w-3.5" />}{t('adm.prod.invite')}</button>
                {confirmOpen
                  ? <button type="button" className="a-btn a-btn--danger a-btn--sm" disabled={busy === 'add'} onClick={() => void addNow()}>{busy === 'add' ? spin : <Plus className="h-3.5 w-3.5" />}{t('adm.prod.confirmAdd')}</button>
                  : <button type="button" className="a-btn a-btn--sm" onClick={() => setConfirmOpen(true)}><Plus className="h-3.5 w-3.5" />{t('adm.prod.addNow')}</button>}
                {missing === 'crm' && giftButton}
              </div>
              {missing === 'crm' && <p className="a-t3 mt-2 text-[12px] leading-relaxed">{t('adm.prod.giftHint')}</p>}
            </div>
          ) : (
            <p className="a-t2 text-[13px]">{t('adm.prod.both')}</p>
          )}

          {hasCrm && (
            <div className="a-card p-4">
              <div className="a-t1 text-[14px] font-semibold">{t('adm.prod.giftTitle')}</div>
              {!history ? loading : gifted && crm ? (
                <>
                  <p className="a-t2 mt-1 text-[12.5px] leading-relaxed">{giftedLine(crm)}</p>
                  <p className="a-t3 mt-0.5 text-[12px]">{t('adm.prod.yunits').replace('{n}', fmtNum(crm.yunits, language))}</p>
                  <div className="mt-3"><Badge tone="positive"><Gift className="h-3.5 w-3.5" />{t('adm.prod.alreadyGifted')}</Badge></div>
                </>
              ) : paysStripe ? (
                <p className="a-t3 mt-1 text-[12px] leading-relaxed">{t('adm.prod.giftHasStripe')}</p>
              ) : (
                <>
                  {crm?.expired && <p className="a-t2 mt-1 text-[12.5px] leading-relaxed">{t('adm.prod.giftExpired').replace('{d}', fmtDate(crm.until, language))}</p>}
                  <p className="a-t3 mt-1 text-[12px] leading-relaxed">{t('adm.prod.giftHint')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">{giftButton}</div>
                </>
              )}
            </div>
          )}

          <section className="flex flex-col gap-1">
            <h3 className="a-t1 text-[14px] font-semibold">{t('adm.prod.history')}</h3>
            {!history ? loading : (history.events.length === 0 && history.open_invites.length === 0) ? (
              <p className="a-t3 text-[12.5px]">{t('adm.prod.noHistory')}</p>
            ) : (
              <ul>
                {history.open_invites.map((i) => (
                  <li key={`inv-${i.created_at}`} className="a-t2 border-b py-2 text-[12.5px]">
                    {t('adm.prod.openInvite').replace('{product}', productLabel(i.product)).replace('{email}', i.email).replace('{d}', fmtDate(i.expires_at, language))}
                  </li>
                ))}
                {history.events.map((e) => (
                  <li key={`${e.action}-${e.created_at}`} className="a-t2 flex justify-between gap-3 border-b py-2 text-[12.5px] last:border-b-0">
                    <span>{t(`adm.prod.ev.${e.action}.${e.via}`).replace('{product}', productLabel(e.product))}</span>
                    <span className="a-t3 whitespace-nowrap">{fmtDate(e.created_at, language)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Drawer>
    </>
  );
}
