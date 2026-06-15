import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Building2, CalendarDays, Megaphone, Share2, ShieldCheck, Wine, Shirt,
  ChevronRight, Loader2, FlaskConical, LogIn,
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

type DemoAccount = {
  email: string;
  label: string;
  sub: string;
  route: string;
  icon: typeof Building2;
};

const ACCOUNTS: DemoAccount[] = [
  { email: 'owner@womber.fr',     label: 'Club (Owner)',        sub: 'Womber',             route: '/owner/dashboard', icon: Building2 },
  { email: 'organizer@womber.fr', label: 'Organisateur / BDE',  sub: 'BDE Démo Paris',     route: '/organizer-app',   icon: CalendarDays },
  { email: 'promoter@womber.fr',  label: 'Promoteur',           sub: 'WOMBER-DEMO',        route: '/promoter',        icon: Megaphone },
  { email: 'affiliate@womber.fr', label: 'Affilié',             sub: 'Paris Night Agency', route: '/affiliate',       icon: Share2 },
  { email: 'bouncer@womber.fr',   label: 'Videur (porte)',      sub: 'PIN 1234',           route: '/bouncer',         icon: ShieldCheck },
  { email: 'barman@womber.fr',    label: 'Barman',              sub: 'PIN 1234',           route: '/barman',          icon: Wine },
  { email: 'cloakroom@womber.fr', label: 'Vestiaire',           sub: 'PIN 1234',           route: '/cloakroom',       icon: Shirt },
];

export function DemoSwitcher() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const currentEmail = user?.email?.toLowerCase() ?? null;
  const isDemoUser = ACCOUNTS.some((a) => a.email === currentEmail);

  // Rendu UNIQUEMENT pour les comptes démo @womber.fr.
  if (!isDemoUser) return null;

  async function switchTo(account: DemoAccount) {
    if (busy) return;
    if (account.email === currentEmail) {
      navigate(account.route);
      setOpen(false);
      return;
    }
    setBusy(account.email);
    try {
      if (account.email === OWNER_EMAIL) {
        // Retour owner : restaurer la session sauvegardée (pas de mdp embarqué).
        const raw = localStorage.getItem(ORIGIN_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { access_token: string; refresh_token: string };
          const { error } = await supabase.auth.setSession({
            access_token: saved.access_token,
            refresh_token: saved.refresh_token,
          });
          if (error) throw error;
          localStorage.removeItem(ORIGIN_KEY);
          toast.success('Retour sur owner@womber.fr');
          navigate(account.route);
        } else {
          toast.info('Reconnecte-toi en owner@womber.fr pour revenir.');
          navigate('/auth');
        }
      } else {
        // Vers un compte démo : sauvegarder la session owner si on part de owner.
        if (currentEmail === OWNER_EMAIL && session) {
          localStorage.setItem(
            ORIGIN_KEY,
            JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
          );
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: account.email,
          password: DEMO_PASSWORD,
        });
        if (error) throw error;
        toast.success(`Connecté en ${account.label}`);
        navigate(account.route);
      }
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
              Le staff (videur / barman / vestiaire) demande le PIN <b className="text-white/70">1234</b> une
              fois après la bascule.
            </span>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
