import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Mail, Building2, MapPin, TrendingUp, CheckCircle, XCircle, Send, Trash2, Copy, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const C_FAINT     = 'rgba(255,255,255,0.06)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};

const labelStyle: React.CSSProperties = { color: T2, fontSize: 12.5, fontWeight: 560, display: 'block', marginBottom: 6 };

const cardStyle: React.CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18, overflow: 'hidden',
};

type AffiliateRow = {
  id: string;
  name: string;
  type: string;
  city: string | null;
  commission_rate: number;
  is_active: boolean;
  created_at: string;
  user_id: string;
  venueCount?: number;
  eventCount?: number;
  clickCount?: number;
};

type InviteForm = {
  email: string;
  name: string;
  city: string;
  type: 'city_agency' | 'independent' | 'yuno_internal';
  commission_rate: string;
};

type PendingInvite = {
  id: string;
  email: string;
  organization_name: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  token: string;
};

const TYPE_LABELS: Record<string, string> = {
  yuno_internal: 'Yuno Interne',
  city_agency: 'Agence Ville',
  independent: 'Indépendant',
};

// yuno_internal = accent RED, others = neutral white tiers
const typePillStyle = (type: string): React.CSSProperties => {
  if (type === 'yuno_internal') return { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED };
  if (type === 'city_agency') return { background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T1 };
  return { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 };
};

export default function AdminAffiliates() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [form, setForm] = useState<InviteForm>({
    email: '',
    name: '',
    city: '',
    type: 'city_agency',
    commission_rate: '0',
  });

  useEffect(() => {
    fetchAffiliates();
  }, []);

  const fetchAffiliates = async () => {
    setLoading(true);
    try {
      const [{ data, error }, { data: invites }] = await Promise.all([
        supabase.from('affiliates').select('*').order('created_at', { ascending: false }),
        supabase
          .from('platform_invitations')
          .select('id, email, organization_name, status, created_at, expires_at, token')
          .eq('profile_type', 'affiliate')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ]);

      if (error) throw error;

      setPendingInvites((invites ?? []) as PendingInvite[]);

      // Enrich affiliates with counts
      const enriched = await Promise.all(
        (data ?? []).map(async (aff) => {
          const [{ count: venueCount }, { count: eventCount }, { count: clickCount }] =
            await Promise.all([
              supabase
                .from('affiliate_venues')
                .select('*', { count: 'exact', head: true })
                .eq('affiliate_id', aff.id),
              supabase
                .from('affiliate_events')
                .select('*', { count: 'exact', head: true })
                .eq('affiliate_id', aff.id),
              supabase
                .from('affiliate_clicks')
                .select('*', { count: 'exact', head: true })
                .eq('affiliate_id', aff.id),
            ]);
          return {
            ...aff,
            venueCount: venueCount ?? 0,
            eventCount: eventCount ?? 0,
            clickCount: clickCount ?? 0,
          };
        })
      );

      setAffiliates(enriched);
    } catch (err) {
      console.error(err);
      toast({ title: 'Erreur', description: 'Impossible de charger les affiliés.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleResendInvite = async (invite: PendingInvite) => {
    if (!invite.organization_name) return;
    try {
      const { data, error } = await supabase.functions.invoke('invite-affiliate', {
        body: {
          email: invite.email,
          name: invite.organization_name,
        },
      });
      if (error) {
        let msg = error.message;
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        toast({ title: 'Erreur', description: msg, variant: 'destructive' });
        return;
      }
      if (data?.email_sent === false) {
        toast({ title: 'Invitation mise à jour', description: `Email non envoyé — vérifiez la configuration Resend. Lien : ${data.invite_link}` });
      } else {
        toast({ title: 'Email renvoyé', description: `Invitation renvoyée à ${invite.email}.` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    }
  };

  const handleRevokeInvite = async (id: string) => {
    const { error } = await supabase
      .from('platform_invitations')
      .update({ status: 'revoked' })
      .eq('id', id);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Invitation révoquée' });
    fetchAffiliates();
  };

  const handleInvite = async () => {
    if (!form.email || !form.name) {
      toast({ title: 'Champs manquants', description: 'Email et nom sont requis.', variant: 'destructive' });
      return;
    }

    setInviteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-affiliate', {
        body: {
          email: form.email,
          name: form.name,
          city: form.city || null,
          type: form.type,
          commission_rate: parseFloat(form.commission_rate) || 0,
        },
      });

      if (error) {
        // Extract the real error message from the function response body
        let msg = error.message;
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        toast({ title: 'Erreur', description: msg, variant: 'destructive' });
        return;
      }

      if (data?.user_exists) {
        toast({ title: 'Affilié activé', description: `${form.name} a été activé directement.` });
      } else if (data?.email_sent === false && data?.invite_link) {
        toast({
          title: 'Invitation créée (email non envoyé)',
          description: `L'invitation a été créée mais l'email a échoué. Lien : ${data.invite_link}`,
        });
      } else {
        toast({ title: 'Invitation envoyée', description: `Un email a été envoyé à ${form.email}.` });
      }

      setInviteOpen(false);
      setForm({ email: '', name: '', city: '', type: 'city_agency', commission_rate: '0' });
      fetchAffiliates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast({ title: 'Erreur', description: msg, variant: 'destructive' });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleToggleActive = async (aff: AffiliateRow) => {
    const { error } = await supabase
      .from('affiliates')
      .update({ is_active: !aff.is_active })
      .eq('id', aff.id);

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }

    setAffiliates((prev) =>
      prev.map((a) => (a.id === aff.id ? { ...a, is_active: !aff.is_active } : a))
    );
  };

  const stats: { label: string; value: number; icon: LucideIcon }[] = [
    { label: 'Affiliés actifs', value: affiliates.filter((a) => a.is_active).length, icon: Building2 },
    { label: 'Clubs partenaires', value: affiliates.reduce((s, a) => s + (a.venueCount ?? 0), 0), icon: MapPin },
    { label: 'Soirées affiliées', value: affiliates.reduce((s, a) => s + (a.eventCount ?? 0), 0), icon: CheckCircle },
    { label: 'Clics ce mois', value: affiliates.reduce((s, a) => s + (a.clickCount ?? 0), 0), icon: TrendingUp },
  ];

  const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };
  const iconBtnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
    borderRadius: 8, background: INNER_BG, border: `1px solid ${BORDER}`, cursor: 'pointer',
  };

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>Affiliés</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>
              Gérez les agences ville et indépendants qui publient des clubs et soirées partenaires.
            </p>
          </div>
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 cursor-pointer transition-all duration-150"
            style={{ padding: '10px 16px', borderRadius: 12, background: RED, border: '1px solid rgba(232,25,44,0.6)', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 0 16px -6px ${RED}` }}
          >
            <Plus className="h-4 w-4" />
            Inviter un affilié
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px' }}
            >
              <div className="flex items-center gap-2 mb-2" style={{ color: T3, fontSize: 12 }}>
                <Icon className="h-4 w-4" style={{ color: T2 }} />
                {label}
              </div>
              <div className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Pending invitations */}
        {(pendingInvites.length > 0 || loading) && (
          <div style={cardStyle}>
            <h2 className="flex items-center gap-2 mb-3" style={{ color: T2, fontSize: 13, fontWeight: 600 }}>
              <Mail className="h-4 w-4" style={{ color: RED }} />
              Invitations en attente ({pendingInvites.length})
            </h2>
            {loading ? (
              <div className="text-center py-4" style={{ color: T3, fontSize: 13 }}>Chargement…</div>
            ) : (
              <div className="space-y-2">
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                    <div className="flex-1 min-w-0">
                      <div className="font-[560] truncate" style={{ color: T1, fontSize: 13.5 }}>{inv.organization_name}</div>
                      <div className="truncate" style={{ color: T3, fontSize: 11.5 }}>
                        {inv.email} · expire le {format(new Date(inv.expires_at), 'dd/MM/yyyy')}
                      </div>
                    </div>
                    <span style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999 }}>
                      En attente
                    </span>
                    <button
                      style={{ ...iconBtnStyle, color: T2 }}
                      title="Copier le lien d'activation"
                      onClick={() => {
                        const link = `${window.location.origin}/auth?invite_affiliate=${inv.token}&email=${encodeURIComponent(inv.email)}`;
                        navigator.clipboard.writeText(link);
                        toast({ title: 'Lien copié', description: 'Le lien d\'activation est dans le presse-papiers.' });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      style={{ ...iconBtnStyle, color: T2 }}
                      title="Renvoyer l'invitation par email"
                      onClick={() => handleResendInvite(inv)}
                    >
                      <Send className="h-4 w-4" />
                    </button>
                    <button
                      style={{ ...iconBtnStyle, color: RED, border: '1px solid rgba(232,25,44,0.25)', background: 'rgba(232,25,44,0.08)' }}
                      title="Révoquer"
                      onClick={() => handleRevokeInvite(inv.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  <th className="px-4 py-3 text-left font-medium" style={thStyle}>Nom</th>
                  <th className="px-4 py-3 text-left font-medium" style={thStyle}>Type</th>
                  <th className="px-4 py-3 text-left font-medium" style={thStyle}>Ville</th>
                  <th className="px-4 py-3 text-center font-medium" style={thStyle}>Clubs</th>
                  <th className="px-4 py-3 text-center font-medium" style={thStyle}>Soirées</th>
                  <th className="px-4 py-3 text-center font-medium" style={thStyle}>Clics</th>
                  <th className="px-4 py-3 text-center font-medium" style={thStyle}>Commission</th>
                  <th className="px-4 py-3 text-center font-medium" style={thStyle}>Statut</th>
                  <th className="px-4 py-3" style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto mb-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                      <span style={{ color: T3, fontSize: 12 }}>Chargement…</span>
                    </td>
                  </tr>
                ) : affiliates.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12">
                      <Building2 className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                      <span style={{ color: T3, fontSize: 12 }}>Aucun affilié pour l'instant.</span>
                    </td>
                  </tr>
                ) : (
                  affiliates.map((aff, index) => (
                    <tr key={aff.id} style={{ borderBottom: index < affiliates.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                      <td className="px-4 py-3 font-[560]" style={{ color: T1 }}>{aff.name}</td>
                      <td className="px-4 py-3">
                        <span style={{ ...typePillStyle(aff.type), fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, display: 'inline-block' }}>
                          {TYPE_LABELS[aff.type] ?? aff.type}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: T2 }}>{aff.city ?? '—'}</td>
                      <td className="px-4 py-3 text-center tabular-nums" style={{ color: T2 }}>{aff.venueCount}</td>
                      <td className="px-4 py-3 text-center tabular-nums" style={{ color: T2 }}>{aff.eventCount}</td>
                      <td className="px-4 py-3 text-center tabular-nums" style={{ color: T2 }}>{aff.clickCount}</td>
                      <td className="px-4 py-3 text-center tabular-nums" style={{ color: T2 }}>{aff.commission_rate}%</td>
                      <td className="px-4 py-3 text-center">
                        {aff.is_active ? (
                          <CheckCircle className="h-4 w-4 mx-auto" style={{ color: POS }} />
                        ) : (
                          <XCircle className="h-4 w-4 mx-auto" style={{ color: T3 }} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className="cursor-pointer transition-all duration-150"
                          style={{ padding: '5px 11px', borderRadius: 8, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12, fontWeight: 500 }}
                          onClick={() => handleToggleActive(aff)}
                        >
                          {aff.is_active ? 'Désactiver' : 'Activer'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Invite Dialog */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent className="max-w-md" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={{ color: T1 }}>
                <Mail className="h-5 w-5" style={{ color: RED }} />
                Inviter un affilié
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <label style={labelStyle}>Email *</label>
                <input
                  placeholder="contact@agence-madrid.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Nom de l'entité *</label>
                <input
                  placeholder="Agence Madrid Nightlife"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={labelStyle}>Ville</label>
                  <input
                    placeholder="Madrid"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Commission (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="0"
                    value={form.commission_rate}
                    onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as InviteForm['type'] })}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="city_agency" style={{ background: '#0a0a0c', color: T1 }}>Agence Ville</option>
                  <option value="independent" style={{ background: '#0a0a0c', color: T1 }}>Indépendant</option>
                  <option value="yuno_internal" style={{ background: '#0a0a0c', color: T1 }}>Yuno Interne</option>
                </select>
              </div>
            </div>

            <DialogFooter>
              <button
                onClick={() => setInviteOpen(false)}
                className="cursor-pointer transition-all duration-150"
                style={{ padding: '9px 14px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13, fontWeight: 500 }}
              >
                Annuler
              </button>
              <button
                onClick={handleInvite}
                disabled={inviteLoading}
                className="cursor-pointer transition-all duration-150"
                style={{ padding: '9px 16px', borderRadius: 10, background: RED, border: '1px solid rgba(232,25,44,0.6)', color: '#fff', fontSize: 13, fontWeight: 600, opacity: inviteLoading ? 0.5 : 1 }}
              >
                {inviteLoading ? 'Envoi…' : 'Envoyer l\'invitation'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
