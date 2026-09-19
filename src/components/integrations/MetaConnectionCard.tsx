// Carte « Meta (Facebook & Instagram) » — Réglages → Intégrations.
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md ; mise en service de la
// connexion en un clic : docs/META_GO_LIVE_GUIDE.md.
//
// Deux chemins vers la même connexion :
//   - « Connecter avec Facebook » (phase 2) : une fenêtre Meta, le pro choisit
//     son entreprise, Yuno découvre ses pixels / comptes pub / Pages ; s'il n'a
//     qu'un pixel c'est fini, sinon il le choisit ici. Aucun jeton à coller.
//   - « Mode avancé » (phase 1) : Pixel ID + jeton Conversions API collés.
//     Reste disponible, replié, pour les pros qui gèrent ça eux-mêmes.
// Un pro dont le compte professionnel Meta a été créé DEPUIS Instagram n'a
// pas de mot de passe Facebook : la fenêtre Meta ne lui propose alors qu'un
// formulaire e-mail + mot de passe, et les deux chemins ci-dessus sont des
// murs. D'où le rappel « Vous n'avez qu'un compte Instagram ? » sous le
// bouton — il ouvre Meta Business Suite, seul écran de connexion Meta qui
// offre « Continuer avec Instagram » (cf. META_BUSINESS_LOGIN_URL).
// Le jeton part vers l'edge `meta-connect`, entre dans le Vault et n'en
// ressort JAMAIS : on n'affiche que « ••••1234 ». Tout le reste vient de la
// RPC `get_my_meta_connection`. Un manager ne voit pas cette carte.
//
// `live = false` (META_INTEGRATION_LIVE) : état « En construction », aucune
// action possible — sauf sur la carte plateforme (super admin) qui sert à
// tester le bout en bout.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  Loader2, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw,
  Unplug, FlaskConical, Eye, EyeOff, Info, Hammer, ChevronDown, ChevronUp, Activity,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { META_BUSINESS_LOGIN_URL } from '@/lib/metaIntegration';
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
// Le dialogue Meta s'ouvre dans un AUTRE onglet : c'est donc lui qui reçoit le
// retour `?meta=…`. Il le repasse à l'onglet d'origine par cette clé —
// l'événement `storage` ne se déclenche que dans les AUTRES onglets de
// l'origine, ce qui est exactement le besoin.
const OAUTH_RESULT_KEY = 'yuno:meta:oauth';
// Permissions sans lesquelles la connexion en un clic ne peut ni lister les
// actifs ni lire la santé : si la fenêtre Meta les a décochées, on le dit.
const REQUIRED_SCOPES = ['ads_read', 'business_management', 'pages_read_engagement'];

export interface MetaScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

interface Asset { id: string; name: string }
interface InstagramAsset { page_id: string; id: string; username: string | null }
interface Assets { pixels: Asset[]; ad_accounts: Asset[]; pages: Asset[]; instagram?: InstagramAsset[] }

interface ConnectionView {
  id: string;
  mode: 'manual' | 'oauth';
  pixel_id: string;
  token_hint: string | null;
  has_token: boolean;
  token_kind: 'capi' | 'bisu' | 'user';
  token_expires_at: string | null;
  assets: Assets | null;
  business_id: string | null;
  ad_account_id: string | null;
  page_id: string | null;
  last_health: Record<string, unknown> | null;
  last_health_at: string | null;
  test_event_code: string | null;
  test_event_code_expires_at: string | null;
  status: 'active' | 'token_invalid' | 'pending_assets';
  events_enabled: Record<string, boolean>;
  send_native: boolean;
  verified_at: string | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface Stats {
  queued: number; sent_7d: number; failed_7d: number; sent_30d: number;
  value_30d_cents: number; last_sent_at: string | null; by_event: { event_name: string; n: number }[];
}
interface RecentRow {
  id: string; event_name: string; event_kind: string; status: string; attempts: number;
  value_cents: number | null; currency: string | null; last_error: string | null; created_at: string; sent_at: string | null;
}
interface ConsentStats { orders_30d: number; consented_30d: number; native_30d: number }
interface Payload { connection: ConnectionView | null; stats?: Stats; recent?: RecentRow[]; consent?: ConsentStats }

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

function FacebookButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13.5px] font-semibold disabled:opacity-60"
      style={{ background: META_BLUE, color: '#fff' }}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" />
        </svg>
      )}
      {label}
    </button>
  );
}

// Jumeau du bouton Facebook, même gabarit : les deux chemins pèsent pareil à
// l'écran. Un pro qui gère tout depuis Instagram doit reconnaître le sien du
// premier coup d'œil, sinon il clique sur le bleu et tombe sur une page de
// connexion à un compte qu'il n'a pas.
function InstagramButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13.5px] font-semibold"
      style={{ background: 'linear-gradient(120deg,#F58529 0%,#DD2A7B 50%,#8134AF 100%)', color: '#fff' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 6a3.84 3.84 0 1 0 0 7.68 3.84 3.84 0 0 0 0-7.68zm0 6.34a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm4.89-6.49a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0z" />
      </svg>
      {label} <ExternalLink className="w-3.5 h-3.5 opacity-80" />
    </a>
  );
}

export function MetaConnectionCard({ scope, helpPath, live = true, returnTo }: { scope: MetaScope; helpPath?: string; live?: boolean; returnTo?: string }) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'oauth' | 'select' | 'health' | 'save' | 'test' | 'update' | 'disconnect'>(null);
  const [oauthAvailable, setOauthAvailable] = useState(true);
  const [waitingOauth, setWaitingOauth] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [editToken, setEditToken] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [chosenPixel, setChosenPixel] = useState('');
  const [chosenAdAccount, setChosenAdAccount] = useState('');
  const [chosenPage, setChosenPage] = useState('');
  const [changingAssets, setChangingAssets] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const scopeArgs = useMemo(() => ({ p_venue_id: scope.venueId ?? null, p_organizer_user_id: scope.organizerUserId ?? null }), [scope.venueId, scope.organizerUserId]);
  const scopeBody = useMemo(() => ({ venueId: scope.venueId ?? null, organizerUserId: scope.organizerUserId ?? null }), [scope.venueId, scope.organizerUserId]);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: d, error } = await supabase.rpc('get_my_meta_connection' as any, scopeArgs);
    if (error) {
      // Une panne de lecture n'est pas « non connecté » : on le dit, avec un bouton.
      setLoadError(true);
    } else {
      setLoadError(false);
      const payload = d as unknown as Payload;
      setData(payload);
      const c = payload.connection;
      if (c && /^[0-9]+$/.test(c.pixel_id)) setPixelId(c.pixel_id);
      if (c?.assets) {
        setChosenPixel(/^[0-9]+$/.test(c.pixel_id) ? c.pixel_id : (c.assets.pixels[0]?.id ?? ''));
        setChosenAdAccount(c.ad_account_id ?? c.assets.ad_accounts[0]?.id ?? '');
        setChosenPage(c.page_id ?? c.assets.pages[0]?.id ?? '');
      }
    }
    setLoading(false);
  }, [scopeArgs]);

  useEffect(() => { load(); }, [load]);

  const showOauthResult = (m: string, reason: string | null) => {
    if (m === 'connected') toast.success(t('integ.meta.oauthConnected'));
    else if (m === 'choose') toast.info(t('integ.meta.oauthChoose'));
    else if (m === 'error') toast.error(`${t('integ.meta.oauthFailed')} ${reason ?? ''}`.trim());
  };

  // Retour du dialogue Meta : ?meta=connected|choose|error&reason=…
  // Ce code tourne dans l'onglet OUVERT pour Meta, pas dans celui que le pro
  // regardait. Il repasse donc le résultat à l'onglet d'origine puis se ferme.
  // `window.close()` n'est permis qu'à un onglet ouvert par script qui a gardé
  // son `opener` : sans opener on reste ici et on affiche le résultat
  // normalement, l'écran est complet de toute façon.
  useEffect(() => {
    const m = searchParams.get('meta');
    if (!m) return;
    const reason = searchParams.get('reason');
    let opener: Window | null = null;
    try { opener = window.opener as Window | null; } catch { opener = null; }
    if (opener && !opener.closed) {
      try { localStorage.setItem(OAUTH_RESULT_KEY, JSON.stringify({ m, reason, ts: Date.now() })); } catch { /* navigation privée : le focus rechargera */ }
      window.close();
    }
    showOauthResult(m, reason);
    const next = new URLSearchParams(searchParams);
    next.delete('meta'); next.delete('reason');
    setSearchParams(next, { replace: true });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Onglet d'origine : il n'a pas bougé, donc rien ne le rafraîchit tout seul.
  // `storage` porte le résultat ; le retour du focus recharge de toute façon
  // (onglet Meta fermé à la main, popup bloquée, localStorage indisponible).
  useEffect(() => {
    if (!waitingOauth) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== OAUTH_RESULT_KEY || !e.newValue) return;
      try {
        const r = JSON.parse(e.newValue) as { m?: string; reason?: string | null };
        if (typeof r.m === 'string') showOauthResult(r.m, r.reason ?? null);
      } catch { /* valeur illisible : le rechargement suffit */ }
      setWaitingOauth(false);
      load();
    };
    const onFocus = () => { load(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingOauth, load]);

  const call = async (action: string, body: Record<string, unknown>) => {
    const { data: res, error } = await supabase.functions.invoke('meta-connect', { body: { action, scope: scopeBody, ...body } });
    if (error) {
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

  const handleOauth = async () => {
    // L'onglet s'ouvre DANS le geste du clic, vide, puis on l'envoie sur Meta
    // quand l'URL signée arrive : un `window.open` posé après l'`await` est
    // bloqué par Safari (même piège que la fenêtre WhatsApp de /links).
    // L'écran Yuno reste ainsi sous les yeux du pro pendant qu'il autorise.
    let tab: Window | null = null;
    try { tab = window.open('', '_blank'); } catch { tab = null; }
    if (tab) {
      try { tab.document.write(`<!doctype html><meta charset="utf-8"><title>Meta</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0a0a0c;color:rgba(255,255,255,.58);font:500 14px/1.5 -apple-system,system-ui,sans-serif">${t('integ.meta.oauthTabLoading')}</body>`); } catch { /* le blanc est acceptable */ }
    }
    setBusy('oauth');
    try {
      const res = await call('oauth_start', { returnTo: returnTo ?? window.location.pathname });
      if (typeof res.url !== 'string') throw new Error('generic');
      if (tab && !tab.closed) {
        tab.location.href = res.url;
        tab.focus?.();
        setWaitingOauth(true);
        setBusy(null);
        return;
      }
      window.location.assign(res.url); // popup bloquée : on n'abandonne personne
    } catch (e) {
      try { tab?.close(); } catch { /* déjà fermé par le pro */ }
      const code = e instanceof Error ? e.message : 'generic';
      if (code === 'oauth_not_configured') { setOauthAvailable(false); setAdvanced(true); toast.info(t('integ.meta.err.oauth_not_configured')); }
      else toast.error(errorLabel(code));
      setBusy(null);
    }
  };

  const handleSelect = async () => {
    if (!chosenPixel) return;
    setBusy('select');
    try {
      await call('select_assets', { pixelId: chosenPixel, adAccountId: chosenAdAccount || undefined, pageId: chosenPage || undefined });
      toast.success(t('integ.meta.saved'));
      setChangingAssets(false);
      await load();
    } catch (e) { toast.error(errorLabel(e instanceof Error ? e.message : 'generic')); }
    finally { setBusy(null); }
  };

  const handleHealth = async () => {
    setBusy('health');
    try { await call('health', {}); await load(); }
    catch (e) { toast.error(errorLabel(e instanceof Error ? e.message : 'generic')); }
    finally { setBusy(null); }
  };

  const handleSave = async () => {
    if (!/^[0-9]{6,32}$/.test(pixelId.trim())) { toast.error(t('integ.meta.err.invalid_pixel_id')); return; }
    const conn = data?.connection;
    if ((!conn || conn.mode !== 'manual') && token.trim().length < 20) { toast.error(t('integ.meta.err.invalid_token')); return; }
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
      // Un jeton collé n'est pas forcément un simple jeton d'événements : le
      // serveur a regardé ce qu'il sait faire, on le dit au lieu de laisser le
      // pro découvrir tout seul que la page Publicité s'est ouverte (ou pas).
      const disc = res.discovered as { adAccounts?: number; pages?: number } | null;
      if (disc && (disc.adAccounts ?? 0) > 0 && (disc.pages ?? 0) > 0) toast.success(t('integ.meta.adsUnlocked'));
      if (res.foreignApp === true) toast.warning(t('integ.meta.tokenOtherApp'));
      setToken(''); setEditToken(false); setShowToken(false);
      await load();
    } catch (e) { toast.error(errorLabel(e instanceof Error ? e.message : 'generic')); }
    finally { setBusy(null); }
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
    } catch (e) { toast.error(errorLabel(e instanceof Error ? e.message : 'generic')); }
    finally { setBusy(null); }
  };

  const handleFlag = async (key: string, value: boolean) => {
    const conn = data?.connection;
    if (!conn) return;
    const next = { ...conn.events_enabled, [key]: value };
    setData({ ...data!, connection: { ...conn, events_enabled: next } });
    setBusy('update');
    try { await call('update', { eventsEnabled: next }); }
    catch (e) { toast.error(errorLabel(e instanceof Error ? e.message : 'generic')); await load(); }
    finally { setBusy(null); }
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
    } catch (e) { toast.error(errorLabel(e instanceof Error ? e.message : 'generic')); }
    finally { setBusy(null); setConfirmDisconnect(false); }
  };

  const conn = data?.connection ?? null;
  const stats = data?.stats;
  const consent = data?.consent;
  const fmtDate = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'd MMM yyyy, HH:mm', { locale }) : '—');
  const fmtMoney = (cents: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100);
  const consentPct = consent && consent.orders_30d > 0 ? Math.round((consent.consented_30d / consent.orders_30d) * 100) : null;
  const expiresSoon = conn?.token_expires_at ? (new Date(conn.token_expires_at).getTime() - Date.now()) < 7 * 24 * 3600 * 1000 : false;
  const health = conn?.last_health as { is_valid?: boolean | null; scopes?: string[] | null; dataset_quality?: Record<string, unknown> } | null;
  const missingScopes = Array.isArray(health?.scopes) && conn?.mode === 'oauth'
    ? REQUIRED_SCOPES.filter((s) => !(health!.scopes as string[]).includes(s))
    : [];
  const emq = (() => {
    const q = health?.dataset_quality as { data?: Array<{ event_match_quality?: { score?: number }; event_name?: string }> } | undefined;
    const rows = q?.data;
    if (!Array.isArray(rows)) return null;
    const purchase = rows.find((r) => r.event_name === 'Purchase') ?? rows[0];
    const score = purchase?.event_match_quality?.score;
    return typeof score === 'number' ? score : null;
  })();

  const openEventsManager = (
    <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[12.5px] underline underline-offset-2" style={{ color: T2 }}>
      {t('integ.meta.openEventsManager')} <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
  const helpLink = helpPath && (
    <a href={helpPath} className="inline-flex items-center gap-1.5 text-[12.5px] underline underline-offset-2" style={{ color: T2 }}>
      <Info className="w-3.5 h-3.5" /> {t('integ.meta.howTo')}
    </a>
  );

  // Portefeuille créé depuis Instagram : pas de mot de passe Facebook, donc
  // pas de connexion possible tant que le navigateur n'a pas de session Meta.
  // Toujours visible (pas replié) : celui que ça bloque ne saura pas qu'il
  // doit déplier quelque chose.
  const oauthWaitingNote = waitingOauth && (
    <div className="flex items-center gap-3 flex-wrap rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5, flex: 1, minWidth: 220 }}>{t('integ.meta.oauthTabOpen')}</p>
      <button type="button" onClick={() => { setWaitingOauth(false); load(); }}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold"
        style={{ background: 'rgba(255,255,255,0.08)', color: T1, border: `1px solid ${BORDER}` }}>
        <RefreshCw className="w-3.5 h-3.5" /> {t('integ.meta.oauthTabRefresh')}
      </button>
    </div>
  );

  // Deux chemins, deux cartes de même poids. Ce n'est pas de la mise en page :
  // Facebook Login for Business authentifie un PROFIL Facebook, et un compte
  // professionnel ouvert depuis Instagram n'en a pas — le dialogue Meta lui
  // sert sa page de connexion Facebook, sans option Instagram. Un seul bouton
  // bleu laissait croire qu'il menait aussi à Instagram (constaté sur le
  // compte Amoris le 19/09) : le pro cliquait et se retrouvait devant un
  // compte qu'il n'a pas. Chaque carte dit donc POUR QUI elle est avant de
  // dire ce qu'elle fait, et la carte Instagram annonce qu'elle ne connecte
  // pas Yuno — elle ouvre Meta.
  const connectChooser = (
    <div className="space-y-3">
      <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('integ.meta.choose.h')}</p>
      {/* Se connecter à Meta dans un autre onglet ne connecte pas Yuno : il n'y
          a de connexion qu'au moment où Meta rend l'autorisation. Dit ici
          parce que c'est l'erreur qui a coûté le plus de temps sur Amoris —
          Events Manager ouvert, session Meta active, et la carte qui ne bouge
          pas, ce qui ressemble à une panne alors que rien n'a été demandé. */}
      <p style={{ color: WARN, fontSize: 12, lineHeight: 1.5, marginTop: -4 }}>{t('integ.meta.choose.only')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl px-3.5 py-3.5 flex flex-col" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>{t('integ.meta.choose.fb.h')}</p>
          <p style={{ color: META_BLUE, fontSize: 11.5, fontWeight: 600, marginTop: 5, lineHeight: 1.4 }}>{t('integ.meta.choose.fb.who')}</p>
          <p style={{ color: T2, fontSize: 12.5, marginTop: 8, lineHeight: 1.5, flex: 1 }}>
            {t('integ.meta.oauthHint')} {t('integ.meta.choose.fb.plus')}
          </p>
          <div className="mt-3.5">
            <FacebookButton onClick={handleOauth} busy={busy === 'oauth'} label={t('integ.meta.oauthButton')} />
          </div>
        </div>

        <div className="rounded-xl px-3.5 py-3.5 flex flex-col" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>{t('integ.meta.choose.ig.h')}</p>
          <p style={{ color: '#DD2A7B', fontSize: 11.5, fontWeight: 600, marginTop: 5, lineHeight: 1.4 }}>{t('integ.meta.choose.ig.who')}</p>
          <p style={{ color: T2, fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>{t('integ.meta.choose.ig.b')}</p>
          {/* « Compte » et « Page » se confondent dans le vocabulaire de Meta,
              et Business Suite propose de créer une Page dans le même écran de
              réglages. Une Page n'a ni email ni mot de passe : elle ne peut
              rien autoriser. Dit en avertissement parce que c'est le piège où
              le compte Amoris s'est arrêté le 19/09. */}
          <p style={{ color: WARN, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{t('integ.meta.choose.ig.warn')}</p>
          {/* L'adresse de la connexion Instagram est DÉJÀ une personne active
              du portefeuille : réutilisée pour le compte Facebook, Meta refuse
              l'invitation (« This person was already invited ») et le pro
              tourne en rond. Constaté sur Amoris Society le 19/09. */}
          <p style={{ color: WARN, fontSize: 12, marginTop: 6, lineHeight: 1.5, flex: 1 }}>{t('integ.meta.choose.ig.mail')}</p>
          <div className="mt-3.5">
            <InstagramButton href={META_BUSINESS_LOGIN_URL} label={t('integ.meta.choose.igButton')} />
          </div>
        </div>
      </div>
      <p style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>
        {t('integ.meta.choose.third')}{' '}
        <button type="button" onClick={() => setAdvanced(true)}
          className="font-semibold underline underline-offset-2" style={{ color: T2 }}>
          {t('integ.meta.igLogin.cta2')}
        </button>
      </p>
    </div>
  );

  // Reconnexion : le pro est déjà connecté une fois, il n'a pas besoin du
  // sélecteur complet — juste du rappel de ce qui le bloquerait à nouveau.
  const instagramLoginNote = (
    <div className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('integ.meta.igLogin.h')}</p>
      <p style={{ color: T2, fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{t('integ.meta.igLogin.b')}</p>
      <p style={{ color: T2, fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>{t('integ.meta.igLogin.o1')}</p>
      <div className="mt-2.5">
        <InstagramButton href={META_BUSINESS_LOGIN_URL} label={t('integ.meta.choose.igButton')} />
      </div>
    </div>
  );

  // Identités retenues (nom lisible plutôt qu'un identifiant Meta).
  const igFor = (pageId: string | null | undefined) => (pageId ? conn?.assets?.instagram?.find((i) => i.page_id === pageId) ?? null : null);
  const adAccountName = conn?.assets?.ad_accounts.find((a) => a.id === conn.ad_account_id)?.name ?? conn?.ad_account_id ?? null;
  const pageName = conn?.assets?.pages.find((p) => p.id === conn.page_id)?.name ?? conn?.page_id ?? null;
  const currentIg = igFor(conn?.page_id);

  // Sélecteur d'actifs : à la première connexion (choix en attente) et, plus
  // tard, derrière « Changer les actifs » sur une connexion active.
  const assetPicker = conn?.assets ? (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label>{t('integ.meta.choosePixel')}</Label>
          <select value={chosenPixel} onChange={(e) => setChosenPixel(e.target.value)} style={inputStyle}>
            {conn.assets.pixels.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
          </select>
        </div>
        <div>
          <Label>{t('integ.meta.chooseAdAccount')}</Label>
          <select value={chosenAdAccount} onChange={(e) => setChosenAdAccount(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {conn.assets.ad_accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <Label>{t('integ.meta.choosePage')}</Label>
          <select value={chosenPage} onChange={(e) => setChosenPage(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {conn.assets.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {chosenPage && (
            <p style={{ color: igFor(chosenPage) ? T2 : T3, fontSize: 11.5, marginTop: 6 }}>
              {igFor(chosenPage) ? `${t('integ.meta.instagramLinked')} : @${igFor(chosenPage)!.username ?? igFor(chosenPage)!.id}` : t('integ.meta.instagramNone')}
            </p>
          )}
        </div>
      </div>
      {conn.assets.pixels.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: WARN }} />
          <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.noPixelFound')}</p>
        </div>
      )}
    </>
  ) : null;

  const manualForm = (
    <div className="space-y-4">
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
      <button type="button" onClick={handleSave} disabled={busy !== null}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-60"
        style={{ background: RED, color: '#fff' }}>
        {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        {t('integ.meta.connect')}
      </button>
    </div>
  );

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
        {!live ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
            style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: WARN }}>
            <Hammer className="w-3 h-3" /> {t('integ.meta.status.building')}
          </span>
        ) : conn && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
            style={conn.status === 'active'
              ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: POS }
              : conn.status === 'pending_assets'
                ? { background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: WARN }
                : { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.35)', color: RED }}>
            {conn.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {conn.status === 'active'
              ? (conn.verified_at ? t('integ.meta.status.verified') : t('integ.meta.status.pending'))
              : conn.status === 'pending_assets' ? t('integ.meta.status.choose') : t('integ.meta.status.tokenInvalid')}
          </span>
        )}
      </div>

      {!live ? (
        /* ── En construction ─────────────────────────────────────────────── */
        <div className="mt-5 space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['why1', 'why2', 'why3'] as const).map((k) => (
              <div key={k} className="rounded-xl px-3 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t(`integ.meta.${k}.h`)}</p>
                <p style={{ color: T2, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{t(`integ.meta.${k}.b`)}</p>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
            <Hammer className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: WARN }} />
            <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.buildingBody')}</p>
          </div>
          <div className="flex items-center gap-2 opacity-60 pointer-events-none" aria-disabled="true">
            <FacebookButton onClick={() => undefined} busy={false} label={t('integ.meta.oauthButton')} />
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 mt-6" style={{ color: T3 }}>
          <Loader2 className="w-4 h-4 animate-spin" /> <span style={{ fontSize: 13 }}>{t('integ.meta.loading')}</span>
        </div>
      ) : loadError && !data ? (
        /* ── Lecture impossible (réseau, session) : ce n'est pas « non connecté » ── */
        <div className="mt-5 flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: WARN }} />
          <div className="flex-1">
            <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.loadError')}</p>
            <button type="button" onClick={() => { setLoading(true); load(); }}
              className="mt-2 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.08)', color: T1, border: `1px solid ${BORDER}` }}>
              <RefreshCw className="w-4 h-4" /> {t('integ.meta.retry')}
            </button>
          </div>
        </div>
      ) : !conn ? (
        /* ── Non connecté ────────────────────────────────────────────────── */
        <div className="mt-5 space-y-5">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['why1', 'why2', 'why3'] as const).map((k) => (
              <div key={k} className="rounded-xl px-3 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t(`integ.meta.${k}.h`)}</p>
                <p style={{ color: T2, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{t(`integ.meta.${k}.b`)}</p>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)' }}>
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: POS }} />
            <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.consentNote')}</p>
          </div>

          {oauthAvailable && (
            <div className="space-y-3">
              {connectChooser}
              {oauthWaitingNote}
            </div>
          )}

          <div className="rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
            <button type="button" onClick={() => setAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-left">
              <span style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>{t('integ.meta.advanced')}</span>
              {advanced ? <ChevronUp className="w-4 h-4" style={{ color: T3 }} /> : <ChevronDown className="w-4 h-4" style={{ color: T3 }} />}
            </button>
            {advanced && (
              <div className="px-3.5 pb-4">
                <p style={{ color: T3, fontSize: 12, marginBottom: 12, lineHeight: 1.45 }}>{t('integ.meta.advancedHint')}</p>
                {manualForm}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">{openEventsManager}{helpLink}</div>
        </div>
      ) : conn.status === 'pending_assets' && conn.assets ? (
        /* ── Connecté, choix du pixel ────────────────────────────────────── */
        <div className="mt-5 space-y-4">
          <p style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{t('integ.meta.chooseBody')}</p>
          {assetPicker}
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={handleSelect} disabled={busy !== null || !chosenPixel}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-60"
              style={{ background: RED, color: '#fff' }}>
              {busy === 'select' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t('integ.meta.confirmChoice')}
            </button>
            <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold"
              style={{ background: 'transparent', color: RED, border: '1px solid rgba(232,25,44,0.35)' }}>
              <Unplug className="w-4 h-4" /> {t('integ.meta.disconnect')}
            </button>
            {openEventsManager}
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
                <p style={{ color: T2, fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>{conn.mode === 'oauth' ? t('integ.meta.tokenInvalidOauthBody') : t('integ.meta.tokenInvalidBody')}</p>
                {conn.last_error && <p style={{ color: T3, fontSize: 11.5, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>{conn.last_error}</p>}
                {conn.mode === 'oauth' && oauthAvailable && (
                  <div className="mt-3 space-y-3">
                    <FacebookButton onClick={handleOauth} busy={busy === 'oauth'} label={t('integ.meta.reconnect')} />
                    {oauthWaitingNote}
                    {instagramLoginNote}
                  </div>
                )}
              </div>
            </div>
          )}
          {conn.status === 'active' && missingScopes.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: WARN }} />
              <div className="flex-1">
                <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.missingScopes').replace('{list}', missingScopes.join(', '))}</p>
                {oauthAvailable && <div className="mt-2"><FacebookButton onClick={handleOauth} busy={busy === 'oauth'} label={t('integ.meta.reconnect')} /></div>}
              </div>
            </div>
          )}
          {conn.status === 'active' && conn.token_kind === 'user' && expiresSoon && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: WARN }} />
              <div className="flex-1">
                <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.expiresSoon').replace('{date}', fmtDate(conn.token_expires_at))}</p>
                {oauthAvailable && <div className="mt-2"><FacebookButton onClick={handleOauth} busy={busy === 'oauth'} label={t('integ.meta.reconnect')} /></div>}
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

          {changingAssets && conn.mode === 'oauth' && conn.assets && (
            <div className="rounded-xl p-3.5 space-y-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.changeAssetsHint')}</p>
              {assetPicker}
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={handleSelect} disabled={busy !== null || !chosenPixel}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-60"
                  style={{ background: RED, color: '#fff' }}>
                  {busy === 'select' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {t('integ.meta.confirmChoice')}
                </button>
                <button type="button" onClick={() => setChangingAssets(false)} disabled={busy !== null}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold"
                  style={{ background: 'transparent', color: T2, border: `1px solid ${BORDER}` }}>
                  {t('integ.meta.cancel')}
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl p-3.5 space-y-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('integ.meta.connection')}</p>
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.mode')}</span><span style={{ color: T1, fontSize: 12.5 }}>{conn.mode === 'oauth' ? t('integ.meta.modeOauth') : t('integ.meta.modeManual')}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.pixelId')}</span><span style={{ color: T1, fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }}>{conn.assets?.pixels.find((p) => p.id === conn.pixel_id)?.name ? `${conn.assets.pixels.find((p) => p.id === conn.pixel_id)!.name} · ` : ''}{conn.pixel_id}</span></div>
              {conn.mode === 'oauth' && <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.adAccount')}</span><span style={{ color: T1, fontSize: 12.5, textAlign: 'right' }}>{adAccountName ?? '—'}</span></div>}
              {conn.mode === 'oauth' && <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.page')}</span><span style={{ color: T1, fontSize: 12.5, textAlign: 'right' }}>{pageName ?? '—'}</span></div>}
              {conn.mode === 'oauth' && <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.instagram')}</span><span style={{ color: currentIg ? T1 : T3, fontSize: 12.5, textAlign: 'right' }}>{currentIg ? `@${currentIg.username ?? currentIg.id}` : t('integ.meta.instagramNone')}</span></div>}
              {conn.mode === 'manual' && <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.token')}</span><span style={{ color: T1, fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }}>••••{conn.token_hint ?? ''}</span></div>}
              {conn.mode === 'oauth' && conn.token_kind === 'user' && <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.tokenExpires')}</span><span style={{ color: T1, fontSize: 12.5 }}>{fmtDate(conn.token_expires_at)}</span></div>}
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.lastEvent')}</span><span style={{ color: T1, fontSize: 12.5 }}>{fmtDate(stats?.last_sent_at ?? conn.last_ok_at)}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.connectedSince')}</span><span style={{ color: T1, fontSize: 12.5 }}>{fmtDate(conn.created_at)}</span></div>
              {Array.isArray(health?.scopes) && conn.mode === 'oauth' && (
                <div className="pt-1">
                  <p style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.scopes')} <span style={{ color: T3 }}>· {(health!.scopes as string[]).length}</span></p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(health!.scopes as string[]).map((s) => (
                      <span key={s} className="px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {emq != null && <div className="flex justify-between gap-3"><span style={{ color: T2, fontSize: 12.5 }}>{t('integ.meta.emq')}</span><span style={{ color: emq >= 6 ? POS : WARN, fontSize: 12.5, fontWeight: 700 }}>{emq.toFixed(1)} / 10</span></div>}
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
            {conn.mode === 'manual' ? (
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
            ) : (
              <div>
                <Label hint={t('integ.meta.healthHint')}>{t('integ.meta.health')}</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  <button type="button" onClick={handleHealth} disabled={busy !== null}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.08)', color: T1, border: `1px solid ${BORDER}` }}>
                    {busy === 'health' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                    {t('integ.meta.healthBtn')}
                  </button>
                  {conn.assets && (
                    <button type="button" onClick={() => setChangingAssets((v) => !v)} disabled={busy !== null}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold"
                      style={{ background: 'rgba(255,255,255,0.08)', color: T1, border: `1px solid ${BORDER}` }}>
                      <RefreshCw className="w-4 h-4" /> {t('integ.meta.changeAssets')}
                    </button>
                  )}
                  {conn.last_health_at && <span style={{ color: T3, fontSize: 12 }}>{t('integ.meta.healthChecked').replace('{date}', fmtDate(conn.last_health_at))}</span>}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: T3 }} />
            <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('integ.meta.domainNote')}</p>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-3 flex-wrap">{openEventsManager}{helpLink}</div>
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
