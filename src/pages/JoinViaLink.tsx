import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CheckCircle2, XCircle, Loader2, LogIn, ArrowRight, ArrowLeft,
  Ticket, Users, TrendingUp, Music, Calendar, Star, Zap,
  Shield, BarChart3, Link2, MapPin, Package, Scan, List,
  LayoutDashboard, Settings, Eye, EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LucideIcon } from 'lucide-react';

interface LinkInfo {
  role: string;
  label: string | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_cover: string | null;
  organizer_user_id: string | null;
  organizer_name: string | null;
  is_valid: boolean;
  invalid_reason: string | null;
}

type Step = 'overview' | 'form' | 'password';

interface RoleContent {
  headline: string;
  sub: string;
  perks: { icon: LucideIcon; text: string }[];
}

const ROLE_CONTENT: Record<string, RoleContent> = {
  organizer: {
    headline: 'Sell events.\nKeep what you earn.',
    sub: 'Your events, your revenue, your platform.',
    perks: [
      { icon: Ticket, text: 'Sell tickets & VIP tables — zero upfront cost' },
      { icon: TrendingUp, text: 'Revenue analytics after every event' },
      { icon: Users, text: 'DJs, promoters & staff — all in one ecosystem' },
    ],
  },
  dj: {
    headline: 'Get booked.\nBuild your audience.',
    sub: 'Your profile, your gigs, your fanbase.',
    perks: [
      { icon: Music, text: 'Public DJ profile with booking requests' },
      { icon: Calendar, text: 'Track every gig and appearance' },
      { icon: Users, text: 'Connect with venues & organizers directly' },
    ],
  },
  vip_host: {
    headline: 'Own the VIP\nexperience.',
    sub: 'Reservations, bottles, table management.',
    perks: [
      { icon: Star, text: 'Manage VIP table reservations in real-time' },
      { icon: Zap, text: 'Process bottle service orders instantly' },
      { icon: Shield, text: 'Coordinate with the full team seamlessly' },
    ],
  },
  barman: {
    headline: 'Take orders.\nMove faster.',
    sub: 'Drink orders pushed directly to you.',
    perks: [
      { icon: Zap, text: 'Orders sent directly to your screen' },
      { icon: BarChart3, text: 'Track your sales per shift' },
      { icon: Users, text: 'Sync with the bar team in real-time' },
    ],
  },
  bouncer: {
    headline: 'Check in.\nControl the door.',
    sub: 'Scan tickets and manage access in seconds.',
    perks: [
      { icon: Scan, text: 'Scan any ticket in under 2 seconds' },
      { icon: List, text: 'Real-time guest list at your fingertips' },
      { icon: Shield, text: 'Flag incidents instantly to the team' },
    ],
  },
  owner: {
    headline: 'Run your venue.\nKnow your numbers.',
    sub: 'Tickets, VIP, drinks — one dashboard.',
    perks: [
      { icon: LayoutDashboard, text: 'Tickets, VIP tables, and drinks unified' },
      { icon: Users, text: 'Full staff management in one place' },
      { icon: TrendingUp, text: 'Revenue analytics, zero guesswork' },
    ],
  },
  promoter: {
    headline: 'Promote.\nConvert. Earn.',
    sub: 'Track every ticket sold from your link.',
    perks: [
      { icon: Link2, text: 'Personal tracking links for every event' },
      { icon: TrendingUp, text: 'Commission on every ticket you sell' },
      { icon: MapPin, text: 'Multi-venue portfolio, single dashboard' },
    ],
  },
  manager: {
    headline: 'Manage.\nOversee. Optimize.',
    sub: 'Full operational control for your venue.',
    perks: [
      { icon: Settings, text: 'Manage staff across all departments' },
      { icon: TrendingUp, text: 'Operational analytics and reporting' },
      { icon: Shield, text: 'Access controls and permissions' },
    ],
  },
  cloakroom: {
    headline: 'Check coats.\nKeep it moving.',
    sub: 'Fast, organized cloakroom management.',
    perks: [
      { icon: Package, text: 'Digital ticket system for coats' },
      { icon: Zap, text: 'Fast pickup at closing time' },
      { icon: Users, text: 'Sync with the door team' },
    ],
  },
};

const FALLBACK_ROLE: RoleContent = {
  headline: 'Join the team.\nNight starts here.',
  sub: 'Your Yuno profile, set up in 60 seconds.',
  perks: [
    { icon: Zap, text: 'Set up your profile in under a minute' },
    { icon: Users, text: 'Connect with your venue and team' },
    { icon: Shield, text: 'Secure, private, always in your control' },
  ],
};

function VisualPanel({ info, t }: { info: LinkInfo | null; t: (k: string) => string }) {
  const content = info ? (ROLE_CONTENT[info.role] ?? FALLBACK_ROLE) : FALLBACK_ROLE;
  const inviter = info?.venue_name || info?.organizer_name || null;
  const hasCover = !!info?.venue_cover;

  return (
    <div className="relative lg:w-[55%] min-h-[52vw] lg:min-h-screen overflow-hidden flex flex-col" style={{ minHeight: 'clamp(260px, 52vw, 100vh)' }}>
      {/* Background */}
      {hasCover ? (
        <img
          src={info!.venue_cover!}
          alt={inviter ?? 'Venue'}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[#0A0A0A]">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 65% 35%, rgba(232,25,44,0.18) 0%, transparent 60%)' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 20% 80%, rgba(232,25,44,0.08) 0%, transparent 50%)' }} />
        </div>
      )}
      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-between h-full p-5 lg:p-10">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <img src="/yuno-icon-192.png" alt="Yuno" className="w-7 h-7 rounded-lg" />
          <span className="text-white font-bold text-lg tracking-tight">yuno</span>
        </div>

        {/* Main content */}
        <div className="mt-5 lg:mt-auto">
          {/* Role badge */}
          <div className="inline-flex items-center gap-1.5 bg-[#E8192C]/20 border border-[#E8192C]/30 rounded-full px-3 py-1 mb-3 lg:mb-5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#E8192C]" />
            <span className="text-[#E8192C] text-xs font-semibold uppercase tracking-wider">
              {info ? (t(`join.role.${info.role}`) || info.role) : 'Pro'}
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-white font-bold leading-[1.1] mb-2 lg:mb-3 whitespace-pre-line"
            style={{ fontSize: 'clamp(22px, 5vw, 46px)' }}>
            {content.headline}
          </h1>
          <p className="text-white/60 text-xs lg:text-base mb-4 lg:mb-7">{content.sub}</p>

          {/* Perks — hidden on very small mobile to keep panel tight */}
          <ul className="space-y-2 lg:space-y-3">
            {content.perks.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2.5 lg:gap-3">
                <div className="flex-shrink-0 w-6 h-6 lg:w-7 lg:h-7 rounded-full bg-[#E8192C]/15 flex items-center justify-center">
                  <Icon className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-[#E8192C]" />
                </div>
                <span className="text-white/80 text-xs lg:text-sm">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function JoinViaLink() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const token = searchParams.get('token');

  const [checking, setChecking] = useState(true);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; redirect?: string } | null>(null);

  const [step, setStep] = useState<Step>('overview');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [stageName, setStageName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!token) { setChecking(false); return; }
      try {
        const res = await supabase.rpc('get_onboarding_link_public' as never, { p_token: token } as never);
        const data = res.data as LinkInfo[] | LinkInfo | null;
        const row: LinkInfo | null = Array.isArray(data) ? (data[0] ?? null) : data;
        if (res.error || !row) { setChecking(false); return; }
        setInfo(row);
      } catch (err) {
        console.error('get_onboarding_link_public error:', err);
      } finally {
        setChecking(false);
      }
    };
    check();
  }, [token]);

  const redeem = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setExistingAccount(false);
    try {
      const headers: Record<string, string> = {};
      const body: Record<string, unknown> = { action: 'redeem_onboarding_link', token };

      if (user) {
        const { data: session } = await supabase.auth.getSession();
        if (session.session?.access_token) headers.Authorization = `Bearer ${session.session.access_token}`;
      } else {
        body.email = email.trim();
        body.first_name = firstName || undefined;
        body.last_name = lastName || undefined;
        if (info?.role === 'dj' && stageName) body.stage_name = stageName;
        if (step === 'password' && password) body.password = password;
      }

      const response = await supabase.functions.invoke('accept-staff-invitation', {
        body,
        headers: Object.keys(headers).length ? headers : undefined,
      });
      if (response.error) throw new Error(response.error.message);

      const data = response.data;

      if (data?.code === 'need_password') {
        setStep('password');
        return;
      }

      if (data?.error) {
        if (data.code === 'account_exists') setExistingAccount(true);
        setResult({ success: false, message: data.error });
        return;
      }

      if (!user && password) {
        await supabase.auth.signInWithPassword({ email: email.trim(), password });
      }

      setResult({ success: true, message: data.message || t('join.success'), redirect: data.redirect || '/' });
      toast.success(data.message || t('join.success'));
    } catch (err) {
      console.error('redeem_onboarding_link error:', err);
      setResult({ success: false, message: err instanceof Error ? err.message : t('join.genericError') });
    } finally {
      setLoading(false);
    }
  }, [token, user, email, password, firstName, lastName, stageName, info, step, t]);

  const goLoginBack = () =>
    navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);

  // ─── Loading / checking ───────────────────────────────────────────────────
  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#E8192C' }} />
      </div>
    );
  }

  // ─── Invalid / expired link ───────────────────────────────────────────────
  if (!token || !info || !info.is_valid) {
    const reason = info?.invalid_reason;
    const msg =
      reason === 'expired' ? t('join.expired')
      : reason === 'full' ? t('join.full')
      : reason === 'revoked' ? t('join.revoked')
      : t('join.invalidDesc');
    return (
      <div className="min-h-screen flex lg:flex-row flex-col" style={{ background: '#0A0A0A' }}>
        <VisualPanel info={null} t={t} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-red-950/40 border border-red-900/40 flex items-center justify-center mx-auto mb-5">
              <XCircle className="h-8 w-8 text-red-400" />
            </div>
            <h2 className="text-white text-xl font-semibold mb-2">{t('join.invalid')}</h2>
            <p className="text-white/50 text-sm mb-6">{msg}</p>
            <Button onClick={() => navigate('/')} className="bg-[#E8192C] hover:bg-[#FF2438] text-white">
              {t('join.backHome')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Processing overlay ───────────────────────────────────────────────────
  if (loading && result === null) {
    return (
      <div className="min-h-screen flex lg:flex-row flex-col" style={{ background: '#0A0A0A' }}>
        <VisualPanel info={info} t={t} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
              <Loader2 className="h-8 w-8 animate-spin text-[#E8192C]" />
            </div>
            <p className="text-white/70 text-sm">{t('join.processing')}</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Success / error result ───────────────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-screen flex lg:flex-row flex-col" style={{ background: '#0A0A0A' }}>
        <VisualPanel info={info} t={t} />
        <div className="flex-1 flex items-center justify-center p-8">
          {result.success ? (
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 rounded-2xl bg-green-950/40 border border-green-900/40 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="h-10 w-10 text-green-400" />
              </div>
              <h2 className="text-white text-2xl font-bold mb-2">{t('join.welcome')}</h2>
              <p className="text-white/50 text-sm mb-8">{t('join.successSub')}</p>
              <Button
                className="w-full bg-[#E8192C] hover:bg-[#FF2438] text-white font-semibold py-3 h-auto"
                onClick={() => navigate(result.redirect || '/')}
              >
                {t('join.openDashboard')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 rounded-2xl bg-red-950/40 border border-red-900/40 flex items-center justify-center mx-auto mb-5">
                <XCircle className="h-8 w-8 text-red-400" />
              </div>
              <h2 className="text-white text-xl font-semibold mb-2">{t('join.error')}</h2>
              <p className="text-white/50 text-sm mb-6">{result.message}</p>
              {existingAccount ? (
                <Button className="w-full bg-[#E8192C] hover:bg-[#FF2438] text-white" onClick={goLoginBack}>
                  <LogIn className="h-4 w-4 mr-2" />
                  {t('join.login')}
                </Button>
              ) : (
                <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/5" onClick={() => setResult(null)}>
                  {t('join.retry')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const roleLabel = t(`join.role.${info.role}`) || info.role;

  // ─── Logged-in: one-tap join ──────────────────────────────────────────────
  if (user) {
    return (
      <div className="min-h-screen flex lg:flex-row flex-col" style={{ background: '#0A0A0A' }}>
        <VisualPanel info={info} t={t} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-sm">
            <div className="mb-6">
              <div className="inline-flex items-center gap-1.5 bg-[#E8192C]/10 border border-[#E8192C]/20 rounded-full px-3 py-1 mb-4">
                <div className="w-1.5 h-1.5 rounded-full bg-[#E8192C]" />
                <span className="text-[#E8192C] text-xs font-medium">{t('join.privateInvite')}</span>
              </div>
              {(info.venue_name || info.organizer_name) ? (
                <>
                  <p className="text-white/50 text-sm mb-0.5">{t('join.welcomeAt')}</p>
                  <h2 className="text-white font-bold leading-tight mb-2" style={{ fontSize: 'clamp(22px, 6vw, 32px)' }}>
                    {info.venue_name || info.organizer_name}
                  </h2>
                  <p className="text-white/40 text-sm">{t('join.forYouOnly')}</p>
                </>
              ) : (
                <>
                  <h2 className="text-white text-2xl font-bold mb-1">{t('join.youreInvited')}</h2>
                  <p className="text-white/40 text-sm">{t('join.joinTheTeam')}</p>
                </>
              )}
            </div>

            {/* Account pill */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 mb-6">
              <div className="w-9 h-9 rounded-full bg-[#E8192C]/20 border border-[#E8192C]/30 flex items-center justify-center flex-shrink-0">
                <span className="text-[#E8192C] text-xs font-bold">
                  {user.email?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-white/40 text-xs">{t('join.loggedInAs')}</p>
                <p className="text-white text-sm font-medium truncate">{user.email}</p>
              </div>
            </div>

            {/* Role highlight */}
            <div className="p-4 rounded-xl bg-[#E8192C]/8 border border-[#E8192C]/20 mb-6">
              <p className="text-white/40 text-xs mb-1">{t('join.yourRole')}</p>
              <p className="text-white font-semibold">{roleLabel}</p>
            </div>

            <Button
              className="w-full bg-[#E8192C] hover:bg-[#FF2438] text-white font-semibold py-3.5 h-auto text-base"
              onClick={redeem}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('join.loggedInJoin')} {roleLabel}
              {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Not logged in: multi-step funnel ────────────────────────────────────
  const emailValid = email.trim().length > 3 && email.includes('@');
  const canSubmitForm = emailValid && (info.role !== 'dj' || true); // stageName optional
  const canSubmitPassword = password.length >= 6;

  // Step progress indicator
  const steps = ['overview', 'form', 'password'] as Step[];
  const currentStepIdx = steps.indexOf(step);
  const visibleSteps = ['overview', 'form']; // password is conditional

  return (
    <div className="min-h-screen flex lg:flex-row flex-col" style={{ background: '#0A0A0A' }}>
      <VisualPanel info={info} t={t} />

      <div className="flex-1 flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-sm">

          {/* Step: overview */}
          {step === 'overview' && (
            <div className="animate-in fade-in duration-300">
              {/* Welcome header — personalized if inviter name exists */}
              <div className="mb-6">
                <div className="inline-flex items-center gap-1.5 bg-[#E8192C]/10 border border-[#E8192C]/20 rounded-full px-3 py-1 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#E8192C]" />
                  <span className="text-[#E8192C] text-xs font-medium">{t('join.privateInvite')}</span>
                </div>
                {(info.venue_name || info.organizer_name) ? (
                  <>
                    <p className="text-white/50 text-sm mb-0.5">{t('join.welcomeAt')}</p>
                    <h2 className="text-white font-bold leading-tight mb-2" style={{ fontSize: 'clamp(22px, 6vw, 32px)' }}>
                      {info.venue_name || info.organizer_name}
                    </h2>
                    <p className="text-white/40 text-sm">{t('join.forYouOnly')}</p>
                  </>
                ) : (
                  <>
                    <h2 className="text-white text-2xl font-bold mb-2">{t('join.youreInvited')}</h2>
                    <p className="text-white/40 text-sm">{t('join.joinTheTeam')}</p>
                  </>
                )}
              </div>

              {/* Role card */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 mb-5">
                <p className="text-white/40 text-xs mb-1">{t('join.yourRole')}</p>
                <p className="text-white font-semibold text-lg">{roleLabel}</p>
                {info.label && <p className="text-white/40 text-xs mt-0.5">{info.label}</p>}
              </div>

              <Button
                className="w-full bg-[#E8192C] hover:bg-[#FF2438] text-white font-semibold py-3.5 h-auto text-base mb-3"
                onClick={() => setStep('form')}
              >
                {t('join.acceptInvitation')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                className="w-full text-white/40 hover:text-white hover:bg-white/5 text-sm"
                onClick={goLoginBack}
              >
                <LogIn className="h-3.5 w-3.5 mr-2" />
                {t('join.haveAccount')}
              </Button>
            </div>
          )}

          {/* Step: form */}
          {step === 'form' && (
            <div className="animate-in fade-in duration-300">
              {/* Progress */}
              <div className="flex items-center gap-2 mb-8">
                <div className="flex gap-1.5">
                  {visibleSteps.map((s, i) => (
                    <div
                      key={s}
                      className="h-1 rounded-full transition-all duration-300"
                      style={{
                        width: i <= currentStepIdx - 1 ? '28px' : '8px',
                        background: i <= currentStepIdx - 1 ? '#E8192C' : 'rgba(255,255,255,0.15)',
                      }}
                    />
                  ))}
                </div>
                <span className="text-white/30 text-xs ml-1">{t('join.stepProfile')}</span>
              </div>

              <div className="mb-7">
                <h2 className="text-white text-2xl font-bold mb-1">{t('join.stepProfile')}</h2>
                <p className="text-white/40 text-sm">As {roleLabel}</p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-white/60 text-xs font-medium">{t('join.firstName')}</Label>
                    <Input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-[#E8192C]/60 focus:ring-[#E8192C]/20 h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/60 text-xs font-medium">{t('join.lastName')}</Label>
                    <Input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-[#E8192C]/60 focus:ring-[#E8192C]/20 h-11"
                    />
                  </div>
                </div>

                {info.role === 'dj' && (
                  <div className="space-y-1.5">
                    <Label className="text-white/60 text-xs font-medium">{t('join.stageName')}</Label>
                    <Input
                      value={stageName}
                      onChange={(e) => setStageName(e.target.value)}
                      placeholder={t('join.stageNamePh')}
                      className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-[#E8192C]/60 focus:ring-[#E8192C]/20 h-11"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-white/60 text-xs font-medium">Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-[#E8192C]/60 focus:ring-[#E8192C]/20 h-11"
                  />
                </div>

                <Button
                  className="w-full bg-[#E8192C] hover:bg-[#FF2438] text-white font-semibold py-3.5 h-auto text-base mt-2"
                  onClick={redeem}
                  disabled={loading || !canSubmitForm}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t('join.continue')}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setStep('overview')}
                    className="flex items-center gap-1.5 text-white/30 hover:text-white/60 text-xs transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    {t('join.backStep')}
                  </button>
                  <button
                    type="button"
                    onClick={goLoginBack}
                    className="flex items-center gap-1 text-white/30 hover:text-white/60 text-xs transition-colors cursor-pointer"
                  >
                    <LogIn className="h-3 w-3" />
                    {t('join.haveAccount')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step: password */}
          {step === 'password' && (
            <div className="animate-in fade-in duration-300">
              {/* Progress */}
              <div className="flex items-center gap-2 mb-8">
                <div className="flex gap-1.5">
                  {[...visibleSteps, 'password'].map((s, i) => (
                    <div
                      key={s}
                      className="h-1 rounded-full transition-all duration-300"
                      style={{
                        width: i <= 2 ? '28px' : '8px',
                        background: i <= 2 ? '#E8192C' : 'rgba(255,255,255,0.15)',
                      }}
                    />
                  ))}
                </div>
                <span className="text-white/30 text-xs ml-1">{t('join.stepPassword')}</span>
              </div>

              <div className="mb-7">
                <h2 className="text-white text-2xl font-bold mb-1">{t('join.stepPassword')}</h2>
                <p className="text-white/40 text-sm">{t('join.newAccountPasswordHint')}</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-white/60 text-xs font-medium">{t('join.password')}</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('join.passwordPh')}
                      className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-[#E8192C]/60 focus:ring-[#E8192C]/20 h-11 pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Password strength indicator */}
                <div className="flex gap-1">
                  {[6, 8, 10, 12].map((threshold) => (
                    <div
                      key={threshold}
                      className="flex-1 h-1 rounded-full transition-all duration-300"
                      style={{
                        background: password.length >= threshold ? '#E8192C' : 'rgba(255,255,255,0.1)',
                      }}
                    />
                  ))}
                </div>

                <Button
                  className="w-full bg-[#E8192C] hover:bg-[#FF2438] text-white font-semibold py-3.5 h-auto text-base"
                  onClick={redeem}
                  disabled={loading || !canSubmitPassword}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t('join.createAndJoin')}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>

                <button
                  type="button"
                  onClick={() => { setStep('form'); setPassword(''); }}
                  className="flex items-center gap-1.5 text-white/30 hover:text-white/60 text-xs transition-colors cursor-pointer mx-auto"
                  disabled={loading}
                >
                  <ArrowLeft className="h-3 w-3" />
                  {t('join.changeEmail')}
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <p className="text-white/20 text-xs text-center mt-10">{t('join.poweredBy')}</p>
        </div>
      </div>
    </div>
  );
}
