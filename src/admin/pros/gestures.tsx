/**
 * Les gestes de la fiche d'un pro, tous rebranchés sur leurs RPC existantes.
 * Chaque geste sensible passe par ReasonDialog : le motif part dans la RPC
 * (qui écrit le journal) ou, pour une RPC sans motif, dans admin_account_log.
 *
 *   club          : modifier, masquer / afficher, décommissionner, restaurer,
 *                   inviter un propriétaire, compte vitrine, supprimer maintenant
 *                   (gesturesMore.tsx, repris de l'ancienne liste Clubs)
 *   organisateur  : statut Association, renommer, retirer (gesturesMore.tsx)
 *   agence        : activer / désactiver
 *   tous          : produits (AccountProductsButton), demander l'accès assisté,
 *                   « Voir sa Console » (accès accordé seulement)
 *   CRM           : Yunits offerts, essai prolongé, gel d'envoi, accès SMS
 */
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, LogIn, MoreHorizontal, Pencil, Power, RotateCcw, ShieldQuestion, Store, Trash2, UserPlus, UserX } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { setSupportSession } from '@/lib/supportSession';
import { AccountProductsButton, normalizeProducts } from './AccountProducts';
import { Dialog, Field, ReasonDialog, useAdminT } from '@/admin/ui';
import { consoleLanding } from './accounts';
import { useProsRefresh, type AccountCard } from './data';
import { OwnerInviteDialog, PurgeVenueDialog, RemoveOrgDialog, RenameOrgDialog, ShowcaseVenueDialog } from './gesturesMore';

type Open = null | 'edit' | 'hide' | 'show' | 'decommission' | 'restore' | 'assoc' | 'agency' | 'support' | 'console'
  | 'owner' | 'showcase' | 'purge' | 'rename' | 'remove';

async function edgeError(error: unknown, data: unknown): Promise<string | null> {
  const d = data as { error?: string } | null;
  if (d?.error) return d.error;
  if (!error) return null;
  try {
    const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
    if (body?.error) return body.error;
  } catch { /* corps non JSON */ }
  return (error as Error).message ?? 'error';
}

export function AccountGestures({ card }: { card: AccountCard }) {
  const { t } = useAdminT();
  const refresh = useProsRefresh();
  const [open, setOpen] = useState<Open>(null);
  const [menu, setMenu] = useState(false);
  const id = card.identity;
  const row = card.row;
  const ownerId = card.owner?.id ?? null;
  const activeGrant = card.support.grants.find((g) => g.status === 'active' && !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date()));
  const pendingGrant = card.support.grants.find((g) => g.status === 'pending' && !g.revoked_at);
  const close = (v: boolean) => { if (!v) setOpen(null); };
  const done = (msg: string) => { toast.success(msg); void refresh(); };

  const log = (action: string, reason: string, meta: Record<string, unknown> = {}) =>
    rpc('admin_account_log', { p_key: card.key, p_action: action, p_reason: reason, p_meta: meta });

  const items: { key: Open; label: string; icon: ReactNode; danger?: boolean }[] = [];
  if (card.kind === 'venue') {
    items.push({ key: 'edit', label: t('adm.pros.g.edit'), icon: <Pencil className="h-4 w-4" /> });
    if (!id.decommissioned_at) {
      items.push(id.is_hidden
        ? { key: 'show', label: t('adm.pros.g.show'), icon: <Eye className="h-4 w-4" /> }
        : { key: 'hide', label: t('adm.pros.g.hide'), icon: <EyeOff className="h-4 w-4" /> });
      if (!card.owner) {
        items.push({ key: 'owner', label: t('adm.pros.gx.owner'), icon: <UserPlus className="h-4 w-4" /> });
        items.push({ key: 'showcase', label: t('adm.pros.gx.showcase'), icon: <Store className="h-4 w-4" /> });
      }
      items.push({ key: 'decommission', label: t('adm.pros.g.decommission'), icon: <Trash2 className="h-4 w-4" />, danger: true });
    } else {
      items.push({ key: 'restore', label: t('adm.pros.g.restore'), icon: <RotateCcw className="h-4 w-4" /> });
      items.push({ key: 'purge', label: t('adm.pros.gx.purge'), icon: <Trash2 className="h-4 w-4" />, danger: true });
    }
  }
  if (card.kind === 'org') {
    items.push({ key: 'assoc', label: t(id.association ? 'adm.pros.g.assocOff' : 'adm.pros.g.assocOn'), icon: <Power className="h-4 w-4" /> });
    items.push({ key: 'rename', label: t('adm.pros.gx.rename'), icon: <Pencil className="h-4 w-4" /> });
    items.push({ key: 'remove', label: t('adm.pros.gx.remove'), icon: <UserX className="h-4 w-4" />, danger: true });
  }
  if (card.kind === 'agency') items.push({ key: 'agency', label: t(id.is_active === false ? 'adm.pros.g.agencyOn' : 'adm.pros.g.agencyOff'), icon: <Power className="h-4 w-4" />, danger: id.is_active !== false });

  const prods = card.kind !== 'agency' ? normalizeProducts(id.product, id.extra_products) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {prods && (
        <AccountProductsButton
          account={{ venueId: card.kind === 'venue' ? card.ref : null, organizerUserId: card.kind === 'org' ? card.ref : null, name: String(id.name ?? ''), product: prods.product, extra: prods.extra }}
          onChanged={() => void refresh()} />
      )}
      {ownerId && (activeGrant
        ? <button type="button" className="a-btn a-btn--primary" onClick={() => setOpen('console')}><LogIn className="h-4 w-4" />{t('adm.pros.g.console')}</button>
        : <button type="button" className="a-btn" onClick={() => setOpen('support')} disabled={!!pendingGrant} title={pendingGrant ? t('adm.pros.g.supportPending') : undefined}>
            <ShieldQuestion className="h-4 w-4" />{t(pendingGrant ? 'adm.pros.g.supportPending' : 'adm.pros.g.support')}
          </button>)}
      {items.length > 0 && (
        <div className="relative">
          <button type="button" className="a-btn a-btn--icon" aria-label={t('adm.pros.g.more')} aria-expanded={menu} onClick={() => setMenu((v) => !v)}><MoreHorizontal className="h-4 w-4" /></button>
          {menu && (
            <div role="menu" className="a-card absolute right-0 z-[40] mt-1 flex min-w-[220px] flex-col p-1" style={{ boxShadow: 'var(--a-shadow-pop)' }}
              onMouseLeave={() => setMenu(false)}>
              {items.map((it) => (
                <button key={String(it.key)} type="button" role="menuitem" className="a-btn a-btn--ghost justify-start"
                  style={it.danger ? { color: 'var(--a-neg)' } : undefined}
                  onClick={() => { setMenu(false); setOpen(it.key); }}>
                  {it.icon}{it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {card.kind === 'venue' && <EditVenueDialog card={card} open={open === 'edit'} onOpenChange={close} onDone={() => done(t('adm.pros.g.saved'))} />}
      {card.kind === 'venue' && <OwnerInviteDialog card={card} open={open === 'owner'} onOpenChange={close} />}
      {card.kind === 'venue' && open === 'showcase' && <ShowcaseVenueDialog card={card} onClose={() => setOpen(null)} />}
      {card.kind === 'venue' && <PurgeVenueDialog card={card} open={open === 'purge'} onOpenChange={close} />}
      {card.kind === 'org' && <RenameOrgDialog key={String(id.name ?? '')} card={card} open={open === 'rename'} onOpenChange={close} />}
      {card.kind === 'org' && <RemoveOrgDialog card={card} open={open === 'remove'} onOpenChange={close} />}

      <ReasonDialog open={open === 'hide' || open === 'show'} onOpenChange={close}
        title={t(open === 'show' ? 'adm.pros.g.show' : 'adm.pros.g.hide')} description={t(open === 'show' ? 'adm.pros.g.showBody' : 'adm.pros.g.hideBody')}
        onConfirm={async (reason) => { await rpc('admin_account_set_flag', { p_key: card.key, p_flag: 'hidden', p_value: open === 'hide', p_reason: reason }); done(t('adm.pros.g.saved')); }} />

      <ReasonDialog open={open === 'decommission'} onOpenChange={close} tone="danger"
        title={t('adm.pros.g.decommission')} description={t('adm.pros.g.decommissionBody')}
        onConfirm={async (reason) => {
          const { error } = await supabase.rpc('admin_decommission_venue', { _venue_id: card.ref });
          if (error) throw error;
          await log('decommission', reason);
          done(t('adm.pros.g.saved'));
        }} />

      <ReasonDialog open={open === 'restore'} onOpenChange={close}
        title={t('adm.pros.g.restore')} description={t('adm.pros.g.restoreBody')}
        onConfirm={async (reason) => {
          const { error } = await supabase.rpc('admin_restore_venue', { _venue_id: card.ref });
          if (error) throw error;
          await log('restore', reason);
          done(t('adm.pros.g.saved'));
        }} />

      <ReasonDialog open={open === 'assoc'} onOpenChange={close}
        title={t(id.association ? 'adm.pros.g.assocOff' : 'adm.pros.g.assocOn')} description={t('adm.pros.g.assocBody')}
        onConfirm={async (reason) => {
          await rpc('admin_set_organizer_bde_verified', { p_organizer_user_id: card.ref, p_verified: !id.association, p_reason: reason });
          done(t('adm.pros.g.saved'));
        }} />

      <ReasonDialog open={open === 'agency'} onOpenChange={close} tone={id.is_active === false ? 'primary' : 'danger'}
        title={t(id.is_active === false ? 'adm.pros.g.agencyOn' : 'adm.pros.g.agencyOff')} description={t('adm.pros.g.agencyBody')}
        onConfirm={async (reason) => { await rpc('admin_account_set_flag', { p_key: card.key, p_flag: 'active', p_value: id.is_active === false, p_reason: reason }); done(t('adm.pros.g.saved')); }} />

      <ReasonDialog open={open === 'support'} onOpenChange={close}
        title={t('adm.pros.g.support')} description={t('adm.pros.g.supportBody', { name: card.owner?.name ?? card.owner?.email ?? '' })}
        confirmLabel={t('adm.pros.g.supportSend')}
        onConfirm={async (reason) => {
          // Un compte CRM seul reçoit l'e-mail et la Console du CRM (comme l'ex-Admin CRM).
          const crmOnly = !!row && !row.products.includes('tickets');
          const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'request-support-access', userId: ownerId, reason, ...(crmOnly ? { product: 'crm' } : {}) } });
          const err = await edgeError(error, data);
          if (err) throw new Error(err);
          const r = data as { emailSent?: boolean; already_active?: boolean } | null;
          done(t(r?.already_active ? 'adm.pros.g.supportAlready' : 'adm.pros.g.supportSent'));
        }} />

      {activeGrant && row && (
        <OpenConsoleDialog open={open === 'console'} onOpenChange={close} grantId={activeGrant.id}
          name={String(id.name ?? '')} landing={consoleLanding(row)} />
      )}
    </div>
  );
}

function OpenConsoleDialog({ open, onOpenChange, grantId, name, landing }: { open: boolean; onOpenChange: (v: boolean) => void; grantId: string; name: string; landing: string }) {
  const { t } = useAdminT();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'open-support-session', grantId } });
      const err = await edgeError(error, data);
      if (err || !data?.access_token || !data?.refresh_token) throw new Error(err ?? 'open_failed');
      // Le drapeau AVANT setSession, pour que la bannière soit là au premier rendu.
      setSupportSession({ sessionId: data.session_id, targetUserId: data.target_user_id, targetName: data.target_name || name, expiresAt: data.expires_at });
      const { error: e2 } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (e2) throw e2;
      window.location.href = landing;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('adm.pros.g.consoleFailed'));
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('adm.pros.g.consoleTitle', { name })} description={t('adm.pros.g.consoleBody')}
      confirmLabel={t('adm.pros.g.console')} onConfirm={() => void go()} busy={busy} />
  );
}

/** Modifier un club (nom, ville, adresse) : comme l'ancienne liste, adresse géocodée. */
function EditVenueDialog({ card, open, onOpenChange, onDone }: { card: AccountCard; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { t } = useAdminT();
  const [name, setName] = useState(String(card.identity.name ?? ''));
  const [city, setCity] = useState(String(card.identity.city ?? ''));
  const [address, setAddress] = useState(String(card.identity.address ?? ''));
  const changed = name.trim() !== String(card.identity.name ?? '') || city.trim() !== String(card.identity.city ?? '') || address.trim() !== String(card.identity.address ?? '');
  return (
    <ReasonDialog open={open} onOpenChange={onOpenChange} title={t('adm.pros.g.edit')} description={t('adm.pros.g.editBody')}
      confirmLabel={t('adm.pros.g.save')}
      onConfirm={async (reason) => {
        if (!changed || !name.trim() || !city.trim()) throw new Error(t('adm.pros.g.editMissing'));
        const patch: Record<string, unknown> = { name: name.trim(), city: city.trim(), address: address.trim() || null };
        if (address.trim() && address.trim() !== String(card.identity.address ?? '')) {
          const { data } = await supabase.functions.invoke('geocode-address', { body: { address: address.trim() } });
          if (data?.latitude && data?.longitude) { patch.latitude = data.latitude; patch.longitude = data.longitude; }
        }
        const { error } = await supabase.from('venues').update(patch as never).eq('id', card.ref);
        if (error) throw error;
        await rpc('admin_account_log', { p_key: card.key, p_action: 'edit', p_reason: reason, p_meta: { name: patch.name, city: patch.city } });
        onDone();
      }}>
      <div className="flex flex-col gap-3">
        <Field label={t('adm.pros.f.name')}><input className="a-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('adm.pros.f.city')}><input className="a-input" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label={t('adm.pros.f.address')}><input className="a-input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      </div>
    </ReasonDialog>
  );
}

// ── Gestes du CRM (onglet CRM) ──────────────────────────────────────────────
export function CrmGestures({ card }: { card: AccountCard }) {
  const { t } = useAdminT();
  const refresh = useProsRefresh();
  const [open, setOpen] = useState<null | 'yunits' | 'trial' | 'freeze' | 'unfreeze'>(null);
  const [amount, setAmount] = useState('2000');
  const [days, setDays] = useState('7');
  const acc = card.crm?.account;
  if (!acc) return null;
  const frozen = !!acc.frozen_at;
  const close = (v: boolean) => { if (!v) setOpen(null); };
  const done = () => { toast.success(t('adm.pros.g.saved')); void refresh(); };
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="a-btn" onClick={() => setOpen('yunits')}>{t('adm.pros.crm.g.yunits')}</button>
      {acc.state === 'trial' && !acc.paid && <button type="button" className="a-btn" onClick={() => setOpen('trial')}>{t('adm.pros.crm.g.trial')}</button>}
      <button type="button" className="a-btn" style={frozen ? undefined : { color: 'var(--a-neg)' }} onClick={() => setOpen(frozen ? 'unfreeze' : 'freeze')}>
        {t(frozen ? 'adm.pros.crm.g.unfreeze' : 'adm.pros.crm.g.freeze')}
      </button>

      <ReasonDialog open={open === 'yunits'} onOpenChange={close} title={t('adm.pros.crm.g.yunits')} description={t('adm.pros.crm.g.yunitsBody')}
        onConfirm={async (reason) => {
          const n = Number.parseInt(amount, 10);
          if (!Number.isFinite(n) || n <= 0) throw new Error(t('adm.pros.crm.g.badAmount'));
          await rpc('crm_admin_grant_yunits', { p_scope_key: card.key, p_amount: n, p_reason: reason });
          done();
        }}>
        <Field label={t('adm.pros.crm.g.amount')}><input className="a-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </ReasonDialog>

      <ReasonDialog open={open === 'trial'} onOpenChange={close} title={t('adm.pros.crm.g.trial')}
        description={t('adm.pros.crm.g.trialBody', { used: card.crm?.trial_ext.used ?? 0, free: card.crm?.trial_ext.free ?? 0 })}
        onConfirm={async (reason) => {
          const n = Number.parseInt(days, 10);
          if (!Number.isFinite(n) || n <= 0 || n > 60) throw new Error(t('adm.pros.crm.g.badDays'));
          await rpc('crm_admin_extend_trial', { p_scope_key: card.key, p_days: n, p_reason: reason });
          done();
        }}>
        <Field label={t('adm.pros.crm.g.days')}><input className="a-input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      </ReasonDialog>

      <ReasonDialog open={open === 'freeze' || open === 'unfreeze'} onOpenChange={close} tone={open === 'freeze' ? 'danger' : 'primary'}
        title={t(open === 'freeze' ? 'adm.pros.crm.g.freeze' : 'adm.pros.crm.g.unfreeze')}
        description={t(open === 'freeze' ? 'adm.pros.crm.g.freezeBody' : 'adm.pros.crm.g.unfreezeBody')}
        onConfirm={async (reason) => { await rpc('crm_admin_freeze', { p_scope_key: card.key, p_frozen: open === 'freeze', p_reason: reason }); done(); }} />
    </div>
  );
}
