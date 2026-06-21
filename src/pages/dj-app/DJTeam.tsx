import { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import {
  Users, UserPlus, Mail, Copy, Check, Trash2, Loader2, ShieldCheck, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useDJData } from '@/contexts/DJDataContext';
import { makeDjT } from '@/i18n/djTranslate';
import { supabase } from '@/integrations/supabase/client';
import {
  DJPage, DJHeading, PCard, ZoneHeading,
  RED, POS, WARN, T1, T2, T3, INNER_BG, BORDER,
} from '@/components/dj/dj-ui';

type Role = 'manager' | 'agent' | 'viewer';

interface Invitation {
  id: string;
  email: string;
  role: Role;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
}

export default function DJTeam() {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { dj } = useDJData();
  const { user } = useAuth();

  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('manager');
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const roleLabel = useCallback((r: Role) => ({
    manager: tt('Manager', 'Manager', 'Mánager'),
    agent: tt('Booker / agent', 'Booker / agent', 'Booker / agente'),
    viewer: tt('Lecture seule', 'Viewer', 'Solo lectura'),
  }[r]), [tt]);

  const fetchInvites = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('dj_team_invitations')
      .select('id, email, role, token, status, created_at, expires_at')
      .eq('dj_user_id', user.id)
      .order('created_at', { ascending: false });
    setInvites((data as unknown as Invitation[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchInvites(); }, [fetchInvites]);

  const acceptLink = (token: string) => `${window.location.origin}/dj/team/accept?token=${token}`;

  const copyLink = async (inv: Invitation) => {
    try {
      await navigator.clipboard.writeText(acceptLink(inv.token));
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 1800);
      toast.success(tt('Lien copié', 'Link copied', 'Enlace copiado'));
    } catch {
      toast.error(tt('Copie impossible', 'Copy failed', 'No se pudo copiar'));
    }
  };

  const handleInvite = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean || !user) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      toast.error(tt('Email invalide', 'Invalid email', 'Email inválido'));
      return;
    }
    setSending(true);
    const { data, error } = await supabase
      .from('dj_team_invitations')
      .insert({ dj_user_id: user.id, invited_by: user.id, email: clean, role })
      .select('id, email, role, token, status, created_at, expires_at')
      .single();
    setSending(false);
    if (error || !data) {
      toast.error(tt("Échec de l'invitation", 'Invite failed', 'Error al invitar'));
      return;
    }
    const inv = data as unknown as Invitation;
    setEmail('');
    setInvites(prev => [inv, ...prev]);
    await copyLink(inv);
    toast.success(tt('Invitation créée — lien copié', 'Invite created — link copied', 'Invitación creada — enlace copiado'));
  };

  const handleRevoke = async (id: string) => {
    const { data, error } = await supabase.rpc('dj_revoke_team_invitation', { p_id: id });
    const res = data as { ok?: boolean } | null;
    if (error || !res?.ok) { toast.error(tt('Échec', 'Failed', 'Error')); return; }
    setInvites(prev => prev.map(i => i.id === id ? { ...i, status: 'revoked' } : i));
    toast.success(tt('Accès révoqué', 'Access revoked', 'Acceso revocado'));
  };

  const active = useMemo(() => invites.filter(i => i.status === 'accepted'), [invites]);
  const pending = useMemo(() => invites.filter(i => i.status === 'pending'), [invites]);

  if (!dj) return null;

  const ROLE_OPTS: Role[] = ['manager', 'agent', 'viewer'];

  const Row = ({ inv }: { inv: Invitation }) => (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg"
        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T2 }}>
        <Mail className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-[560] truncate" style={{ color: T1 }}>{inv.email}</p>
        <p className="text-[11px]" style={{ color: T3 }}>
          {roleLabel(inv.role)} · {format(new Date(inv.created_at), 'dd MMM yyyy', { locale })}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-none">
        {inv.status === 'pending' && (
          <button onClick={() => copyLink(inv)} title={tt('Copier le lien', 'Copy link', 'Copiar enlace')}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors hover:bg-white/[0.06]"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: copiedId === inv.id ? POS : T2 }}>
            {copiedId === inv.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        )}
        <button onClick={() => handleRevoke(inv.id)} title={tt('Révoquer', 'Revoke', 'Revocar')}
          className="inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors hover:bg-[rgba(232,25,44,0.12)]"
          style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T3 }}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <DJPage maxWidth={760}>
      <DJHeading
        title={tt('Équipe', 'Team', 'Equipo')}
        subtitle={tt('Donne accès à ton manager ou ton booker', 'Give access to your manager or booker', 'Da acceso a tu mánager o booker')}
      />

      {/* Invite form */}
      <PCard icon={<UserPlus className="w-4 h-4" />} title={tt('Inviter quelqu\'un', 'Invite someone', 'Invitar a alguien')}
        sub={tt('Accès en lecture seule à ton dashboard', 'Read-only access to your dashboard', 'Acceso de solo lectura a tu panel')} accent>
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={email} onChange={e => setEmail(e.target.value)} type="email"
              placeholder={tt('email@exemple.com', 'email@example.com', 'email@ejemplo.com')}
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              className="flex-1 rounded-xl px-3.5 py-2.5 text-sm outline-none"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
            <button onClick={handleInvite} disabled={!email.trim() || sending}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50 flex-none"
              style={{ background: RED, color: '#fff' }}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {tt('Inviter', 'Invite', 'Invitar')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTS.map(r => {
              const activeRole = role === r;
              return (
                <button key={r} onClick={() => setRole(r)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={activeRole
                    ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.35)', color: RED }
                    : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                  {roleLabel(r)}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: T3 }}>
            {tt(
              'La personne reçoit un lien d\'invitation (valable 14 jours). Une fois acceptée avec ce même email, elle voit ton planning, tes cachets et tes stats — sans pouvoir modifier.',
              'They get an invite link (valid 14 days). Once accepted with that same email, they see your schedule, fees and stats — without being able to edit.',
              'Recibe un enlace de invitación (válido 14 días). Al aceptarlo con ese mismo email, ve tu agenda, cachés y estadísticas, sin poder modificar.',
            )}
          </p>
        </div>
      </PCard>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
      ) : (
        <>
          {/* Active members */}
          {active.length > 0 && (
            <>
              <ZoneHeading icon={<ShieldCheck className="w-4 h-4" />} label={tt('Membres actifs', 'Active members', 'Miembros activos')} />
              <div className="space-y-2">{active.map(inv => <Row key={inv.id} inv={inv} />)}</div>
            </>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <>
              <ZoneHeading icon={<Clock className="w-4 h-4" />} label={tt('Invitations en attente', 'Pending invitations', 'Invitaciones pendientes')} />
              <div className="space-y-2">{pending.map(inv => <Row key={inv.id} inv={inv} />)}</div>
            </>
          )}

          {active.length === 0 && pending.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <Users className="h-6 w-6" style={{ color: T3 }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: T2 }}>
                  {tt('Aucun membre pour l\'instant', 'No team members yet', 'Sin miembros todavía')}
                </p>
                <p className="text-xs mt-1" style={{ color: T3 }}>
                  {tt('Invite ton manager pour qu\'il suive tes dates avec toi.', 'Invite your manager to follow your gigs with you.', 'Invita a tu mánager para seguir tus fechas contigo.')}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </DJPage>
  );
}
