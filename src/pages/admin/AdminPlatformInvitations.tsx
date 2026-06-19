import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Mail, Sparkles, Trash2, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
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

// Status pill for invitation history: accepted → POS, revoked/expired → NEG, else neutral
function statusPill(status: string): React.CSSProperties {
  if (status === 'accepted') return pillStyle(POS, 'rgba(52,211,153,0.1)', 'rgba(52,211,153,0.25)');
  if (status === 'revoked' || status === 'expired') return pillStyle(NEG, 'rgba(255,92,99,0.1)', 'rgba(255,92,99,0.25)');
  return pillStyle(T1, C_FAINT, BORDER);
}

interface Invitation {
  id: string;
  email: string;
  profile_type: string;
  organization_name: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

interface OrgAccount {
  id: string;
  email: string | null;
  organization_name: string | null;
  profile_type: string | null;
  created_at: string;
}

export default function AdminPlatformInvitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [accounts, setAccounts] = useState<OrgAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OrgAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<OrgAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [inv, accs] = await Promise.all([
      supabase.from('platform_invitations').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles')
        .select('id, email, organization_name, profile_type, created_at')
        .eq('profile_type', 'organizer')
        .order('created_at', { ascending: false }),
    ]);
    setInvitations((inv.data ?? []) as Invitation[]);
    setAccounts((accs.data ?? []) as OrgAccount[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!email || !orgName) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-platform-user', {
        body: { email, organization_name: orgName },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.user_exists
        ? 'Compte existant lié au profil organisateur'
        : 'Invitation envoyée par email');
      setEmail(''); setOrgName('');
      setInviteOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async (inv: Invitation) => {
    if (!inv.organization_name) return;
    try {
      const { data, error } = await supabase.functions.invoke('invite-platform-user', {
        body: { email: inv.email, organization_name: inv.organization_name },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Email d\'invitation renvoyé');
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from('platform_invitations')
      .update({ status: 'revoked' })
      .eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Invitation révoquée'); load(); }
  };

  const deleteInvitation = async (id: string) => {
    const { error } = await supabase.from('platform_invitations').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Invitation supprimée'); load(); }
  };

  const openEdit = (acc: OrgAccount) => {
    setEditTarget(acc);
    setEditName(acc.organization_name ?? '');
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ organization_name: editName })
        .eq('id', editTarget.id);
      if (error) throw error;
      // also update public organizer_profiles display_name if exists.
      // The super-admin RLS policy added in migration 20260618120000 lets this
      // succeed; surface any error instead of swallowing it like before.
      const { error: opErr } = await supabase
        .from('organizer_profiles')
        .update({ display_name: editName })
        .eq('user_id', editTarget.id);
      if (opErr) throw opErr;
      toast.success('Organisation mise à jour');
      setEditOpen(false);
      setEditTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setEditSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Atomic, server-side removal: reverts the profile, drops the public
      // organizer_profiles row (the /o/:slug page), removes team members + role,
      // and clears any invitation. Runs SECURITY DEFINER so it bypasses RLS —
      // doing these deletes from the browser silently no-ops on organizer_profiles
      // because there is no super-admin RLS policy for direct client deletes.
      const { error } = await supabase.rpc('admin_delete_organizer', {
        _user_id: deleteTarget.id,
      });
      if (error) throw error;

      toast.success('Compte organisateur retiré');
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setDeleting(false);
    }
  };

  const TypeIcon = () => <Sparkles className="h-3.5 w-3.5" />;
  const pending = invitations.filter(i => i.status === 'pending');
  const past = invitations.filter(i => i.status !== 'pending');

  const iconBtn = (tone: 'neutral' | 'danger'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 32, width: 32, borderRadius: 8, flex: 'none', cursor: 'pointer',
    background: 'transparent', border: '1px solid transparent',
    color: tone === 'danger' ? NEG : T3, transition: 'all 0.15s',
  });

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              Organisateurs
            </h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>
              Invitez, modifiez ou retirez les comptes organisateurs (publics et BDE/privés via le type d'événement).
            </p>
          </div>
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <button
                className="inline-flex items-center gap-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150"
                style={{ background: RED, color: '#fff', padding: '10px 16px', boxShadow: `0 0 18px -6px ${RED}88` }}
              >
                <Plus className="h-4 w-4" />Inviter
              </button>
            </DialogTrigger>
            <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
              <DialogHeader><DialogTitle style={{ color: T1 }}>Nouvelle invitation organisateur</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label style={{ color: T2 }}>Email</Label>
                  <input
                    type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@orga.com" style={{ ...inputStyle, marginTop: 6 }}
                  />
                </div>
                <div>
                  <Label style={{ color: T2 }}>Nom de l'organisation</Label>
                  <input
                    value={orgName} onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Ex: BDE Sciences Po, Viva Events…" style={{ ...inputStyle, marginTop: 6 }}
                  />
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
                    Si l'email a déjà un compte Yuno, il sera lié au profil organisateur instantanément.
                    Sinon, un email d'invitation sera envoyé.
                  </p>
                </div>
                <button
                  onClick={submit}
                  disabled={submitting || !email || !orgName}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                  style={{ background: RED, color: '#fff', padding: '11px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: (submitting || !email || !orgName) ? 'not-allowed' : 'pointer', opacity: (submitting || !email || !orgName) ? 0.5 : 1 }}
                >
                  {submitting && <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: `rgba(255,255,255,0.35) rgba(255,255,255,0.35) rgba(255,255,255,0.35) #fff` }} />}
                  Envoyer l'invitation
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </header>

        {/* Pending invitations */}
        <div style={cardStyle}>
          <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
            <Mail className="h-4 w-4" style={{ color: RED }} />Invitations en attente ({pending.length})
          </h2>
          {loading ? (
            <div className="text-center py-8" style={{ color: T3 }}>…</div>
          ) : pending.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Mail className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>Aucune invitation en attente.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pending.map(inv => (
                <div key={inv.id} className="flex items-center justify-between gap-3 p-3" style={rowStyle}>
                  <div className="flex-1 min-w-0">
                    <div className="font-[560] truncate" style={{ color: T1, fontSize: 13.5 }}>{inv.organization_name}</div>
                    <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                      {inv.email} · expire le {format(new Date(inv.expires_at), 'dd/MM/yyyy')}
                    </div>
                  </div>
                  <span style={pillStyle(T1, C_FAINT, BORDER)}><TypeIcon />Organisateur</span>
                  <button onClick={() => resend(inv)} title="Renvoyer l'email" style={iconBtn('neutral')}>
                    <Send className="h-4 w-4" />
                  </button>
                  <button onClick={() => revoke(inv.id)} title="Révoquer" style={iconBtn('danger')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active accounts */}
        <div style={cardStyle}>
          <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>Comptes actifs ({accounts.length})</h2>
          {loading ? (
            <div className="text-center py-8" style={{ color: T3 }}>…</div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Sparkles className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>Aucun compte actif.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center justify-between gap-3 p-3" style={rowStyle}>
                  <div className="flex-1 min-w-0">
                    <div className="font-[560] truncate" style={{ color: T1, fontSize: 13.5 }}>{acc.organization_name ?? '—'}</div>
                    <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{acc.email}</div>
                  </div>
                  <span style={pillStyle(POS, 'rgba(52,211,153,0.1)', 'rgba(52,211,153,0.25)')}><TypeIcon />Organisateur</span>
                  <button onClick={() => openEdit(acc)} title="Modifier" style={iconBtn('neutral')}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDeleteTarget(acc)} title="Retirer" style={iconBtn('danger')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History */}
        {past.length > 0 && (
          <div style={cardStyle}>
            <h2 style={{ color: T3, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>Historique invitations</h2>
            <div className="space-y-2">
              {past.map(inv => (
                <div key={inv.id} className="flex items-center justify-between gap-3 p-3" style={rowStyle}>
                  <div className="flex-1 min-w-0">
                    <div className="font-[560] truncate" style={{ color: T1, fontSize: 13.5 }}>{inv.organization_name}</div>
                    <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                      {inv.email} · {inv.status} · {format(new Date(inv.created_at), 'dd/MM/yyyy')}
                    </div>
                  </div>
                  <span style={statusPill(inv.status)}>{inv.status}</span>
                  {inv.status !== 'accepted' && inv.organization_name && (
                    <button onClick={() => resend(inv)} title="Renvoyer l'email" style={iconBtn('neutral')}>
                      <Send className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => deleteInvitation(inv.id)} title="Supprimer" style={iconBtn('danger')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edit dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <DialogHeader><DialogTitle style={{ color: T1 }}>Modifier l'organisation</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label style={{ color: T2 }}>Email (lecture seule)</Label>
                <input value={editTarget?.email ?? ''} disabled style={{ ...inputStyle, marginTop: 6, opacity: 0.6 }} />
              </div>
              <div>
                <Label style={{ color: T2 }}>Nom de l'organisation</Label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
              </div>
            </div>
            <DialogFooter>
              <button onClick={() => setEditOpen(false)} className="inline-flex items-center justify-center rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, padding: '10px 16px' }}>Annuler</button>
              <button
                onClick={saveEdit}
                disabled={editSaving || !editName}
                className="inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                style={{ background: RED, color: '#fff', padding: '10px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: (editSaving || !editName) ? 'not-allowed' : 'pointer', opacity: (editSaving || !editName) ? 0.5 : 1 }}
              >
                {editSaving && <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: `rgba(255,255,255,0.35) rgba(255,255,255,0.35) rgba(255,255,255,0.35) #fff` }} />}
                Enregistrer
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <AlertDialogHeader>
              <AlertDialogTitle style={{ color: T1 }}>Retirer le profil organisateur ?</AlertDialogTitle>
              <AlertDialogDescription style={{ color: T3 }}>
                <strong style={{ color: T2 }}>{deleteTarget?.organization_name}</strong> ({deleteTarget?.email}) ne pourra plus accéder
                au tableau de bord organisateur. Le compte utilisateur reste actif (rôle client conservé).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete} disabled={deleting} style={{ background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)', color: NEG }}>
                {deleting ? 'Suppression…' : 'Retirer'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </div>
  );
}
