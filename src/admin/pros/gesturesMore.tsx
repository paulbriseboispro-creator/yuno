/**
 * Gestes repris des anciennes listes Clubs et Organisateurs (supprimées le
 * 17/11), posés sur la fiche d'un pro. Mêmes appels qu'avant, plus un motif
 * écrit au journal (admin_account_log) pour chaque geste sensible :
 *   club sans propriétaire : inviter un propriétaire (invite-owner) ou créer
 *                            un lien d'accès (accept-staff-invitation),
 *                            compte vitrine et lien builder (create-showcase-owner) ;
 *   club décommissionné    : suppression immédiate (admin_purge_venue) ;
 *   organisateur           : renommer (profiles + organizer_profiles), retirer
 *                            (admin_delete_organizer).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { fmtDate } from '@/lib/adminFormat';
import { ReasonDialog, useAdminT } from '@/admin/ui';
import { Field } from './gestures';
import { useProsRefresh, type AccountCard } from './data';
import { invokeEdge } from './demo/data';
import { Seg } from './demo/fields';
import { BuilderLinkDialog } from './demo/Showcases';

interface Props { card: AccountCard; open: boolean; onOpenChange: (v: boolean) => void }

const log = (card: AccountCard, action: string, reason: string, meta: Record<string, unknown> = {}) =>
  rpc('admin_account_log', { p_key: card.key, p_action: action, p_reason: reason, p_meta: meta });

/** Le nom recopié à l'identique : la dernière barrière avant un geste sans retour. */
function TypeName({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  const { t } = useAdminT();
  return (
    <Field label={t('adm.pros.gx.typeName', { name })}>
      <input className="a-input" value={value} placeholder={name} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

// ── Club : propriétaire ─────────────────────────────────────────────────────
interface PendingOwner { email: string; token: string; expires_at: string }

export function OwnerInviteDialog({ card, open, onOpenChange }: Props) {
  const { t, lang } = useAdminT();
  const refresh = useProsRefresh();
  const name = String(card.identity.name ?? card.ref);
  const [mode, setMode] = useState<'email' | 'link'>('email');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<PendingOwner | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void supabase.from('owner_invitations').select('email, token, expires_at').eq('venue_id', card.ref).is('accepted_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { const p = data as PendingOwner | null; setPending(p); if (p) setEmail((e) => e || p.email); });
  }, [open, card.ref]);
  const copy = (url: string) => { void navigator.clipboard?.writeText(url).then(() => toast.success(t('adm.pros.inv.copied'))); };
  return (
    <ReasonDialog open={open} onOpenChange={(v) => { if (!v) { setLink(null); setMode('email'); } onOpenChange(v); }}
      title={t('adm.pros.gx.owner')} description={t('adm.pros.gx.ownerBody', { name })} confirmLabel={t(mode === 'email' ? 'adm.pros.inv.send' : 'adm.pros.gx.ownerLinkCreate')}
      onConfirm={async (reason) => {
        if (mode === 'email') {
          if (!email.trim()) throw new Error(t('adm.pros.g.editMissing'));
          const d = await invokeEdge<{ user_exists?: boolean }>('invite-owner', { email: email.trim(), venue_id: card.ref, venue_name: name });
          await log(card, 'invite_owner', reason, { email: email.trim(), assigned: !!d.user_exists });
          toast.success(t(d.user_exists ? 'adm.pros.inv.ownerAssigned' : 'adm.pros.inv.sent', { email: email.trim() }));
        } else {
          const d = await invokeEdge<{ url?: string }>('accept-staff-invitation', { action: 'create_onboarding_link', role: 'owner', venue_id: card.ref });
          await log(card, 'owner_link', reason);
          if (typeof d.url === 'string') { copy(d.url); setLink(d.url); }
        }
        void refresh();
      }}>
      <div className="flex flex-col gap-3">
        {pending && (
          <div className="a-subtle flex flex-wrap items-center gap-2 rounded-lg p-2.5 text-[12.5px]">
            <span className="a-t2 min-w-0 flex-1">{t('adm.pros.gx.ownerPending', { email: pending.email, date: fmtDate(pending.expires_at, lang) })}</span>
            <button type="button" className="a-btn a-btn--sm" onClick={() => copy(`${window.location.origin}/auth?invite=${encodeURIComponent(pending.token)}`)}><Copy className="h-3.5 w-3.5" />{t('adm.pros.iv.copyLink')}</button>
          </div>
        )}
        <Seg<'email' | 'link'> label={t('adm.pros.gx.owner')} value={mode} onChange={setMode}
          options={[{ v: 'email', label: t('adm.pros.gx.ownerByEmail') }, { v: 'link', label: t('adm.pros.gx.ownerByLink') }]} />
        {mode === 'email'
          ? <Field label={t('adm.pros.inv.ownerEmail')} hint={t('adm.pros.gx.ownerEmailHint')}><input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          : <p className="a-t3 text-[12px]">{t('adm.pros.gx.ownerLinkHint')}</p>}
        {link && <p className="a-mono a-t2 break-all text-[12px]">{link}</p>}
      </div>
    </ReasonDialog>
  );
}

/** Compte vitrine d'un club sans propriétaire : le fantôme existe-t-il déjà ? son e-mail sert au lien builder. */
export function ShowcaseVenueDialog({ card, onClose }: { card: AccountCard; onClose: () => void }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('venues').select('showcase_shadow_owner_id').eq('id', card.ref).maybeSingle();
      const shadow = (data as { showcase_shadow_owner_id?: string | null } | null)?.showcase_shadow_owner_id ?? null;
      if (!shadow) { setEmail(null); return; }
      const { data: p } = await supabase.from('profiles').select('email').eq('id', shadow).maybeSingle();
      setEmail((p as { email?: string | null } | null)?.email ?? null);
    })();
  }, [card.ref]);
  if (email === undefined) return null;
  return <BuilderLinkDialog row={{ id: card.ref, name: String(card.identity.name ?? card.ref), email }} onClose={onClose} />;
}

// ── Club : suppression immédiate ────────────────────────────────────────────
export function PurgeVenueDialog({ card, open, onOpenChange }: Props) {
  const { t } = useAdminT();
  const navigate = useNavigate();
  const refresh = useProsRefresh();
  const name = String(card.identity.name ?? card.ref);
  const [typed, setTyped] = useState('');
  return (
    <ReasonDialog open={open} onOpenChange={(v) => { if (!v) setTyped(''); onOpenChange(v); }} tone="danger"
      title={t('adm.pros.gx.purge')} description={t('adm.pros.gx.purgeBody', { name })} confirmLabel={t('adm.pros.gx.purge')}
      onConfirm={async (reason) => {
        if (typed !== name) throw new Error(t('adm.pros.gx.typeMismatch'));
        await log(card, 'purge', reason);
        const { error } = await supabase.rpc('admin_purge_venue', { _venue_id: card.ref });
        if (error) throw error;
        toast.success(t('adm.pros.gx.purged', { name }));
        void refresh();
        navigate('/admin/pros', { replace: true });
      }}>
      <TypeName name={name} value={typed} onChange={setTyped} />
    </ReasonDialog>
  );
}

// ── Organisateur ────────────────────────────────────────────────────────────
export function RenameOrgDialog({ card, open, onOpenChange }: Props) {
  const { t } = useAdminT();
  const refresh = useProsRefresh();
  const current = String(card.identity.name ?? '');
  const [name, setName] = useState(current);
  return (
    <ReasonDialog open={open} onOpenChange={onOpenChange} title={t('adm.pros.gx.rename')} description={t('adm.pros.gx.renameBody')} confirmLabel={t('adm.pros.g.save')}
      onConfirm={async (reason) => {
        const next = name.trim();
        if (!next || next === current) throw new Error(t('adm.pros.g.editMissing'));
        const { error } = await supabase.from('profiles').update({ organization_name: next } as never).eq('id', card.ref);
        if (error) throw error;
        const { error: e2 } = await supabase.from('organizer_profiles').update({ display_name: next } as never).eq('user_id', card.ref);
        if (e2) throw e2;
        await log(card, 'rename', reason, { from: current, to: next });
        toast.success(t('adm.pros.g.saved'));
        void refresh();
      }}>
      <Field label={t('adm.pros.f.name')}><input className="a-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </ReasonDialog>
  );
}

export function RemoveOrgDialog({ card, open, onOpenChange }: Props) {
  const { t } = useAdminT();
  const navigate = useNavigate();
  const refresh = useProsRefresh();
  const name = String(card.identity.name ?? card.ref);
  const [typed, setTyped] = useState('');
  return (
    <ReasonDialog open={open} onOpenChange={(v) => { if (!v) setTyped(''); onOpenChange(v); }} tone="danger"
      title={t('adm.pros.gx.remove')} description={t('adm.pros.gx.removeBody', { name })} confirmLabel={t('adm.pros.gx.remove')}
      onConfirm={async (reason) => {
        if (typed !== name) throw new Error(t('adm.pros.gx.typeMismatch'));
        await log(card, 'remove_organizer', reason);
        const { error } = await supabase.rpc('admin_delete_organizer', { _user_id: card.ref });
        if (error) throw error;
        toast.success(t('adm.pros.gx.removed', { name }));
        void refresh();
        navigate('/admin/pros', { replace: true });
      }}>
      <TypeName name={name} value={typed} onChange={setTyped} />
    </ReasonDialog>
  );
}
