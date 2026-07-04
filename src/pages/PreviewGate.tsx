// Gate d'aperçu (preview) : /preview?token=…
//
// Étape mot de passe avant l'accès. Le prospect saisit LE mot de passe de son lien
// (ex. « el sorbo »), on le vérifie côté serveur, on le connecte au compte démo ciblé
// puis on l'arme en LECTURE SEULE et on l'envoie sur le bon dashboard.
//
// La page respecte la LANGUE par défaut du lien (en/fr/es) dès l'écran mot de passe.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Lock, Eye, AlertTriangle, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DEMO_ACCOUNTS, applyDemoBypass, type TargetAccount } from '@/lib/demoSession';
import { enablePreviewMode } from '@/contexts/PreviewModeContext';
import { useLanguage, type Language } from '@/contexts/LanguageContext';
import { recordLegalAcceptance } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';

const RED = '#E8192C';

interface LinkInfo {
  label: string;
  target_accounts: TargetAccount[];
  language: string;
  is_valid: boolean;
  invalid_reason: string | null;
}

type Lang = 'en' | 'fr' | 'es';

const COPY: Record<Lang, {
  badge: string;
  hi: string;
  lead: (roles: string, count: number) => string;
  pw: string;
  enter: string;
  footer: string;
  loading: string;
  unavailable: string;
  consent: string;
  consentLink: string;
  invalid: Record<string, string>;
  err: { wrong: string; locked: string; expired: string; revoked: string; generic: string; unknown: string };
}> = {
  en: {
    badge: 'YUNO PREVIEW',
    hi: 'Hi',
    lead: (roles, count) =>
      `Read-only demo access to the ${roles} ${count > 1 ? 'dashboards' : 'dashboard'}. Enter your password to continue.`,
    pw: 'Password',
    enter: 'Enter preview',
    footer: 'Demo preview. Everything is read-only — no real data can be created or modified.',
    loading: 'Loading…',
    unavailable: 'Preview unavailable',
    consent: 'By entering, I agree to keep this preview confidential and not to reproduce it.',
    consentLink: 'Confidentiality Commitment',
    invalid: {
      not_found: 'This preview link was not found.',
      revoked: 'This preview link has been disabled.',
      expired: 'This preview link has expired.',
      locked: 'Too many attempts. This link is temporarily locked.',
      default: "This preview link isn't valid.",
    },
    err: {
      wrong: 'Incorrect password.',
      locked: 'Too many attempts. Try again later.',
      expired: 'This preview link has expired.',
      revoked: 'This preview link has been disabled.',
      generic: 'Access denied. Check your password.',
      unknown: 'Something went wrong. Try again.',
    },
  },
  fr: {
    badge: 'APERÇU YUNO',
    hi: 'Bonjour',
    lead: (roles, count) =>
      `Accès démo en lecture seule ${count > 1 ? 'aux tableaux de bord' : 'au tableau de bord'} ${roles}. Saisis ton mot de passe pour entrer.`,
    pw: 'Mot de passe',
    enter: "Entrer dans l'aperçu",
    footer: 'Aperçu de démonstration. Tout est en lecture seule — aucune donnée réelle ne peut être créée ou modifiée.',
    loading: 'Chargement…',
    unavailable: 'Aperçu indisponible',
    consent: "En entrant, je m'engage à garder cet aperçu confidentiel et à ne pas le reproduire.",
    consentLink: 'Engagement de Confidentialité',
    invalid: {
      not_found: "Ce lien d'aperçu est introuvable.",
      revoked: "Ce lien d'aperçu a été désactivé.",
      expired: "Ce lien d'aperçu a expiré.",
      locked: 'Trop de tentatives. Ce lien est temporairement bloqué.',
      default: "Ce lien d'aperçu n'est pas valide.",
    },
    err: {
      wrong: 'Mot de passe incorrect.',
      locked: 'Trop de tentatives. Réessaie plus tard.',
      expired: "Ce lien d'aperçu a expiré.",
      revoked: "Ce lien d'aperçu a été désactivé.",
      generic: 'Accès impossible. Vérifie ton mot de passe.',
      unknown: 'Une erreur est survenue. Réessaie.',
    },
  },
  es: {
    badge: 'VISTA PREVIA YUNO',
    hi: 'Hola',
    lead: (roles, count) =>
      `Acceso de demostración de solo lectura ${count > 1 ? 'a los paneles' : 'al panel'} ${roles}. Introduce tu contraseña para entrar.`,
    pw: 'Contraseña',
    enter: 'Entrar a la vista previa',
    footer: 'Vista previa de demostración. Todo es de solo lectura — no se puede crear ni modificar ningún dato real.',
    loading: 'Cargando…',
    unavailable: 'Vista previa no disponible',
    consent: 'Al entrar, me comprometo a mantener esta vista previa confidencial y a no reproducirla.',
    consentLink: 'Compromiso de Confidencialidad',
    invalid: {
      not_found: 'No se encontró este enlace de vista previa.',
      revoked: 'Este enlace de vista previa ha sido desactivado.',
      expired: 'Este enlace de vista previa ha caducado.',
      locked: 'Demasiados intentos. Este enlace está bloqueado temporalmente.',
      default: 'Este enlace de vista previa no es válido.',
    },
    err: {
      wrong: 'Contraseña incorrecta.',
      locked: 'Demasiados intentos. Inténtalo más tarde.',
      expired: 'Este enlace de vista previa ha caducado.',
      revoked: 'Este enlace de vista previa ha sido desactivado.',
      generic: 'Acceso denegado. Comprueba tu contraseña.',
      unknown: 'Algo salió mal. Inténtalo de nuevo.',
    },
  },
};

function resolveLang(l: string | undefined): Lang {
  return l === 'fr' || l === 'es' ? l : 'en';
}

export default function PreviewGate() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setLanguage } = useLanguage();
  const token = params.get('token') ?? '';

  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lang = resolveLang(info?.language);
  const c = COPY[lang];

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) { setLoading(false); return; }
      const { data, error: rpcError } = await supabase.rpc('get_demo_preview_link_public' as any, { p_token: token });
      if (!active) return;
      if (rpcError) { setInfo(null); setLoading(false); return; }
      const row = Array.isArray(data) ? data[0] : data;
      setInfo(row ? (row as LinkInfo) : null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [token]);

  // Applique la langue du lien dès qu'elle est connue (écran mot de passe déjà traduit
  // via COPY ; ceci pré-règle aussi la langue pour le dashboard après connexion).
  useEffect(() => {
    if (info?.language && ['en', 'fr', 'es'].includes(info.language)) {
      setLanguage(info.language as Language);
    }
  }, [info?.language, setLanguage]);

  const submit = async () => {
    if (!password || !accepted || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('accept-staff-invitation', {
        body: { action: 'redeem_demo_preview_link', token, password },
      });
      const code = (data as any)?.code ?? (data as any)?.error;
      if (invokeError || !(data as any)?.success) {
        if (code === 'wrong_password') setError(c.err.wrong);
        else if (code === 'locked') setError(c.err.locked);
        else if (code === 'expired') setError(c.err.expired);
        else if (code === 'revoked') setError(c.err.revoked);
        else setError(c.err.generic);
        setSubmitting(false);
        return;
      }

      // Clickwrap : trace l'engagement de confidentialité du prospect AVANT le
      // setSession (encore anon) et avant l'armement du mode lecture seule, qui
      // bloquerait cette écriture. On n'enregistre que les entrées réussies.
      await recordLegalAcceptance({
        docType: 'demo_confidentiality',
        docContent: legalContent['confidentialite'][lang].content,
        context: { surface: 'preview_gate', label: info?.label ?? '', roles: info?.target_accounts ?? [] },
      });

      const roles = ((data as any).target_accounts as TargetAccount[]) ?? [];
      const primary = roles[0];
      const meta = DEMO_ACCOUNTS[primary];
      const language = String((data as any).language ?? info?.language ?? 'en');
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: (data as any).access_token,
        refresh_token: (data as any).refresh_token,
      });
      if (sessionError) throw sessionError;

      const userId = sessionData.user?.id;
      await applyDemoBypass(primary, userId);
      enablePreviewMode({ label: info?.label ?? '', roles, current: primary, language });
      if (['en', 'fr', 'es'].includes(language)) setLanguage(language as Language);
      navigate(meta?.route ?? '/', { replace: true });
    } catch {
      setError(c.err.unknown);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center px-4"
      style={{ background: '#060607' }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.10),transparent 55%)' }}
      />
      <div
        className="relative w-full max-w-[420px] rounded-3xl p-8"
        style={{
          background: 'linear-gradient(180deg,rgba(255,255,255,.05) 0%,rgba(255,255,255,.012) 100%),#0a0a0c',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 30px 60px -30px rgba(0,0,0,.9)',
        }}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: RED }} />
            <p className="text-sm text-white/50">{c.loading}</p>
          </div>
        ) : !token || !info || !info.is_valid ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(255,92,99,0.12)' }}>
              <AlertTriangle className="h-6 w-6" style={{ color: '#FF5C63' }} />
            </span>
            <h1 className="text-lg font-semibold text-white">{c.unavailable}</h1>
            <p className="text-sm text-white/50">
              {c.invalid[info?.invalid_reason ?? 'not_found'] ?? c.invalid.default}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 text-center mb-6">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(232,25,44,0.12)' }}>
                <Eye className="h-6 w-6" style={{ color: RED }} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: RED }}>
                  {c.badge}
                </p>
                <h1 className="mt-1 text-xl font-bold text-white">
                  {c.hi} {info.label}
                </h1>
                <p className="mt-1.5 text-sm text-white/50">
                  {c.lead(
                    info.target_accounts.map((a) => DEMO_ACCOUNTS[a]?.label ?? a).join(', '),
                    info.target_accounts.length,
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder={c.pw}
                  className="w-full rounded-xl py-3 pl-10 pr-3 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>

              {error && (
                <p className="text-[13px]" style={{ color: '#FF5C63' }}>{error}</p>
              )}

              {/* Engagement de confidentialité (clickwrap) — requis pour entrer */}
              <button
                type="button"
                onClick={() => setAccepted(!accepted)}
                className="flex items-start gap-2.5 w-full text-left"
              >
                <span
                  className="shrink-0 h-[18px] w-[18px] rounded-[4px] border flex items-center justify-center transition-colors mt-[1px]"
                  style={{
                    background: accepted ? RED : 'transparent',
                    borderColor: accepted ? RED : 'rgba(255,255,255,0.25)',
                  }}
                >
                  {accepted && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                <span className="text-[12px] leading-snug text-white/50">
                  {c.consent}{' '}
                  <a
                    href="/legal/confidentialite"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: RED }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.consentLink}
                  </a>
                </span>
              </button>

              <button
                type="button"
                onClick={submit}
                disabled={submitting || !password || !accepted}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition"
                style={{
                  background: RED, color: '#fff',
                  boxShadow: `0 0 22px -8px ${RED}`,
                  opacity: submitting || !password || !accepted ? 0.55 : 1,
                  cursor: submitting || !password || !accepted ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {c.enter}
              </button>
            </div>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-white/35">
              {c.footer}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
