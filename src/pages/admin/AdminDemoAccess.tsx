// Fenêtre Super Admin : créer / gérer les liens d'aperçu (preview) démo.
//
// Chaque lien = 1 personne (ex. « Noah ») + 1 mot de passe qui lui est propre
// (ex. « el sorbo ») + 1 type de compte démo. On génère une URL /preview?token=…
// à envoyer ; le destinataire ouvre, saisit son mot de passe, et voit le dashboard
// démo en LECTURE SEULE.
//
// Liens VITRINE : un lien peut viser une venue vitrine précise (compte fantôme,
// voir migration 20260826100000) au lieu des comptes démo génériques — le
// prospect voit alors SA page publique + SON dashboard. La section « Demandes
// d'activation » liste les prospects qui ont cliqué « Activer mon compte » ;
// le bouton Inviter déclenche l'invitation propriétaire (invite-owner), dont
// l'acceptation transfère la venue sans rien perdre du contenu construit.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, KeyRound, Trash2, Copy, Ban, Eye, Check, Pencil, Rocket, Store } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ALL_TARGET_ACCOUNTS, DEMO_ACCOUNTS, type TargetAccount } from '@/lib/demoSession';

// ─── Yuno Design Tokens (miroir AdminPlatformInvitations) ─────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const TILE_BG    = 'rgba(255,255,255,0.025)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};
const cardStyle: React.CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18,
  boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden',
};
const rowStyle: React.CSSProperties = {
  background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12,
};
function pillStyle(color: string, bg: string, border: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
    borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg, border: `1px solid ${border}`,
  };
}
const iconBtn = (tone: 'neutral' | 'danger'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 32, width: 32, borderRadius: 8, flex: 'none', cursor: 'pointer',
  background: 'transparent', border: '1px solid transparent',
  color: tone === 'danger' ? NEG : T3, transition: 'all 0.15s',
});

const APP_BASE = (import.meta.env.VITE_APP_BASE_URL as string | undefined) ?? window.location.origin;
const previewUrl = (token: string) => `${APP_BASE}/preview?token=${token}`;

interface PreviewLink {
  id: string;
  token: string;
  label: string;
  target_accounts: TargetAccount[];
  language: string;
  is_active: boolean;
  expires_at: string | null;
  used_count: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  venues?: { name: string } | null;
}

interface ShowcaseVenue {
  id: string;
  name: string;
}

interface ShowcaseOrganizer {
  user_id: string;
  display_name: string;
}

interface ClaimRequest {
  id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  requested_email: string;
  created_at: string;
  updated_at: string;
  venues?: { name: string } | null;
}

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'Anglais (EN)' },
  { code: 'fr', label: 'Français (FR)' },
  { code: 'es', label: 'Espagnol (ES)' },
];

// Grille de sélection des dashboards accessibles — partagée entre la création
// d'un lien et l'édition des rôles d'un lien existant (une seule source de vérité).
function AccountPicker({ selected, onToggle }: { selected: TargetAccount[]; onToggle: (a: TargetAccount) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {ALL_TARGET_ACCOUNTS.map((a) => {
        const checked = selected.includes(a);
        return (
          <button
            key={a}
            type="button"
            onClick={() => onToggle(a)}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition"
            style={{
              background: checked ? 'rgba(232,25,44,0.12)' : INNER_BG,
              border: `1px solid ${checked ? 'rgba(232,25,44,0.4)' : BORDER}`,
              color: checked ? T1 : T2,
            }}
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
              style={{ background: checked ? RED : 'transparent', border: `1px solid ${checked ? RED : BORDER}` }}
            >
              {checked && <Check className="h-3 w-3 text-white" />}
            </span>
            {DEMO_ACCOUNTS[a].label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminDemoAccess() {
  const [links, setLinks] = useState<PreviewLink[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [accounts, setAccounts] = useState<TargetAccount[]>(['owner']);
  const [language, setLanguage] = useState('en');
  const [expiresAt, setExpiresAt] = useState('');
  // Lien vitrine : '' = lien démo classique, 'v:<id>' = club vitrine,
  // 'o:<uuid>' = organisateur vitrine.
  const [showcaseSel, setShowcaseSel] = useState('');
  const [showcaseVenues, setShowcaseVenues] = useState<ShowcaseVenue[]>([]);
  const [showcaseOrgs, setShowcaseOrgs] = useState<ShowcaseOrganizer[]>([]);
  const selVenueId = showcaseSel.startsWith('v:') ? showcaseSel.slice(2) : '';
  const selOrgId = showcaseSel.startsWith('o:') ? showcaseSel.slice(2) : '';
  const orgNameById = Object.fromEntries(showcaseOrgs.map((o) => [o.user_id, o.display_name]));

  // Demandes d'activation (CTA « Activer mon compte » des sessions vitrine).
  const [claims, setClaims] = useState<ClaimRequest[]>([]);
  const [inviteTarget, setInviteTarget] = useState<ClaimRequest | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [offerHelp, setOfferHelp] = useState(true);
  const [inviting, setInviting] = useState(false);

  const toggleAccount = (a: TargetAccount) =>
    setAccounts((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  // Edit accessible dashboards (roles) of an existing link
  const [editTarget, setEditTarget] = useState<PreviewLink | null>(null);
  const [editAccounts, setEditAccounts] = useState<TargetAccount[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const toggleEditAccount = (a: TargetAccount) =>
    setEditAccounts((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  const openEdit = (l: PreviewLink) => { setEditTarget(l); setEditAccounts(l.target_accounts ?? []); };

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<PreviewLink | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [linksRes, venuesRes, orgsRes, claimsRes] = await Promise.all([
      supabase
        .from('demo_preview_links' as any)
        .select('*, venues(name)')
        .order('created_at', { ascending: false }),
      supabase
        .from('venues' as any)
        .select('id, name')
        .not('showcase_shadow_owner_id', 'is', null)
        .order('name'),
      supabase
        .from('organizer_profiles' as any)
        .select('user_id, display_name')
        .eq('is_showcase_shadow', true)
        .order('display_name'),
      supabase
        .from('showcase_claim_requests' as any)
        .select('*, venues(name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ]);
    setLinks((linksRes.data ?? []) as unknown as PreviewLink[]);
    setShowcaseVenues((venuesRes.data ?? []) as unknown as ShowcaseVenue[]);
    setShowcaseOrgs((orgsRes.data ?? []) as unknown as ShowcaseOrganizer[]);
    setClaims((claimsRes.data ?? []) as unknown as ClaimRequest[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(previewUrl(token));
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible');
    }
  };

  const submit = async () => {
    if (!label || !password || (!showcaseSel && accounts.length === 0)) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('create_demo_preview_link' as any, {
        p_label: label,
        p_password: password,
        p_target_accounts: selVenueId ? ['owner'] : selOrgId ? ['organizer'] : accounts,
        p_language: language,
        p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        p_venue_id: selVenueId || null,
        p_organizer_user_id: selOrgId || null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const token = (row as any)?.token as string | undefined;
      if (token) {
        try { await navigator.clipboard.writeText(previewUrl(token)); } catch { /* ignore */ }
        toast.success(`Lien créé pour ${label} — copié dans le presse-papier`);
      } else {
        toast.success('Lien créé');
      }
      setLabel(''); setPassword(''); setAccounts(['owner']); setLanguage('en'); setExpiresAt('');
      setShowcaseSel('');
      setCreateOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  // Invitation depuis une demande d'activation. Club → invite-owner ; orga →
  // invite-platform-user (avec le fantôme à re-parenter). Dans les deux cas,
  // la branche « compte existant » transfère IMMÉDIATEMENT (pas d'email
  // d'acceptation) — le toast le dit clairement.
  const sendInvite = async () => {
    if (!inviteTarget || !inviteEmail || inviting) return;
    setInviting(true);
    try {
      let data: any, error: any;
      if (inviteTarget.venue_id) {
        ({ data, error } = await supabase.functions.invoke('invite-owner', {
          body: {
            email: inviteEmail.trim(),
            venue_id: inviteTarget.venue_id,
            venue_name: inviteTarget.venues?.name ?? inviteTarget.venue_id,
            offer_support_help: offerHelp,
          },
        }));
      } else {
        ({ data, error } = await supabase.functions.invoke('invite-platform-user', {
          body: {
            email: inviteEmail.trim(),
            organization_name: orgNameById[inviteTarget.organizer_user_id ?? ''] ?? 'Organisateur',
            offer_support_help: offerHelp,
            showcase_shadow_user_id: inviteTarget.organizer_user_id,
          },
        }));
      }
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      if (data?.user_exists) {
        toast.success('Compte existant : la vitrine vient d\'être transférée immédiatement.');
      } else {
        toast.success(`Invitation envoyée à ${inviteEmail.trim()}`);
      }
      setInviteTarget(null);
      load();
    } catch (e: any) {
      toast.error(String(e.message ?? 'Erreur').includes('prospect_already_organizer')
        ? 'Ce compte est déjà organisateur : réclamation impossible, à traiter à la main.'
        : e.message ?? 'Erreur');
    } finally {
      setInviting(false);
    }
  };

  const dismissClaim = async (claim: ClaimRequest) => {
    const { error } = await supabase
      .from('showcase_claim_requests' as any)
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', claim.id);
    if (error) toast.error(error.message);
    else { toast.success('Demande écartée'); load(); }
  };

  const revoke = async (link: PreviewLink) => {
    const { error } = await supabase
      .from('demo_preview_links' as any)
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', link.id);
    if (error) toast.error(error.message);
    else { toast.success('Lien désactivé'); load(); }
  };

  // Met à jour les rôles accessibles d'un lien existant. On garde target_account
  // (colonne mono, "rôle principal") en phase avec le 1er de la liste — c'est lui
  // que l'edge function de redeem prend comme compte primaire. La RLS super admin
  // (FOR ALL) autorise cet UPDATE direct, comme pour revoke/delete.
  const saveEdit = async () => {
    if (!editTarget || editAccounts.length === 0) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from('demo_preview_links' as any)
        .update({ target_accounts: editAccounts, target_account: editAccounts[0] })
        .eq('id', editTarget.id);
      if (error) throw error;
      toast.success('Accès mis à jour');
      setEditTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('demo_preview_links' as any).delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast.success('Lien supprimé');
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setDeleting(false);
    }
  };

  const isRevoked = (l: PreviewLink) => !l.is_active || !!l.revoked_at;
  const isExpired = (l: PreviewLink) => !!l.expires_at && new Date(l.expires_at) < new Date();
  const statusPill = (l: PreviewLink) => {
    if (isRevoked(l)) return <span style={pillStyle(NEG, 'rgba(255,92,99,0.1)', 'rgba(255,92,99,0.25)')}>Désactivé</span>;
    if (isExpired(l)) return <span style={pillStyle(T3, C_FAINT, BORDER)}>Expiré</span>;
    return <span style={pillStyle(POS, 'rgba(52,211,153,0.1)', 'rgba(52,211,153,0.25)')}>Actif</span>;
  };

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              Accès démo
            </h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>
              Génère un lien d'aperçu unique par personne, protégé par son propre mot de passe.
              Le destinataire voit le dashboard démo en lecture seule.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <button
                className="inline-flex items-center gap-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150"
                style={{ background: RED, color: '#fff', padding: '10px 16px', boxShadow: `0 0 18px -6px ${RED}88` }}
              >
                <Plus className="h-4 w-4" />Nouveau lien
              </button>
            </DialogTrigger>
            <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
              <DialogHeader><DialogTitle style={{ color: T1 }}>Nouveau lien d'aperçu</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label style={{ color: T2 }}>Personne</Label>
                  <input value={label} onChange={(e) => setLabel(e.target.value)}
                    placeholder="Ex : Noah" style={{ ...inputStyle, marginTop: 6 }} />
                </div>
                <div>
                  <Label style={{ color: T2 }}>Mot de passe</Label>
                  <input value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ex : el sorbo" style={{ ...inputStyle, marginTop: 6 }} />
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
                    À communiquer à la personne. C'est le mot de passe qui ouvrira son aperçu.
                  </p>
                </div>
                <div>
                  <Label style={{ color: T2 }}>Compte vitrine (optionnel)</Label>
                  <p style={{ color: T3, fontSize: 11.5, margin: '4px 0 8px', lineHeight: 1.5 }}>
                    Vise un club ou un organisateur vitrine précis : le prospect verra SA page publique
                    et SON dashboard en lecture seule, au lieu des comptes démo génériques.
                  </p>
                  <select value={showcaseSel} onChange={(e) => setShowcaseSel(e.target.value)}
                    style={inputStyle}>
                    <option value="" style={{ background: '#0a0a0c' }}>— Lien démo classique —</option>
                    {showcaseVenues.length > 0 && (
                      <optgroup label="Clubs vitrine">
                        {showcaseVenues.map((v) => (
                          <option key={v.id} value={`v:${v.id}`} style={{ background: '#0a0a0c' }}>
                            {v.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {showcaseOrgs.length > 0 && (
                      <optgroup label="Organisateurs vitrine">
                        {showcaseOrgs.map((o) => (
                          <option key={o.user_id} value={`o:${o.user_id}`} style={{ background: '#0a0a0c' }}>
                            {o.display_name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                {!showcaseSel && (
                  <div>
                    <Label style={{ color: T2 }}>Dashboards accessibles ({accounts.length})</Label>
                    <p style={{ color: T3, fontSize: 11.5, margin: '4px 0 8px', lineHeight: 1.5 }}>
                      Coche un ou plusieurs rôles. La personne pourra basculer entre eux depuis l'aperçu.
                    </p>
                    <AccountPicker selected={accounts} onToggle={toggleAccount} />
                  </div>
                )}
                <div>
                  <Label style={{ color: T2 }}>Langue par défaut</Label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}
                    style={{ ...inputStyle, marginTop: 6 }}>
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code} style={{ background: '#0a0a0c' }}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label style={{ color: T2 }}>Expiration (optionnel)</Label>
                  <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                    style={{ ...inputStyle, marginTop: 6 }} />
                </div>
                <button
                  onClick={submit}
                  disabled={submitting || !label || !password || (!showcaseSel && accounts.length === 0)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                  style={{ background: RED, color: '#fff', padding: '11px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: (submitting || !label || !password || (!showcaseSel && accounts.length === 0)) ? 'not-allowed' : 'pointer', opacity: (submitting || !label || !password || (!showcaseSel && accounts.length === 0)) ? 0.5 : 1 }}
                >
                  {submitting && <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: `rgba(255,255,255,0.35) rgba(255,255,255,0.35) rgba(255,255,255,0.35) #fff` }} />}
                  Créer + copier le lien
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </header>

        {claims.length > 0 && (
          <div style={cardStyle}>
            <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
              <Rocket className="h-4 w-4" style={{ color: RED }} />Demandes d'activation ({claims.length})
            </h2>
            <div className="space-y-2">
              {claims.map((cl) => (
                <div key={cl.id} className="flex items-center justify-between gap-3 p-3" style={rowStyle}>
                  <div className="flex-1 min-w-0">
                    <div className="font-[560] truncate" style={{ color: T1, fontSize: 13.5 }}>
                      {cl.venue_id
                        ? (cl.venues?.name ?? cl.venue_id)
                        : `${orgNameById[cl.organizer_user_id ?? ''] ?? 'Organisateur'} (orga)`}
                    </div>
                    <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                      {cl.requested_email}
                      {' · '}{format(new Date(cl.updated_at ?? cl.created_at), 'dd/MM HH:mm')}
                    </div>
                  </div>
                  <button
                    onClick={() => { setInviteTarget(cl); setInviteEmail(cl.requested_email); setOfferHelp(true); }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer transition-all duration-150"
                    style={{ background: RED, color: '#fff', boxShadow: `0 0 14px -6px ${RED}88` }}
                  >
                    Inviter
                  </button>
                  <button onClick={() => dismissClaim(cl)} title="Écarter la demande" style={iconBtn('neutral')}>
                    <Ban className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={cardStyle}>
          <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
            <KeyRound className="h-4 w-4" style={{ color: RED }} />Liens d'aperçu ({links.length})
          </h2>
          {loading ? (
            <div className="text-center py-8" style={{ color: T3 }}>…</div>
          ) : links.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Eye className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>Aucun lien d'aperçu. Crée le premier.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {links.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 p-3" style={rowStyle}>
                  <div className="flex-1 min-w-0">
                    <div className="font-[560] truncate" style={{ color: T1, fontSize: 13.5 }}>{l.label}</div>
                    <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                      {l.venue_id
                        ? `Vitrine club · ${l.venues?.name ?? l.venue_id}`
                        : l.organizer_user_id
                        ? `Vitrine orga · ${orgNameById[l.organizer_user_id] ?? 'réclamée'}`
                        : (l.target_accounts ?? []).map((a) => DEMO_ACCOUNTS[a]?.label ?? a).join(', ')}
                      {' · '}{(l.language ?? 'en').toUpperCase()}
                      {' · '}{l.used_count} ouverture{l.used_count > 1 ? 's' : ''}
                      {l.last_used_at ? ` · dernier ${format(new Date(l.last_used_at), 'dd/MM HH:mm')}` : ''}
                      {l.expires_at ? ` · expire ${format(new Date(l.expires_at), 'dd/MM/yyyy')}` : ''}
                    </div>
                  </div>
                  {(l.venue_id || l.organizer_user_id) && (
                    <span style={pillStyle(RED, 'rgba(232,25,44,0.1)', 'rgba(232,25,44,0.3)')}>
                      <Store className="h-3 w-3" />Vitrine
                    </span>
                  )}
                  {statusPill(l)}
                  {!l.venue_id && !l.organizer_user_id && (
                    <button onClick={() => openEdit(l)} title="Modifier les accès" style={iconBtn('neutral')}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => copyLink(l.token)} title="Copier le lien" style={iconBtn('neutral')}>
                    <Copy className="h-4 w-4" />
                  </button>
                  {!isRevoked(l) && (
                    <button onClick={() => revoke(l)} title="Désactiver" style={iconBtn('neutral')}>
                      <Ban className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => setDeleteTarget(l)} title="Supprimer" style={iconBtn('danger')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
          <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <DialogHeader>
              <DialogTitle style={{ color: T1 }}>
                Modifier les accès{editTarget ? ` — ${editTarget.label}` : ''}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label style={{ color: T2 }}>Dashboards accessibles ({editAccounts.length})</Label>
                <p style={{ color: T3, fontSize: 11.5, margin: '4px 0 8px', lineHeight: 1.5 }}>
                  Coche un ou plusieurs rôles. La personne pourra basculer entre eux depuis l'aperçu.
                  Elle devra rouvrir son lien pour voir le changement.
                </p>
                <AccountPicker selected={editAccounts} onToggle={toggleEditAccount} />
              </div>
              <button
                onClick={saveEdit}
                disabled={savingEdit || editAccounts.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                style={{ background: RED, color: '#fff', padding: '11px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: (savingEdit || editAccounts.length === 0) ? 'not-allowed' : 'pointer', opacity: (savingEdit || editAccounts.length === 0) ? 0.5 : 1 }}
              >
                {savingEdit && <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: `rgba(255,255,255,0.35) rgba(255,255,255,0.35) rgba(255,255,255,0.35) #fff` }} />}
                Enregistrer
              </button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!inviteTarget} onOpenChange={(o) => !o && setInviteTarget(null)}>
          <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <DialogHeader>
              <DialogTitle style={{ color: T1 }}>
                {inviteTarget?.venue_id ? 'Inviter le propriétaire' : 'Inviter l\'organisateur'}
                {inviteTarget?.venue_id
                  ? (inviteTarget?.venues?.name ? ` — ${inviteTarget.venues.name}` : '')
                  : (orgNameById[inviteTarget?.organizer_user_id ?? ''] ? ` — ${orgNameById[inviteTarget!.organizer_user_id!]}` : '')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label style={{ color: T2 }}>Email du prospect</Label>
                <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  style={{ ...inputStyle, marginTop: 6 }} />
                <p style={{ color: T3, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
                  Nouveau compte : il reçoit une invitation à accepter. Compte Yuno existant :
                  la vitrine lui est transférée immédiatement, sans email d'acceptation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOfferHelp(!offerHelp)}
                className="flex items-start gap-2.5 w-full text-left"
              >
                <span
                  className="shrink-0 h-[18px] w-[18px] rounded-[4px] border flex items-center justify-center transition-colors mt-[1px]"
                  style={{ background: offerHelp ? RED : 'transparent', borderColor: offerHelp ? RED : 'rgba(255,255,255,0.25)' }}
                >
                  {offerHelp && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                <span style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>
                  Proposer l'assistance Yuno à l'acceptation (le pro consent, un accès support
                  s'ouvre pour finir la configuration avec lui).
                </span>
              </button>
              <button
                onClick={sendInvite}
                disabled={inviting || !inviteEmail}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                style={{ background: RED, color: '#fff', padding: '11px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: (inviting || !inviteEmail) ? 'not-allowed' : 'pointer', opacity: (inviting || !inviteEmail) ? 0.5 : 1 }}
              >
                {inviting && <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: `rgba(255,255,255,0.35) rgba(255,255,255,0.35) rgba(255,255,255,0.35) #fff` }} />}
                Envoyer l'invitation
              </button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <AlertDialogHeader>
              <AlertDialogTitle style={{ color: T1 }}>Supprimer ce lien d'aperçu ?</AlertDialogTitle>
              <AlertDialogDescription style={{ color: T3 }}>
                Le lien de <strong style={{ color: T2 }}>{deleteTarget?.label}</strong> ne fonctionnera plus.
                Cette action est définitive.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete} disabled={deleting} style={{ background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)', color: NEG }}>
                {deleting ? 'Suppression…' : 'Supprimer'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
