import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Building2, CalendarDays, Megaphone, Share2, ShieldCheck, Wine, Shirt,
  Disc3, ChevronRight, Loader2, FlaskConical, LogIn, Globe, Rocket, Crown, GraduationCap, Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { PLANS, PlanCode } from '@/lib/planFeatures';
import { getDemoPlan, setDemoPlan, DEMO_PLAN_EVENT } from '@/lib/demoPlan';
import { setMfaBypass, setRoleSessionBypass, MFA_GATED } from '@/lib/demoSession';
import { isPreviewActive } from '@/contexts/PreviewModeContext';

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

// MFA_GATED / setMfaBypass / setRoleSessionBypass sont partagés avec PreviewGate
// via @/lib/demoSession (aucun changement de comportement).

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

// Tiers proposés au switch démo : les trois abonnements aux gates de features
// réellement distincts. Elite est volontairement exclu (« Bientôt », non achetable,
// et fonctionnellement identique à Pro).
const DEMO_PLAN_TIERS: PlanCode[] = ['core', 'essential', 'pro'];

const ACCOUNTS: DemoAccount[] = [
  { email: 'owner@womber.fr',     label: 'Club Yuno (Owner)',   sub: 'Club Yuno',      route: '/owner/dashboard', icon: Building2 },
  { email: 'organizer@womber.fr', label: 'Orga Yuno',           sub: 'Yuno Events',    route: '/organizer-app',   icon: CalendarDays },
  { email: 'bde@womber.fr',       label: 'BDE Démo',            sub: 'Bureau Des Étudiants', route: '/organizer-app', icon: GraduationCap },
  { email: 'promoter@womber.fr',  label: 'Promoteur',           sub: 'Alex Rivière',   route: '/promoter',        icon: Megaphone,   session: 'pin',   role: 'promoter' },
  { email: 'agency@womber.fr',    label: 'Agence promoteurs',   sub: 'Nightlife Collective', route: '/agency-app', icon: Users },
  { email: 'dj@womber.fr',        label: 'DJ',                  sub: 'MARCO V',        route: '/dj',              icon: Disc3,       session: 'pin',   role: 'dj' },
  { email: 'affiliate@womber.fr', label: 'Affilié',             sub: 'Yuno Network',   route: '/affiliate',       icon: Share2 },
  { email: 'bouncer@womber.fr',   label: 'Videur (porte)',      sub: 'Accès direct',   route: '/bouncer',         icon: ShieldCheck, session: 'staff', role: 'bouncer' },
  { email: 'barman@womber.fr',    label: 'Barman',              sub: 'Accès direct',   route: '/barman',          icon: Wine,        session: 'staff', role: 'barman' },
  { email: 'cloakroom@womber.fr', label: 'Vestiaire',           sub: 'Accès direct',   route: '/cloakroom',       icon: Shirt,       session: 'staff', role: 'cloakroom' },
  { email: 'viphost@womber.fr',   label: 'Hôte VIP',            sub: 'Accès direct',   route: '/vip-host',        icon: Crown,       session: 'staff', role: 'vip_host' },
];

export function DemoSwitcher() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [demoPlan, setDemoPlanState] = useState<PlanCode>(getDemoPlan());

  const currentEmail = user?.email?.toLowerCase() ?? null;
  const isDemoUser = ACCOUNTS.some((a) => a.email === currentEmail);

  // Garder la pastille du plan actif synchro si la page billing le change aussi.
  useEffect(() => {
    const handler = () => setDemoPlanState(getDemoPlan());
    window.addEventListener(DEMO_PLAN_EVENT, handler);
    return () => window.removeEventListener(DEMO_PLAN_EVENT, handler);
  }, []);

  // Dès qu'on est sur un compte démo MFA-gated, poser le bypass MFA local.
  useEffect(() => {
    if (currentEmail && MFA_GATED.has(currentEmail)) setMfaBypass(user?.id);
  }, [user?.id, currentEmail]);

  // État Live : le club/orga démo est-il visible dans l'app publique ?
  useEffect(() => {
    if (!currentEmail) return;
    supabase.rpc('demo_is_live').then(({ data }) => setLive(Boolean(data)), () => {});
  }, [currentEmail]);

  // Jamais visible dans un aperçu preview (lecture seule envoyé à un prospect).
  if (isPreviewActive()) return null;
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

  function pickPlan(code: PlanCode) {
    setDemoPlan(code);        // localStorage + event → le dashboard se re-gate en direct
    setDemoPlanState(code);
    toast.success(`Abonnement démo : ${PLANS[code].name}`);
  }

  async function switchTo(account: DemoAccount, routeOverride?: string) {
    if (busy) return;
    if (account.email === currentEmail) {
      if (MFA_GATED.has(account.email)) setMfaBypass(user?.id);
      await setRoleSessionBypass(account, user?.id);
      navigate(routeOverride ?? account.route);
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
      navigate(routeOverride ?? account.route);
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
          className={`fixed z-[60] ${open ? 'hidden' : 'flex'} items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-lg ring-1 ring-white/10 transition hover:brightness-110`}
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)',
            left: '1.25rem',
          }}
        >
          <FlaskConical className="h-4 w-4" />
          Démo
        </button>
      </SheetTrigger>

      <SheetContent side="left" className="flex w-[340px] flex-col overflow-y-auto border-white/10 bg-[#0A0A0A] pb-8 text-white">
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

        {/* Switch d'abonnement démo : uniquement pour le club (owner), là où les
            gates de features du dashboard s'appliquent. Bascule instantanée, sans Stripe. */}
        {currentEmail === OWNER_EMAIL && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">Abonnement du club</p>
            <div className="grid grid-cols-3 gap-1.5">
              {DEMO_PLAN_TIERS.map((code) => {
                const active = demoPlan === code;
                const p = PLANS[code];
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => pickPlan(code)}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-center transition ${
                      active
                        ? 'border-primary/50 bg-primary/15 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="text-[12px] font-semibold">{p.name}</span>
                    <span className="text-[10px] text-white/45">{p.price === 0 ? 'Gratuit' : `${p.price}€`}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Change le plan à la volée : les fonctionnalités du dashboard se verrouillent /
              déverrouillent selon le tier. (Elite = « Bientôt », non achetable.)
            </p>
          </div>
        )}

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

        {/* Onboarding démo : lance le flux owner / orga en mode preview (non destructif) */}
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">Onboarding</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => { const a = ACCOUNTS.find((x) => x.email === OWNER_EMAIL); if (a) switchTo(a, '/owner/onboarding?preview=1'); }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-[12px] font-medium text-white/80 transition hover:bg-white/[0.07] disabled:opacity-50"
            >
              <Rocket className="h-3.5 w-3.5 text-primary" />Onboarding club
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => { const a = ACCOUNTS.find((x) => x.email === 'organizer@womber.fr'); if (a) switchTo(a, '/organizer-app/onboarding?preview=1'); }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-[12px] font-medium text-white/80 transition hover:bg-white/[0.07] disabled:opacity-50"
            >
              <Rocket className="h-3.5 w-3.5 text-primary" />Onboarding orga
            </button>
          </div>

          {/* Intros first-run des autres rôles (?intro=1 force l'affichage) */}
          <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-white/35">Intros rôles</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { email: 'promoter@womber.fr',  label: 'Promoteur', route: '/promoter?intro=1' },
              { email: 'bouncer@womber.fr',   label: 'Videur',    route: '/bouncer?intro=1' },
              { email: 'barman@womber.fr',    label: 'Barman',    route: '/barman?intro=1' },
              { email: 'viphost@womber.fr',   label: 'Hôte VIP',  route: '/vip-host?intro=1' },
              { email: 'affiliate@womber.fr', label: 'Affilié',   route: '/affiliate?intro=1' },
            ].map((it) => (
              <button
                key={it.email}
                type="button"
                disabled={!!busy}
                onClick={() => { const a = ACCOUNTS.find((x) => x.email === it.email); if (a) switchTo(a, it.route); }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-[12px] font-medium text-white/80 transition hover:bg-white/[0.07] disabled:opacity-50"
              >
                <Rocket className="h-3.5 w-3.5 text-primary" />{it.label}
              </button>
            ))}
          </div>
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
