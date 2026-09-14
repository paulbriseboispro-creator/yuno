// Carte « Meta (Facebook & Instagram) » — Réglages → Intégrations.
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md (phase 1, mode manuel).
//
// Ce que la carte fait et ne fait pas :
//   - Le pro colle son identifiant de pixel et un jeton Conversions API généré
//     dans Events Manager. Le jeton part vers l'edge `meta-connect`, entre dans
//     le Vault et n'en ressort JAMAIS : on n'affiche que « ••••1234 ».
//   - Tout le reste (statistiques, derniers événements, part de consentement)
//     vient de la RPC `get_my_meta_connection`, jamais d'un select direct.
//   - Un manager ne voit pas cette carte (surface argent, comme Stripe).
//   - Le même composant sert le club, l'organisateur et la plateforme
//     (super admin, portée vide) : seule la `scope` change.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  Loader2, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw,
  Unplug, FlaskConical, Eye, EyeOff, Info,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

// ─── Tokens (design system pro) ──────────────────────────────────────────────
const RED = '#E8192C';
const POS = '#34D399';
const WARN = '#FBBF24';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const META_BLUE = '#0866FF';

export interface MetaScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

interface ConnectionView {
  id: string;
  mode: 'manual' | 'oauth';
  pixel_id: string;
  token_hint: string | null;
  has_token: boolean;
  test_event_code: string | null;
  test_event_code_expires_at: string | null;
  status: 'active' | 'token_invalid';
  events_enabled: Record<string, boolean>;
  send_native: boolean;
  verified_at: string | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface Stats {
  queued: number;
  sent_7d: number;
  failed_7d: number;
  sent_30d: number;
  value_30d_cents: number;
  last_sent_at: string | null;
  by_event: { event_name: string; n: number }[];
}

interface RecentRow {
  id: string;
  event_name: string;
  event_kind: string;
  status: string;
  attempts: number;
  value_cents: number | null;
  currency: string | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

interface ConsentStats {
  orders_30d: number;
  consented_30d: number;
  native_30d: number;
}

interface Payload {
  connection: ConnectionView | null;
  stats?: Stats;
  recent?: RecentRow[];
  consent?: ConsentStats;
}

const EVENT_FLAGS: { key: string; labelKey: string }[] = [
  { key: 'pixel', labelKey: 'integ.meta.flag.pixel' },
  { key: 'view_content', labelKey: 'integ.meta.flag.viewContent' },
  { key: 'initiate_checkout', labelKey: 'integ.meta.flag.initiateCheckout' },
  { key: 'purchase', labelKey: 'integ.meta.flag.purchase' },
  { key: 'lead', labelKey: 'integ.meta.flag.lead' },
];

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, borderRadius: 12,
  padding: '10px 12px', fontSize: 13.5, width: '100%', outline: 'none',
};

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <p style={{ color: T2, fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>{children}</p>
      {hint && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{hint}</p>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | 'warn' }) {
  const color = tone === 'pos' ? POS : tone === 'neg' ? RED : tone === 'warn' ? WARN : T1;
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ color, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>{value}</p>
    </div>
  );
}

export function MetaConnectionCard({ scope, helpPath }: { scope: MetaScope; helpPath?: string }) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'update' | 'disconnect'>(null);
  const [pixelId, setPixelId] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [editToken, setEditToken] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const scopeArgs = useMemo(() => ({
    p_venue_id: scope.venueId ?? null,
    p_organizer_user_id: scope.organizerUserId ?? null,
  }), [scope.venueId, scope.organizerUserId]);
  const scopeBody = useMemo(() => ({
    venueId: scope.venueId ?? null,
    organizerUserId: scope.organizerUserId ?? null,
  }), [scope.venueId, scope.organizerUserId]);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: d, error } = await supabase.rpc('get_my_meta_connection' as any, scopeArgs);
    if (error) {
      setData({ connection: null });
    } else {
      const payload = d as unknown as Payload;
      setData(payload);
      if (payload.connection) setPixelId(payload.connection.pixel_id);
    }
    setLoading(false);
  }, [scopeArgs]);

  useEffect(() => { load(); }, [load]);

  const call = async (action: string, body: Record<string, unknown>) => {
    const { data: res, error } = await supabase.functions.invoke('meta-connect', {
      body: { action, scope: scopeBody, ...body },
    });
    if (error) {
      // Corps d'erreur JSON du serveur (code lisible) si disponible.
      const ctx = (error as { context?: Response }).context;
      let code: string | null = null;
      if (ctx instanceof Response) {
        try { code = ((await ctx.clone().json()) as { error?: string }).error ?? null; } catch { /* no-op */ }
      }
      throw new Error(code ?? error.message);
    }
    return res as Record<string, unknown>;
  };

  const errorLabel = (code: string) => {
    const k = `integ.meta.err.${code}`;
    const v = t(k);
    return v === k ? t('integ.meta.err.generic') : v;
  };

  const handleSave = async () => {
    if (!/^[0-9]{6,32}$/.test(pixelId.trim())) { toast.error(t('integ.meta.err.invalid_pixel_id')); return; }
    const conn = data?.connection;
    if (!conn && token.trim().length < 20) { toast.error(t('integ.meta.err.invalid_token')); return; }
    setBusy('save');
    try {
      const res = await call('save', {
        pixelId: pixelId.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(testCode.trim() ? { testEventCode: testCode.trim() } : {}),
      });
      const test = res.test as { ok?: boolean; message?: string } | null;
      if (test && !test.ok) toast.warning(`${t('integ.meta.testFailed')} ${test.message ?? ''}`.trim());
      else if (test?.ok) toast.success(t('integ.meta.testSent'));
      else toast.success(t('integ.meta.saved'));
      setToken(''); setEditToken(false); setShowToken(false);
      await load();
    } catch (e) {
      toast.error(errorLabel(e instanceof Error ? e.message : 'generic'));
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(testCode.trim())) { toast.error(t('integ.meta.err.invalid_test_code')); return; }
    setBusy('test');
    try {
      const res = await call('test', { testEventCode: testCode.trim() });
      const test = res.test as { ok?: boolean; message?: string } | null;
      if (test?.ok) toast.success(t('integ.meta.testSent'));
      else toast.error(`${t('integ.meta.testFailed')} ${test?.message ?? ''}`.trim());
      await load();
    } catch (e) {
      toast.error(errorLabel(e instanceof Error ? e.message : 'generic'));
    } finally {
      setBusy(null);
    }
  };

  const handleFlag = async (key: string, value: boolean) => {
    const conn = data?.connection;
    if (!conn) return;
    const next = { ...conn.events_enabled, [key]: value };
    setData({ ...data!, connection: { ...conn, events_enabled: next } });
    setBusy('update');
    try {
      await call('update', { eventsEnabled: next });
    } catch (e) {
      toast.error(errorLabel(e instanceof Error ? e.message : 'generic'));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleClearTest = async () => {
    setBusy('update');
    try { await call('update', { clearTestCode: true }); await load(); }
    catch (e) { toast.error(errorLabel(e instanceof Error ? e.message : 'generic')); }
    finally { setBusy(null); }
  };

  const handleDisconnect = async () => {
    setBusy('disconnect');
    try {
      await call('disconnect', {});
      toast.success(t('integ.meta.disconnected'));
      setPixelId(''); setToken(''); setTestCode('');
      await load();
    } catch (e) {
      toast.error(errorLabel(e instanceof Error ? e.message : 'generic'));
    } finally {
      setBusy(null); setConfirmDisconnect(false);
    }
  };

  const conn = data?.connection ?? null;
  const stats = data?.stats;
  const consent = data?.consent;
  const fmtDate = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy, HH:mm', { locale }) : '—');
  const fmtMoney = (cents: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100);
  const consentPct = consent && consent.orders_30d > 0 ? Math.round((consent.consented_30d / consent.orders_30d) * 100) : null;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 24 }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(8,102,255,0.14)', border: '1px solid rgba(8,102,255,0.35)' }}>
            <span style={{ color: META_BLUE, fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}>M</span>
          </div>
          <div>
            <p style={{ color: T1, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{t('integ.meta.title')}</p>
            <p style={{ color: T2, fontSize: 13, marginTop: 2, maxWidth: 560 }}>{t('integ.meta.subtitle')}</p>
          </div>
        </div>
        {conn && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
            style={conn.status === 'active'
              ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: POS }
              : { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.35)', color: RED }}>
            {conn.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {conn.status === 'active'
              ? (conn.verified_at ? t('integ.meta.status.verified') : t('integ.meta.status.pending'))
              : t('integ.meta.status.tokenInvalid')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 mt-6" style={{ color: T3 }}>
          <Loader2 className="w-4 h-4 animate-spin" /> <span style={{ fontSize: 13 }}>{t('integ.meta.loading')}</span>
        </div>
      ) : !conn ? (
        /* ── Non connecté : explication + formulaire ─────────────────────── */
        <div className="mt-5 space-y-5">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['why1', 'why2', 'why3'] as const).map((k) => (
              <div key={k} className="rounded-xl px-3 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t(`integ.meta.${k}.h`)}</p>
                <p style={{ color: T2, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{t(`integ.meta.${k}.b`)}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label hint={t('integ.meta.pixelIdHint')}>{t('integ.meta.pixelId')}</Label>
              <input value={pixelId} onChange={(e) => setPixelId(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
                placeholder="1234567890123456" style={inputStyle} autoComplete="off" />
            </div>
            <div>
              <Label hint={t('integ.meta.tokenHint')}>{t('integ.meta.token')}</Label>
              <div className="relative">
                <input value={token} onChange={(e) => setToken(e.target.value)} type={showToken ? 'text' : 'password'}
                  placeholder="EAA…" style={{ ...inputStyle, paddingRight: 40 }} autoComplete="off" spellCheck={false} />
                <button type="button" onClick={() => setShowToken((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md"
                  style={{ color: T3 }} aria-label={showToken ? t('integ.meta.hideToken') : t('integ.meta.showToken')}>
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label hint={t('integ.meta.testCodeHint')}>{t('integ.meta.testCode')} <span style={{ color: T3, fontWeight: 400 }}>· {t('integ.meta.optional')}</span></Label>
              <input value={testCode} onChange={(e) => setTestCode(e.target.value.trim())} placeholder="TEST12345" style={{ ...inputStyle, maxWidth: 260 }} autoComplete="off" />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)' }}>
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: POS }} />
            <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.consentNote')}</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={handleSave} disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-60"
              style={{ background: RED, color: '#fff' }}>
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t('integ.meta.connect')}
            </button>
            <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] underline underline-offset-2" style={{ color: T2 }}>
              {t('integ.meta.openEventsManager')} <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {helpPath && (
              <a href={helpPath} className="inline-flex items-center gap-1.5 text-[12.5px] underline underline-offset-2" style={{ color: T2 }}>
                <Info className="w-3.5 h-3.5" /> {t('integ.meta.howTo')}
              </a>
            )}
          </div>
        </div>
      ) : (
        /* ── Connecté : santé, interrupteurs, test, jeton, déconnexion ───── */
        <div className="mt-5 space-y-5">
          {conn.status === 'token_invalid' && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.25)' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: RED }} />
              <div>
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('integ.meta.tokenInvalidTitle')}</p>
                <p style={{ color: T2, fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>{t('integ.meta.tokenInvalidBody')}</p>
                {conn.last_error && <p style={{ color: T3, fontSize: 11.5, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>{conn.last_error}</p>}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label={t('integ.meta.stat.sent7d')} value={String(stats?.sent_7d ?? 0)} tone="pos" />
            <Stat label={t('integ.meta.stat.failed7d')} value={String(stats?.failed_7d ?? 0)} tone={(stats?.failed_7d ?? 0) > 0 ? 'neg' : undefined} />
            <Stat label={t('integ.meta.stat.value30d')} value={fmtMoney(stats?.value_30d_cents ?? 0)} />
            <Stat label={t('integ.meta.stat.consent30d')} value={consentPct == null ? '—' : `${consentPct} %`} tone={consentPct != null && consentPct < 40 ? 'warn' : undefined} />
          </div>
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>
            {t('integ.meta.consentExplain').replace('{n}', String(consent?.orders_30d ?? 0)).replace('{c}', String(consent?.consented_30d ?? 0))}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl p-3.5 space-y-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('integ.meta.connection')}</p>
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.pixelId')}</span><span style={{ color: T1, fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }}>{conn.pixel_id}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.token')}</span><span style={{ color: T1, fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }}>••••{conn.token_hint ?? ''}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.lastEvent')}</span><span style={{ color: T1, fontSize: 12.5 }}>{fmtDate(stats?.last_sent_at ?? conn.last_ok_at)}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.connectedSince')}</span><span style={{ color: T1, fontSize: 12.5 }}>{fmtDate(conn.created_at)}</span></div>
              {conn.test_event_code && (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="inline-flex items-center gap-1.5" style={{ color: WARN, fontSize: 12.5 }}><FlaskConical className="w-3.5 h-3.5" /> {t('integ.meta.testModeOn').replace('{code}', conn.test_event_code)}</span>
                  <button type="button" onClick={handleClearTest} disabled={busy !== null} className="text-[12px] underline underline-offset-2" style={{ color: T2 }}>{t('integ.meta.testModeOff')}</button>
                </div>
              )}
            </div>

            <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('integ.meta.events')}</p>
              {EVENT_FLAGS.map(({ key, labelKey }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span style={{ color: T1, fontSize: 12.5 }}>{t(labelKey)}</span>
                  <Switch checked={conn.events_enabled?.[key] !== false} onCheckedChange={(v) => handleFlag(key, v)} disabled={busy !== null} aria-label={t(labelKey)} />
                </div>
              ))}
            </div>
          </div>

          {/* Derniers événements */}
          {data?.recent && data.recent.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              <div className="px-3.5 py-2.5" style={{ background: INNER_BG }}>
                <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('integ.meta.recent')}</p>
              </div>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {data.recent.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2" style={{ borderColor: BORDER }}>
                    <div className="min-w-0">
                      <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{r.event_name} <span style={{ color: T3, fontWeight: 400 }}>· {t(`integ.meta.kind.${r.event_kind}`)}</span></p>
                      <p style={{ color: T3, fontSize: 11.5 }}>{fmtDate(r.sent_at ?? r.created_at)}{r.last_error ? ` · ${r.last_error}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {r.value_cents != null && r.event_name === 'Purchase' && <span style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{fmtMoney(r.value_cents)}</span>}
                      <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={r.status === 'sent' ? { color: POS, background: 'rgba(52,211,153,0.1)' } : r.status === 'failed' ? { color: RED, background: 'rgba(232,25,44,0.1)' } : { color: WARN, background: 'rgba(251,191,36,0.1)' }}>
                        {t(`integ.meta.rowStatus.${r.status}`)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Test + jeton */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label hint={t('integ.meta.testCodeHint')}>{t('integ.meta.sendTest')}</Label>
              <div className="flex gap-2">
                <input value={testCode} onChange={(e) => setTestCode(e.target.value.trim())} placeholder="TEST12345" style={inputStyle} autoComplete="off" />
                <button type="button" onClick={handleTest} disabled={busy !== null || !testCode}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold flex-shrink-0 disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.08)', color: T1, border: `1px solid ${BORDER}` }}>
                  {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                  {t('integ.meta.test')}
                </button>
              </div>
            </div>
            <div>
              <Label hint={t('integ.meta.updateTokenHint')}>{t('integ.meta.updateToken')}</Label>
              {!editToken ? (
                <button type="button" onClick={() => setEditToken(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold"
                  style={{ background: 'rgba(255,255,255,0.08)', color: T1, border: `1px solid ${BORDER}` }}>
                  <RefreshCw className="w-4 h-4" /> {t('integ.meta.updateTokenBtn')}
                </button>
              ) : (
                <div className="flex gap-2">
                  <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="EAA…" style={inputStyle} autoComplete="off" spellCheck={false} />
                  <button type="button" onClick={handleSave} disabled={busy !== null || token.trim().length < 20}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold flex-shrink-0 disabled:opacity-50"
                    style={{ background: RED, color: '#fff' }}>
                    {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t('integ.meta.save')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: T3 }} />
            <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.domainNote')}</p>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-3 flex-wrap">
              <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12.5px] underline underline-offset-2" style={{ color: T2 }}>
                {t('integ.meta.openEventsManager')} <ExternalLink className="w-3.5 h-3.5" />
              </a>
              {helpPath && (
                <a href={helpPath} className="inline-flex items-center gap-1.5 text-[12.5px] underline underline-offset-2" style={{ color: T2 }}>
                  <Info className="w-3.5 h-3.5" /> {t('integ.meta.howTo')}
                </a>
              )}
            </div>
            <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold"
              style={{ background: 'transparent', color: RED, border: '1px solid rgba(232,25,44,0.35)' }}>
              <Unplug className="w-4 h-4" /> {t('integ.meta.disconnect')}
            </button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('integ.meta.disconnectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('integ.meta.disconnectBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>{t('integ.meta.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={busy !== null} style={{ background: RED, color: '#fff' }}>
              {busy === 'disconnect' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('integ.meta.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
