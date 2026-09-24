import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Building2, CalendarPlus, Check, Crown, CreditCard, Loader2, MessageCircle,
  PartyPopper, Rocket, ShieldCheck, Upload, Users, Wine, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wordmark } from '@/components/brand/Wordmark';
import {
  RED, T1, T2, T3, BORDER, F_BORDER, INNER_BG, CARD_BG, CARD_SHADOW, POS, WARN,
} from '@/components/promoter/promoter-ui';
import { fetchLinksConfig, whatsappUrl } from '@/lib/yunoLinks';
import {
  KNOWN_TOOLS, PENDING_SIGNUP_KEY, isValidSignupKey, proSignupUrl, type MyProSignup,
} from '@/lib/proSignup';

/**
 * /get-started — la première page d'un pro inscrit depuis la landing.
 *
 * La landing a déjà créé le compte ET le club / l'espace organisateur
 * (complete_pro_signup). Ici on dit « c'est prêt », on reprend ce que la
 * personne a raconté (piliers, billetterie actuelle, date de sa prochaine
 * soirée) pour lui tracer SON plan, et on l'envoie dans le guide
 * d'installation existant. Une seule action principale.
 *
 * Deux arrivées de repli, où la landing n'a pas pu ouvrir la session :
 * email à confirmer, ou compte Yuno déjà existant (connexion). Elles portent
 * `?key=<parcours>` : la page finit alors l'ouverture elle-même.
 */

type Phase = 'loading' | 'completing' | 'ready' | 'none' | 'error';

interface PlanStep {
  id: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  to: string;
}

export default function GetStarted() {
  const { user, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('loading');
  const [signup, setSignup] = useState<MyProSignup | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [founderWa, setFounderWa] = useState<string | null>(null);
  const ran = useRef(false);

  const urlKey = search.get('key');

  useEffect(() => {
    if (authLoading || ran.current) return;

    let pendingKey: string | null = isValidSignupKey(urlKey) ? urlKey : null;
    try {
      if (pendingKey) localStorage.setItem(PENDING_SIGNUP_KEY, pendingKey);
      else {
        const stored = localStorage.getItem(PENDING_SIGNUP_KEY);
        if (isValidSignupKey(stored)) pendingKey = stored;
      }
    } catch { /* stockage indisponible */ }

    if (!user) {
      const back = '/get-started' + (pendingKey ? `?key=${pendingKey}` : '');
      navigate(`/auth?redirect=${encodeURIComponent(back)}`, { replace: true });
      return;
    }
    ran.current = true;

    (async () => {
      const { data, error } = await supabase.rpc('open_my_pro_signup' as never);
      if (!error && data) {
        try { localStorage.removeItem(PENDING_SIGNUP_KEY); } catch { /* ignore */ }
        setSignup(data as unknown as MyProSignup);
        setPhase('ready');
        return;
      }
      if (!pendingKey) {
        setPhase('none');
        return;
      }
      setPhase('completing');
      const { error: cErr } = await supabase.rpc('complete_pro_signup' as never, { p_key: pendingKey } as never);
      if (cErr) {
        setErrorCode(cErr.message);
        setPhase('error');
        return;
      }
      try { localStorage.removeItem(PENDING_SIGNUP_KEY); } catch { /* ignore */ }
      // Rechargement complet : les gardes de rôle relisent owner / organizer.
      window.location.replace('/get-started');
    })();
  }, [authLoading, user, urlKey, navigate]);

  useEffect(() => {
    let alive = true;
    fetchLinksConfig().then((c) => { if (alive) setFounderWa(c.whatsapp_number || null); });
    return () => { alive = false; };
  }, []);

  const isClub = signup?.kind === 'club';
  const orgName = signup?.org_name || (isClub ? t('gs.fallbackClub') : t('gs.fallbackOrg'));
  const base = isClub ? '/owner' : '/organizer-app';
  const startPath = isClub ? '/owner/onboarding' : '/organizer-app/onboarding';

  const plan = useMemo<PlanStep[]>(() => {
    if (!signup) return [];
    const pillars = new Set(signup.pillars ?? []);
    const toolName = signup.current_tool ? KNOWN_TOOLS[signup.current_tool] : undefined;
    const sells = (['tickets', 'guest_list', 'tables', 'drinks'] as const)
      .filter((p) => pillars.has(p) && (p !== 'drinks' || isClub))
      .map((p) => t(`gs.pillar.${p}`));
    const sellsText = sells.length ? sells.join(' · ') : t('gs.pillar.tickets');

    const steps: PlanStep[] = [];
    steps.push(isClub
      ? { id: 'page', icon: Building2, title: t('gs.step.clubPage.t'), desc: t('gs.step.clubPage.d'), to: '/owner/onboarding' }
      : { id: 'page', icon: PartyPopper, title: t('gs.step.orgPage.t'), desc: t('gs.step.orgPage.d'), to: '/organizer-app/onboarding' });
    steps.push({
      id: 'night', icon: CalendarPlus, title: t('gs.step.night.t'),
      desc: t('gs.step.night.d').replace('{pillars}', sellsText), to: `${base}/events`,
    });
    if (pillars.has('tables')) {
      steps.push({ id: 'tables', icon: Crown, title: t('gs.step.tables.t'), desc: t('gs.step.tables.d'), to: `${base}/tables` });
    }
    if (isClub && pillars.has('drinks')) {
      steps.push({ id: 'menu', icon: Wine, title: t('gs.step.menu.t'), desc: t('gs.step.menu.d'), to: '/owner/menu' });
    }
    steps.push({
      id: 'pay', icon: CreditCard, title: t('gs.step.pay.t'), desc: t('gs.step.pay.d'),
      to: isClub ? '/owner/onboarding' : '/organizer-app/payments',
    });
    if (signup.current_tool && signup.current_tool !== 'none') {
      steps.push({
        id: 'import', icon: Upload,
        title: toolName ? t('gs.step.import.t').replace('{tool}', toolName) : t('gs.step.importAny.t'),
        desc: t('gs.step.import.d'), to: `${base}/campaigns/contacts`,
      });
    }
    if (isClub) {
      steps.push({ id: 'live', icon: Rocket, title: t('gs.step.live.t'), desc: t('gs.step.live.d'), to: '/owner/onboarding' });
    }
    // L'équipe ferme la marche : c'est l'étape qu'on coupe quand le plan est long.
    steps.push(isClub
      ? { id: 'team', icon: Users, title: t('gs.step.staff.t'), desc: t('gs.step.staff.d'), to: '/owner/staff' }
      : { id: 'team', icon: Users, title: t('gs.step.team.t'), desc: t('gs.step.team.d'), to: '/organizer-app/team' });
    return steps.slice(0, 7);
  }, [signup, isClub, base, t]);

  const helpUrl = founderWa
    ? whatsappUrl(founderWa, t('gs.help.msg').replace('{org}', orgName))
    : null;

  // ── États d'attente / d'erreur ────────────────────────────────────────────
  if (phase === 'loading' || phase === 'completing') {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: '60vh', gap: 14 }}>
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: RED }} />
          <p style={{ color: T2, fontSize: 14 }}>
            {phase === 'completing' ? t('gs.creating') : t('gs.loading')}
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === 'none' || phase === 'error') {
    return (
      <Shell>
        <Card>
          <h1 style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {phase === 'none' ? t('gs.none.title') : t('gs.error.title')}
          </h1>
          <p style={{ color: T2, fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>
            {phase === 'none'
              ? t('gs.none.body')
              : errorCode === 'already_used' ? t('gs.error.used') : t('gs.error.body')}
          </p>
          <div className="flex flex-wrap gap-2" style={{ marginTop: 18 }}>
            <a href={proSignupUrl(language, { source: 'get_started' })} style={btn('primary')}>
              {t('gs.none.cta')} <ArrowRight className="h-4 w-4" />
            </a>
            {helpUrl && (
              <a href={helpUrl} target="_blank" rel="noopener noreferrer" style={btn('secondary')}>
                <MessageCircle className="h-4 w-4" style={{ color: '#25D366' }} /> {t('gs.help.cta')}
              </a>
            )}
          </div>
        </Card>
      </Shell>
    );
  }

  // ── Prêt ─────────────────────────────────────────────────────────────────
  const firstName = signup?.first_name?.trim();
  const urgency = signup?.next_night === 'week' ? 'week' : signup?.next_night === 'month' ? 'month' : null;
  const minutes = Math.max(10, plan.length * 4);

  return (
    <Shell>
      <div style={{ paddingTop: 8 }}>
        <span
          className="inline-flex items-center gap-1.5"
          style={{
            padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            color: POS, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)',
          }}
        >
          <Check className="h-3.5 w-3.5" /> {isClub ? t('gs.kicker.club') : t('gs.kicker.organizer')}
        </span>
        <h1 style={{ color: T1, fontSize: 30, fontWeight: 740, letterSpacing: '-0.03em', marginTop: 14, lineHeight: 1.1 }}>
          {firstName ? t('gs.title').replace('{name}', firstName) : t('gs.titleNoName')}
        </h1>
        <p style={{ color: T2, fontSize: 15, marginTop: 10, lineHeight: 1.55, maxWidth: 560 }}>
          {(isClub ? t('gs.sub.club') : t('gs.sub.organizer')).replace('{org}', orgName)}
        </p>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }}>
          {[t('gs.fact1'), t('gs.fact2'), t('gs.fact3')].map((f) => (
            <span key={f} style={{ fontSize: 12, color: T2, padding: '5px 10px', borderRadius: 999, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
              {f}
            </span>
          ))}
        </div>
      </div>

      {urgency && (
        <div
          style={{
            marginTop: 20, padding: '12px 14px', borderRadius: 14,
            background: urgency === 'week' ? 'rgba(232,25,44,0.08)' : 'rgba(251,191,36,0.07)',
            border: `1px solid ${urgency === 'week' ? 'rgba(232,25,44,0.25)' : 'rgba(251,191,36,0.22)'}`,
            color: T1, fontSize: 13.5, lineHeight: 1.5,
          }}
        >
          {urgency === 'week' ? t('gs.urgent.week') : t('gs.urgent.month')}
        </div>
      )}

      <Card style={{ marginTop: 20 }}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 style={{ color: T1, fontSize: 16, fontWeight: 680 }}>{t('gs.plan')}</h2>
          <span style={{ color: T3, fontSize: 12 }}>
            {t('gs.planSub').replace('{n}', String(plan.length)).replace('{min}', String(minutes))}
          </span>
        </div>
        <ol style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          {plan.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => navigate(s.to)}
                className="w-full text-left flex items-start gap-3 transition-colors"
                style={{ padding: 12, borderRadius: 12, background: INNER_BG, border: `1px solid ${F_BORDER}`, cursor: 'pointer' }}
              >
                <span
                  className="flex items-center justify-center"
                  style={{ width: 34, height: 34, borderRadius: 10, flex: 'none', background: i === 0 ? RED : 'rgba(255,255,255,0.06)', color: '#fff' }}
                >
                  <s.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span style={{ display: 'block', color: T1, fontSize: 14, fontWeight: 620 }}>
                    <span style={{ color: T3, fontWeight: 500, marginRight: 6 }}>{i + 1}.</span>{s.title}
                  </span>
                  <span style={{ display: 'block', color: T2, fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>{s.desc}</span>
                </span>
                <ArrowRight className="h-4 w-4 flex-none" style={{ color: T3, marginTop: 9 }} />
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-col sm:flex-row gap-2" style={{ marginTop: 16 }}>
          <button type="button" onClick={() => navigate(startPath)} style={{ ...btn('primary'), flex: 1 }}>
            {t('gs.cta.start')} <ArrowRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => navigate(isClub ? '/owner/dashboard' : '/organizer-app')} style={btn('secondary')}>
            {t('gs.cta.dashboard')}
          </button>
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <div className="flex items-start gap-3">
          <MessageCircle className="h-5 w-5 flex-none" style={{ color: '#25D366', marginTop: 2 }} />
          <div className="min-w-0 flex-1">
            <h3 style={{ color: T1, fontSize: 14.5, fontWeight: 650 }}>{t('gs.help.title')}</h3>
            <p style={{ color: T2, fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{t('gs.help.body')}</p>
            {helpUrl && (
              <a href={helpUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn('secondary'), marginTop: 12 }}>
                {t('gs.help.cta')}
              </a>
            )}
          </div>
        </div>
      </Card>

      {isClub && (
        <p className="flex items-start gap-2" style={{ color: T3, fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
          <ShieldCheck className="h-3.5 w-3.5 flex-none" style={{ color: WARN, marginTop: 1 }} />
          {t('gs.mfa')}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <header
        className="mx-auto flex items-center px-4"
        style={{ maxWidth: 720, height: 64, paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <Wordmark height={22} />
      </header>
      <main className="mx-auto px-4 pb-20" style={{ maxWidth: 720 }}>{children}</main>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18, ...style }}>
      {children}
    </section>
  );
}

function btn(variant: 'primary' | 'secondary'): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, padding: '0 18px', borderRadius: 12, fontSize: 14, fontWeight: 640,
    cursor: 'pointer', textDecoration: 'none',
    ...(variant === 'primary'
      ? { background: RED, color: '#fff', border: '1px solid transparent' }
      : { background: INNER_BG, color: T1, border: `1px solid ${BORDER}` }),
  };
}
