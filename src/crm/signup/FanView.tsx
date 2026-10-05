/**
 * Page d'inscription vue par le fan (« FanPage » du design) : affiche, hôte,
 * titre, accroche, compte à rebours jusqu'à l'ouverture de la vente, récompense,
 * nombre d'inscrits, formulaire (prénom, e-mail, téléphone facultatif, deux
 * questions au plus), case d'accord OBLIGATOIRE dont le texte exact part avec
 * l'inscription, puis « C'est noté » / page fermée. Le MÊME composant sert la
 * route publique `/j/<slug>` et l'aperçu du constructeur (`preview` : rien n'est
 * enregistré). Tutoiement côté fan, comme le design.
 */
import { useEffect, useMemo, useState } from 'react';
import { Wordmark } from '@/components/brand/Wordmark';
import { useCrmT } from '@/crm/i18n';

export interface FanPageData {
  slug: string; occasion: 'night' | 'community'; title: string; tagline: string; button_label: string; thanks_message: string;
  poster_url: string | null; theme: { bg: string; accent: string; font: 'display' | 'serif' | 'mono' };
  fields: { contact: 'email' | 'email_phone'; questions: { label: string; options: string[]; multi: boolean }[] };
  reward: { label: string; how: string } | null; opens_at: string | null; sale_opens_at: string | null; closes_at: string | null;
  state: 'open' | 'soon' | 'closed'; count: number | null; demo: boolean; host: string;
  event: { title: string; start_at: string; image_url: string | null; ticket_url: string | null; place: string | null } | null;
}
export type SubmitResult = 'ok' | 'already' | 'closed' | 'demo' | 'invalid_email' | 'disposable' | 'rate_limited' | 'consent_required' | 'invalid' | 'error';

const FONTS: Record<FanPageData['theme']['font'], string> = {
  display: "'Bricolage Grotesque', 'Helvetica Neue', Arial, sans-serif",
  serif: "'DM Serif Display', Georgia, serif",
  mono: "'Space Mono', 'Geist Mono', monospace",
};

/** Luminance relative (WCAG) d'une couleur #RRGGBB. */
function lum(hex: string): number {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function inkOn(hex: string): string { return /^#[0-9a-f]{6}$/i.test(hex) && lum(hex) > 0.4 ? '#141012' : '#ffffff'; }
function rgb(hex: string): string { const c = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)).join(','); }

function useCountdown(to: string | null): { d: number; h: number; m: number; s: number } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!to) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [to]);
  if (!to) return null;
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export default function FanView({ page, preview = false, onSubmit }: {
  page: FanPageData; preview?: boolean;
  onSubmit?: (v: { first_name: string; email: string; phone: string; answers: Record<string, string | string[]>; consent_text: string }) => Promise<SubmitResult>;
}) {
  const { t, lang } = useCrmT();
  const bg = /^#[0-9a-f]{6}$/i.test(page.theme.bg) ? page.theme.bg : '#0A0A0A';
  const accent = /^#[0-9a-f]{6}$/i.test(page.theme.accent) ? page.theme.accent : '#E3141B';
  const ink = inkOn(bg);
  const aInk = inkOn(accent);
  const inkM = ink === '#ffffff' ? 'rgba(255,255,255,.66)' : 'rgba(20,16,18,.62)';
  const line = ink === '#ffffff' ? 'rgba(255,255,255,.16)' : 'rgba(20,16,18,.14)';
  const field = ink === '#ffffff' ? 'rgba(255,255,255,.07)' : 'rgba(20,16,18,.05)';
  const poster = page.poster_url ?? page.event?.image_url ?? null;
  const cd = useCountdown(page.sale_opens_at);
  const saleOpen = !!page.sale_opens_at && new Date(page.sale_opens_at).getTime() <= Date.now();
  const consentText = t('yc.fan.consent', { host: page.host });

  const [first, setFirst] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SubmitResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dateLabel = useMemo(() => {
    if (!page.event?.start_at) return null;
    const d = new Date(page.event.start_at);
    return d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  }, [page.event, lang]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!first.trim()) { setErr(t('yc.fan.errFirst')); return; }
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) { setErr(t('yc.fan.errEmail')); return; }
    if (!consent) { setErr(t('yc.fan.errConsent')); return; }
    if (preview || !onSubmit) { setRes('ok'); return; }
    setBusy(true);
    const r = await onSubmit({ first_name: first.trim(), email: email.trim(), phone: phone.trim(), answers, consent_text: consentText }).catch(() => 'error' as SubmitResult);
    setBusy(false);
    if (r === 'ok' || r === 'already' || r === 'demo' || r === 'closed') setRes(r);
    else setErr(t(`yc.fan.err.${r}`));
  };

  const inputStyle = { height: 52, boxSizing: 'border-box', width: '100%', borderRadius: 14, border: `1.5px solid ${line}`, background: field, color: ink, padding: '0 16px', fontSize: 16, outline: 'none', font: 'inherit' } as const;
  const closed = page.state === 'closed';
  const soon = page.state === 'soon';

  return (
    <div style={{ minHeight: '100%', background: bg, color: ink, fontFamily: "Geist, 'Helvetica Neue', Arial, sans-serif", display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', height: poster ? 'clamp(300px, 52vh, 440px)' : 200, overflow: 'hidden', flex: 'none' }}>
        {poster ? <img src={poster} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(90% 80% at 50% 10%, rgba(${rgb(accent)},.45), ${bg})` }} />}
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(${rgb(bg)},.6) 0%, rgba(${rgb(bg)},0) 32%, rgba(${rgb(bg)},.78) 78%, ${bg} 100%)` }} />
        <div style={{ position: 'absolute', left: 18, right: 18, top: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: accent, color: aInk, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{page.host.slice(0, 2).toUpperCase()}</span>
            <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.host}</b>
          </span>
          <span style={{ flex: 'none', height: 30, padding: '0 12px', borderRadius: 99, background: `rgba(${rgb(bg)},.5)`, backdropFilter: 'blur(10px)', boxShadow: `inset 0 0 0 1px ${line}`, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600 }}>
            <i style={{ width: 6, height: 6, borderRadius: 99, background: closed ? inkM : accent, animation: closed ? undefined : 'fpulse 1.4s ease-in-out infinite' }} />
            {closed ? t('yc.fan.badgeClosed') : soon ? t('yc.fan.badgeSoon') : saleOpen ? t('yc.fan.badgeSale') : t('yc.fan.badgeOpen')}
          </span>
        </div>
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: inkM }}>
            {page.occasion === 'night' && page.event ? [dateLabel, page.event.place].filter(Boolean).join(' · ') : t('yc.fan.community')}
          </span>
          <h1 style={{ margin: 0, fontFamily: FONTS[page.theme.font], fontWeight: page.theme.font === 'serif' ? 400 : 700, fontSize: 'clamp(34px, 9vw, 52px)', lineHeight: 1, letterSpacing: page.theme.font === 'mono' ? '-.02em' : '-.035em', textWrap: 'balance', overflowWrap: 'anywhere' }}>{page.title || t('yc.fan.titlePh')}</h1>
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', padding: '18px 20px 28px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {page.tagline && <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: inkM }}>{page.tagline}</p>}

        {cd && !closed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: inkM }}>{t('yc.fan.saleIn')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {([['d', cd.d], ['h', cd.h], ['m', cd.m], ['s', cd.s]] as const).map(([k, v]) => (
                <span key={k} style={{ padding: '10px 0', borderRadius: 14, background: field, boxShadow: `inset 0 0 0 1px ${line}`, textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
                  <b style={{ fontFamily: "'Geist Mono', monospace", fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>{String(v).padStart(2, '0')}</b>
                  <span style={{ fontSize: 11, color: inkM }}>{t(`yc.fan.u.${k}`)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {saleOpen && page.event?.ticket_url && !closed && (
          <a href={page.event.ticket_url} target="_blank" rel="noreferrer" style={{ height: 54, borderRadius: 99, background: accent, color: aInk, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 16, textDecoration: 'none' }}>{t('yc.fan.takePlace')}</a>
        )}

        {page.reward && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 16px', borderRadius: 18, background: `rgba(${rgb(accent)},.14)`, boxShadow: `inset 0 0 0 1px rgba(${rgb(accent)},.35)` }}>
            <span style={{ fontSize: 22 }} aria-hidden>🎁</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: inkM }}>{t('yc.fan.reward')}</span>
              <b style={{ fontSize: 15.5 }}>{page.reward.label}</b>
              {page.reward.how && <span style={{ fontSize: 13, color: inkM }}>{page.reward.how}</span>}
            </span>
          </div>
        )}

        {page.count !== null && page.count > 0 && <span style={{ fontSize: 14, color: inkM }}>{t('yc.fan.count', { n: page.count })}</span>}

        {res ? (
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 20, borderRadius: 20, background: field, boxShadow: `inset 0 0 0 1px ${line}`, animation: 'fpop 420ms ease both' }}>
            <b style={{ fontFamily: FONTS[page.theme.font], fontSize: 26 }}>{res === 'demo' ? t('yc.fan.demoT') : res === 'closed' ? t('yc.fan.closedT') : t('yc.fan.okT')}</b>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: inkM }}>
              {res === 'demo' ? t('yc.fan.demoS') : res === 'closed' ? t('yc.fan.closedS', { host: page.host }) : res === 'already' ? t('yc.fan.alreadyS') : (page.thanks_message || t('yc.fan.okS', { host: page.host }))}
            </span>
            {(res === 'ok' || res === 'already') && <span style={{ fontSize: 14, fontWeight: 600 }}>{preview ? t('yc.fan.previewNote') : t('yc.fan.checkMail', { email: email.trim() })}</span>}
          </div>
        ) : closed ? (
          <div style={{ padding: 20, borderRadius: 20, background: field, boxShadow: `inset 0 0 0 1px ${line}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b style={{ fontSize: 20 }}>{t('yc.fan.closedT')}</b>
            <span style={{ fontSize: 15, color: inkM }}>{t('yc.fan.closedS', { host: page.host })}</span>
          </div>
        ) : soon ? (
          <div style={{ padding: 20, borderRadius: 20, background: field, boxShadow: `inset 0 0 0 1px ${line}`, fontSize: 15, color: inkM }}>
            {t('yc.fan.soonS', { date: page.opens_at ? new Date(page.opens_at).toLocaleString(lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '' })}
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} noValidate>
            <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder={t('yc.fan.first')} aria-label={t('yc.fan.first')} autoComplete="given-name" maxLength={60} style={inputStyle} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('yc.fan.email')} aria-label={t('yc.fan.email')} type="email" autoComplete="email" maxLength={200} style={inputStyle} />
            {page.fields.contact === 'email_phone' && <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('yc.fan.phone')} aria-label={t('yc.fan.phone')} type="tel" autoComplete="tel" maxLength={24} style={inputStyle} />}
            {page.fields.questions.map((q) => (
              <fieldset key={q.label} style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{q.label} <span style={{ color: inkM, fontWeight: 400 }}>· {t('yc.fan.optional')}</span></legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {q.options.map((o) => {
                    const cur = answers[q.label];
                    const on = Array.isArray(cur) ? cur.includes(o) : cur === o;
                    return (
                      <button key={o} type="button" aria-pressed={on} onClick={() => setAnswers((a) => {
                        if (!q.multi) return { ...a, [q.label]: on ? '' : o };
                        const arr = Array.isArray(a[q.label]) ? (a[q.label] as string[]) : [];
                        return { ...a, [q.label]: on ? arr.filter((x) => x !== o) : [...arr, o] };
                      })} style={{ height: 40, padding: '0 16px', borderRadius: 99, border: on ? 0 : `1.5px solid ${line}`, background: on ? accent : 'transparent', color: on ? aInk : ink, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{o}</button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45, color: inkM, cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: accent, flex: 'none' }} />
              <span>{consentText}</span>
            </label>
            {err && <span role="alert" style={{ fontSize: 14, color: ink === '#ffffff' ? '#ff8a80' : '#b3141b', animation: 'fshake 300ms' }}>{err}</span>}
            <button type="submit" disabled={busy} style={{ height: 56, borderRadius: 99, border: 0, background: accent, color: aInk, fontWeight: 700, fontSize: 16.5, cursor: busy ? 'wait' : 'pointer' }}>{busy ? t('yc.fan.sending') : page.button_label || t('yc.fan.buttonPh')}</button>
            <span style={{ fontSize: 12.5, color: inkM, textAlign: 'center' }}>{t('yc.fan.noAccount', { host: page.host })}</span>
          </form>
        )}
      </div>
      <footer style={{ marginTop: 'auto', padding: '18px 20px 26px', textAlign: 'center', fontSize: 12.5, color: inkM }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>{t('yc.fan.powered')} <Wordmark height={13} tone={ink === '#ffffff' ? 'white' : 'dark'} alt="Yuno" /></span> · <a href="/legal/privacy" style={{ color: inkM }}>{t('yc.fan.privacy')}</a>
      </footer>
      <style>{'@keyframes fpop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}@keyframes fpulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes fshake{0%,100%{transform:none}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}'}</style>
    </div>
  );
}
