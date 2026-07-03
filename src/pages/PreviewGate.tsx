// Gate d'aperçu (preview) : /preview?token=…
//
// Étape mot de passe avant l'accès. Le prospect saisit LE mot de passe de son lien
// (ex. « el sorbo »), on le vérifie côté serveur, on le connecte au compte démo ciblé
// puis on l'arme en LECTURE SEULE et on l'envoie sur le bon dashboard.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Lock, Eye, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DEMO_ACCOUNTS, applyDemoBypass, type TargetAccount } from '@/lib/demoSession';
import { enablePreviewMode } from '@/contexts/PreviewModeContext';
import { useLanguage, type Language } from '@/contexts/LanguageContext';

const RED = '#E8192C';

interface LinkInfo {
  label: string;
  target_accounts: TargetAccount[];
  language: string;
  is_valid: boolean;
  invalid_reason: string | null;
}

const INVALID_COPY: Record<string, string> = {
  not_found: "Ce lien d'aperçu est introuvable.",
  revoked: "Ce lien d'aperçu a été désactivé.",
  expired: "Ce lien d'aperçu a expiré.",
  locked: "Trop de tentatives. Ce lien est temporairement bloqué.",
};

export default function PreviewGate() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setLanguage } = useLanguage();
  const token = params.get('token') ?? '';

  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const submit = async () => {
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('accept-staff-invitation', {
        body: { action: 'redeem_demo_preview_link', token, password },
      });
      // L'edge function renvoie un statut non-2xx (avec {error, code}) sur mot de passe
      // erroné / lien invalide ; supabase-js remonte alors invokeError.
      const code = (data as any)?.code ?? (data as any)?.error;
      if (invokeError || !(data as any)?.success) {
        if (code === 'wrong_password') setError('Mot de passe incorrect.');
        else if (code === 'locked') setError('Trop de tentatives. Réessaie plus tard.');
        else if (code === 'expired') setError("Ce lien d'aperçu a expiré.");
        else if (code === 'revoked') setError("Ce lien d'aperçu a été désactivé.");
        else setError('Accès impossible. Vérifie ton mot de passe.');
        setSubmitting(false);
        return;
      }

      const roles = ((data as any).target_accounts as TargetAccount[]) ?? [];
      const primary = roles[0];
      const meta = DEMO_ACCOUNTS[primary];
      const language = String((data as any).language ?? info?.language ?? 'en');
      // Connexion au compte démo primaire (tokens mintés côté serveur).
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: (data as any).access_token,
        refresh_token: (data as any).refresh_token,
      });
      if (sessionError) throw sessionError;

      const userId = sessionData.user?.id;
      await applyDemoBypass(primary, userId);
      // Armer la lecture seule AVANT de naviguer (guard + bannière + DemoSwitcher caché).
      enablePreviewMode({ label: info?.label ?? '', roles, current: primary, language });
      // Appliquer la langue par défaut du lien (setLanguage ignore l'écriture profil en preview).
      if (['en', 'fr', 'es'].includes(language)) setLanguage(language as Language);
      navigate(meta?.route ?? '/', { replace: true });
    } catch {
      setError('Une erreur est survenue. Réessaie.');
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
            <p className="text-sm text-white/50">Chargement…</p>
          </div>
        ) : !token || !info || !info.is_valid ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(255,92,99,0.12)' }}>
              <AlertTriangle className="h-6 w-6" style={{ color: '#FF5C63' }} />
            </span>
            <h1 className="text-lg font-semibold text-white">Aperçu indisponible</h1>
            <p className="text-sm text-white/50">
              {INVALID_COPY[info?.invalid_reason ?? 'not_found'] ?? "Ce lien d'aperçu n'est pas valide."}
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
                  Aperçu Yuno
                </p>
                <h1 className="mt-1 text-xl font-bold text-white">
                  Bonjour {info.label}
                </h1>
                <p className="mt-1.5 text-sm text-white/50">
                  Accès démo en lecture seule
                  {info.target_accounts.length === 1 ? ' au tableau de bord ' : ' aux tableaux de bord '}
                  <span className="text-white/70">
                    {info.target_accounts.map((a) => DEMO_ACCOUNTS[a]?.label ?? a).join(', ')}
                  </span>.
                  Saisis ton mot de passe pour entrer.
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
                  placeholder="Mot de passe"
                  className="w-full rounded-xl py-3 pl-10 pr-3 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>

              {error && (
                <p className="text-[13px]" style={{ color: '#FF5C63' }}>{error}</p>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={submitting || !password}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition"
                style={{
                  background: RED, color: '#fff',
                  boxShadow: `0 0 22px -8px ${RED}`,
                  opacity: submitting || !password ? 0.55 : 1,
                  cursor: submitting || !password ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Entrer dans l'aperçu
              </button>
            </div>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-white/35">
              Aperçu de démonstration. Tout est en lecture seule — aucune donnée réelle
              ne peut être créée ou modifiée.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
