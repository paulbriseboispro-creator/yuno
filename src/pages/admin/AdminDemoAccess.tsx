// Fenêtre Super Admin : créer / gérer les liens d'aperçu (preview) démo.
//
// Chaque lien = 1 personne (ex. « Noah ») + 1 mot de passe qui lui est propre
// (ex. « el sorbo ») + 1 type de compte démo. On génère une URL /preview?token=…
// à envoyer ; le destinataire ouvre, saisit son mot de passe, et voit le dashboard
// démo en LECTURE SEULE.

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
import { Plus, KeyRound, Trash2, Copy, Ban, Eye, Check } from 'lucide-react';
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
}

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'Anglais (EN)' },
  { code: 'fr', label: 'Français (FR)' },
  { code: 'es', label: 'Espagnol (ES)' },
];

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

  const toggleAccount = (a: TargetAccount) =>
    setAccounts((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<PreviewLink | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('demo_preview_links' as any)
      .select('*')
      .order('created_at', { ascending: false });
    setLinks((data ?? []) as unknown as PreviewLink[]);
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
    if (!label || !password || accounts.length === 0) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('create_demo_preview_link' as any, {
        p_label: label,
        p_password: password,
        p_target_accounts: accounts,
        p_language: language,
        p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
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
      setCreateOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (link: PreviewLink) => {
    const { error } = await supabase
      .from('demo_preview_links' as any)
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', link.id);
    if (error) toast.error(error.message);
    else { toast.success('Lien désactivé'); load(); }
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
                  <Label style={{ color: T2 }}>Dashboards accessibles ({accounts.length})</Label>
                  <p style={{ color: T3, fontSize: 11.5, margin: '4px 0 8px', lineHeight: 1.5 }}>
                    Coche un ou plusieurs rôles. La personne pourra basculer entre eux depuis l'aperçu.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ALL_TARGET_ACCOUNTS.map((a) => {
                      const checked = accounts.includes(a);
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => toggleAccount(a)}
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
                </div>
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
                  disabled={submitting || !label || !password || accounts.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                  style={{ background: RED, color: '#fff', padding: '11px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: (submitting || !label || !password || accounts.length === 0) ? 'not-allowed' : 'pointer', opacity: (submitting || !label || !password || accounts.length === 0) ? 0.5 : 1 }}
                >
                  {submitting && <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: `rgba(255,255,255,0.35) rgba(255,255,255,0.35) rgba(255,255,255,0.35) #fff` }} />}
                  Créer + copier le lien
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </header>

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
                      {(l.target_accounts ?? []).map((a) => DEMO_ACCOUNTS[a]?.label ?? a).join(', ')}
                      {' · '}{(l.language ?? 'en').toUpperCase()}
                      {' · '}{l.used_count} ouverture{l.used_count > 1 ? 's' : ''}
                      {l.last_used_at ? ` · dernier ${format(new Date(l.last_used_at), 'dd/MM HH:mm')}` : ''}
                      {l.expires_at ? ` · expire ${format(new Date(l.expires_at), 'dd/MM/yyyy')}` : ''}
                    </div>
                  </div>
                  {statusPill(l)}
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
