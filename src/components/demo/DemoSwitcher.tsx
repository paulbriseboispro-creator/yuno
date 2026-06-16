import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Building2, CalendarDays, Megaphone, Share2, ShieldCheck, Wine, Shirt,
  Disc3, ChevronRight, Loader2, FlaskConical, LogIn, Globe,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';

/**
 * DemoSwitcher — bascule 1-clic entre les comptes démo (club, orga, promoteur,
 * affilié, staff) pendant les appels de vente. Visible UNIQUEMENT pour les
 * comptes @womber.fr (owner + comptes démo). Invisible pour tous les vrais users.
 *
 * Mécanique (aucune edge function — non bloqué par le cap 402) :
 *  - Bascule vers un compte démo = supabase.auth.signInWithPassword (mdp connu).
 *  - Retour vers owner = restauration de la session owner sauvegardée
 *    (le mot de passe super-admin de owner@womber.fr n'est JAMAIS embarqué).
 */

const OWNER_EMAIL = 'owner@womber.fr';
// Mot de passe partagé des comptes démo (throwaway, club masqué, données fictives).
const DEMO_PASSWORD = 'YunoDemo2026!';
const ORIGIN_KEY = 'yuno_demo_origin_session';

// Comptes démo dont la route exige RequireMFA (owner, affilié). On pose une
// session MFA locale valide 24 h pour ne pas tomber sur /mfa-setup en démo
// (sans jamais toucher au vrai secret 2FA).
const MFA_GATED = new Set(['owner@womber.fr', 'affiliate@womber.fr']);
function setMfaBypass(userId: string | undefined) {
  if (!userId) return;
  try {
    localStorage.setItem('mfaSession', JSON.stringify({
      userId, expiresAt: Date.now() + 24 * 60 * 60 * 1000, verifiedAt: Date.now(),
    }));
  } catch { /* localStorage indispo : ignore */ }
}

type DemoAccount = {
  email: string;
  label: string;
  sub: string;
  route: string;
  icon: typeof Building2;
  // Session à poser pour passer le garde du rôle sans étape PIN (edge function verify-pin
  // CORS-lock / non déployée). 'staff' -> localStorage.staffSession ; 'pin' -> localStorage.pinSession.
  session?: 'staff' | 'pin';
  role?: string;
};

const ACCOUNTS: DemoAccount[] = [
  { email: 'owner@womber.fr',     label: 'Club Yuno (Owner)',   sub: 'Club Yuno',      route: '/owner/dashboard', icon: Building2 },
  { email: 'organizer@womber.fr', label: 'Orga Yuno',           sub: 'Yuno Events',    route: '/organizer-app',   icon: CalendarDays },
  { email: 'promoter@womber.fr',  label: 'Promoteur',           sub: 'Alex Rivière',   route: '/promoter',        icon: Megaphone,   session: 'pin',   role: 'promoter' },
  { email: 'dj@womber.fr',        label: 'DJ',                  sub: 'MARCO V',        route: '/dj',              icon: Disc3,       session: 'pin',   role: 'dj' },
  { email: 'affiliate@womber.fr', label: 'Affilié',             sub: 'Yuno Network',   route: '/affiliate',       icon: Share2 },
  { email: 'bouncer@womber.fr',   label: 'Videur (porte)',      sub: 'Accès direct',   route: '/bouncer',         icon: ShieldCheck, session: 'staff', role: 'bouncer' },
  { email: 'barman@womber.fr',    label: 'Barman',              sub: 'Accès direct',   route: '/barman',          icon: Wine,        session: 'staff', role: 'barman' },
  { email: 'cloakroom@womber.fr', label: 'Vestiaire',           sub: 'Accès direct',   route: '/cloakroom',       icon: Shirt,       session: 'staff', role: 'cloakroom' },
];

// Pose la session locale qui satisfait RequireStaffSession / RequirePinSession,
// pour éviter l'étape PIN (verify-pin = edge function CORS-lock / non déployée).
async function setRoleSessionBypass(account: DemoAccount, userId: string | undefined) {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  try {
    if (account.session === 'staff' && account.role) {
      let venueId: string | null = null;
      if (userId) {
        const { data } = await supabase.from('profiles').select('venue_id').eq('id', userId).maybeSingle();
        venueId = data?.venue_id ?? null;
      }
      localStorage.setItem('staffSession', JSON.stringify({ venueId, role: account.role, expiresAt, verifiedAt: Date.now() }));
    } else if (account.session === 'pin' && account.role) {
      localStorage.setItem('pinSession', JSON.stringify({ role: account.role, expiresAt, verifiedAt: Date.now() }));
    }
  } catch { /* localStorage indispo : ignore */ }
}

export function DemoSwitcher() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  const currentEmail = user?.email?.toLowerCase() ?? null;
  const isDemoUser = ACCOUNTS.some((a) => a.email === currentEmail);

  // Dès qu'on est sur un compte démo MFA-gated, poser le bypass MFA local.
  useEffect(() => {
    if (currentEmail && MFA_GATED.has(currentEmail)) setMfaBypass(user?.id);
  }, [user?.id, currentEmail]);

  // État Live : le club/orga démo est-il visible dans l'app publique ?
  useEffect(() => {
    if (!currentEmail) return;
    supabase.rpc('demo_is_live').then(({ data }) => setLive(Boolean(data))).catch(() => {});
  }, [currentEmail]);

  // Rendu UNIQUEMENT pour les comptes démo @womber.fr.
  if (!isDemoUser) return null;

  async function toggleLive() {
    if (liveBusy) return;
    setLiveBusy(true);
    const next = !live;
    try {
      const { data, error } = await supabase.rpc('demo_set_live', { p_live: next });
      if (error) throw error;
      setLive(Boolean(data));
      toast.success(next ? "Club démo visible dans l'app" : "Club démo masqué de l'app");
    } catch (e) {
      toast.error('Bascule Live impossible : ' + (e instanceof Error ? e.message : 'erreur'));
    } finally {
      setLiveBusy(false);
    }
  }

  async function switchTo(account: DemoAccount) {
    if (busy) return;
    if (account.email === currentEmail) {
      if (MFA_GATED.has(account.email)) setMfaBypass(user?.id);
      await setRoleSessionBypass(account, user?.id);
      navigate(account.route);
      setOpen(false);
      return;
    }
    setBusy(account.email);
    try {
      // Filet de secours : si on quitte owner, garder sa session pour pouvoir y revenir
      // même si le mot de passe démo de owner n'est pas encore appliqué côté base.
      if (currentEmail === OWNER_EMAIL && session) {
        localStorage.setItem(
          ORIGIN_KEY,
          JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
        );
      }
      let newUserId: string | undefined;
      // Bascule uniforme : tout compte démo (owner inclus) via signInWithPassword → illimité any→any.
      const { data, error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: DEMO_PASSWORD,
      });
      if (error) {
        // Owner : si le login échoue (mdp démo pas encore posé), restaurer la session sauvegardée.
        if (account.email === OWNER_EMAIL) {
          const raw = localStorage.getItem(ORIGIN_KEY);
          if (!raw) throw error;
          const saved = JSON.parse(raw) as { access_token: string; refresh_token: string };
          const restored = await supabase.auth.setSession({
            access_token: saved.access_token,
            refresh_token: saved.refresh_token,
          });
          if (restored.error) throw error;
          newUserId = restored.data.user?.id;
          localStorage.removeItem(ORIGIN_KEY);
        } else {
          throw error;
        }
      } else {
        newUserId = data.user?.id;
      }
      if (MFA_GATED.has(account.email)) setMfaBypass(newUserId);
      await setRoleSessionBypass(account, newUserId);
      toast.success(`Connecté en ${account.label}`);
      navigate(account.route);
      setOpen(false);
    } catch (e) {
      toast.error('Bascule impossible : ' + (e instanceof Error ? e.message : 'erreur'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Comptes démo"
          className="fixed z-[60] flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-lg ring-1 ring-white/10 transition hover:brightness-110"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)',
            left: '1.25rem',
          }}
        >
          <FlaskConical className="h-4 w-4" />
          Démo
        </button>
      </SheetTrigger>

      <SheetContent side="left" className="w-[340px] border-white/10 bg-[#0A0A0A] text-white">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-white">
            <FlaskConical className="h-5 w-5 text-primary" />
            Comptes démo
          </SheetTitle>
          <p className="text-xs text-white/50">
            Bascule entre les profils pour la démo. Tu es connecté en{' '}
            <span className="font-medium text-white/80">{currentEmail}</span>.
          </p>
        </SheetHeader>

        {/* Toggle Live : faire apparaître le club/orga démo dans l'app publique (pour les présentations). */}
        <button
          type="button"
          onClick={toggleLive}
          disabled={liveBusy || live === null}
          className={`mt-4 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60 ${
            live ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'
          }`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${live ? 'bg-emerald-500/15' : 'bg-white/5'}`}>
            <Globe className={`h-4 w-4 ${live ? 'text-emerald-400' : 'text-white/50'}`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">Live dans l'app</span>
            <span className="block text-[11px] text-white/45">
              {live === null ? '…' : live ? 'Club démo visible publiquement' : 'Masqué — visible des démos seulement'}
            </span>
          </span>
          {liveBusy ? (
            <Loader2 className="h-4 w-4 animate-spin text-white/60" />
          ) : (
            <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${live ? 'bg-emerald-500' : 'bg-white/15'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${live ? 'left-[1.125rem]' : 'left-0.5'}`} />
            </span>
          )}
        </button>

        <div className="mt-5 flex flex-col gap-1.5">
          {ACCOUNTS.map((a) => {
            const Icon = a.icon;
            const isCurrent = a.email === currentEmail;
            const isBusy = busy === a.email;
            return (
              <button
                key={a.email}
                type="button"
                disabled={!!busy}
                onClick={() => switchTo(a)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-50 ${
                  isCurrent
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  <Icon className="h-4 w-4 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{a.label}</span>
                  <span className="block truncate text-[11px] text-white/45">{a.sub}</span>
                </span>
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white/60" />
                ) : isCurrent ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Actuel</span>
                ) : (
                  <ChevronRight className="h-4 w-4 text-white/30" />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-white/45">
          <p className="flex items-start gap-1.5">
            <LogIn className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Staff (videur / barman / vestiaire), DJ et promoteur : connexion{' '}
              <b className="text-white/70">automatique</b>, aucun PIN à saisir.
            </span>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
