import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StudioScope } from '@/components/email-studio/hooks';
import { buildHealthView, campaignModeLabel, fmtPct, useSenderHealth } from '@/lib/email/senderHealth';
import { healthWord, type HealthLang } from '@/lib/email/senderHealthWords';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';
const TONE = {
  ok: { dot: 'var(--acc-34d399)', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.25)' },
  warn: { dot: 'var(--acc-fcd34d)', bg: 'rgba(252,211,77,0.08)', border: 'rgba(252,211,77,0.28)' },
  bad: { dot: 'var(--acc-ff5c63)', bg: 'rgba(255,92,99,0.08)', border: 'rgba(255,92,99,0.28)' },
  neutral: { dot: 'rgb(var(--ink)/0.4)', bg: INNER_BG, border: BORDER },
} as const;
const card = { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '18px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 };
const h2 = { margin: 0, color: T1, fontSize: 16, fontWeight: 620, letterSpacing: '-0.01em' };
const p = { margin: 0, color: T2, fontSize: 13, lineHeight: 1.55 };

/**
 * Billetterie › E-mails › Santé des envois (`…/campaigns/health`) : la même
 * vue que la Console CRM (buildHealthView), au design des Consoles pro.
 */
export default function EmailHealthPanel({ scope, basePath }: { scope: StudioScope; basePath: string }) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const L = (['en', 'fr', 'es'].includes(language) ? language : 'en') as HealthLang;
  const w = (k: string, v?: Record<string, string | number | null | undefined>) => healthWord(L, k, v);
  const loc = L === 'en' ? 'en-GB' : L === 'fr' ? 'fr-FR' : 'es-ES';
  const n = (v: number) => v.toLocaleString(loc);
  const dShort = (iso: string) => new Date(iso).toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  const q = useSenderHealth(
    scope.kind === 'venue' ? scope.venueId : null,
    scope.kind === 'organizer' ? scope.organizerId : null,
    'suite',
  );
  const r = q.data;
  const view = r ? buildHealthView(r, L, n, dShort) : null;
  const segColor = { engaged: 'var(--acc-34d399)', contacted: 'rgb(var(--ink)/0.35)', never: 'rgb(var(--ink)/0.12)' } as const;

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--sf-000000)' }}>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 w-full" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => navigate(basePath)} aria-label="back" className="cursor-pointer"
            style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${BORDER}`, background: INNER_BG, display: 'grid', placeItems: 'center' }}>
            <ArrowLeft className="w-4 h-4" style={{ color: T2 }} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{scope.name}</div>
            <h1 style={{ margin: '6px 0 0', color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{w('title')}</h1>
            <div style={{ ...p, marginTop: 6, maxWidth: 640 }}>{w('sub')}</div>
          </div>
        </div>

        {q.loading && !r ? (
          <div style={{ ...card, alignItems: 'center', padding: 40 }}><Loader2 className="w-5 h-5 animate-spin" style={{ color: T3 }} /></div>
        ) : q.error || !r || !view ? (
          <div style={card}>
            <p style={p}>{w('error')}</p>
            <button type="button" onClick={() => { void q.reload(); }} style={{ alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 10, background: T1, color: 'var(--sf-000000)', fontSize: 12.5, fontWeight: 600 }}>{w('retry')}</button>
          </div>
        ) : (
          <>
            {/* Verdict */}
            <section style={{ ...card, background: TONE[view.tone].bg, border: `1px solid ${TONE[view.tone].border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 11, height: 11, borderRadius: 99, background: TONE[view.tone].dot, flex: 'none' }} />
                <h2 style={{ ...h2, fontSize: 20 }}>{view.title}</h2>
              </div>
              <p style={{ ...p, color: T1, opacity: 0.85 }}>{view.sub}</p>
              {view.reasons.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{w('reason.t')}</span>
                  {view.reasons.map((x) => <p key={x} style={{ ...p, color: T1 }}>{x}</p>)}
                </div>
              )}
              <span style={{ color: T3, fontSize: 11.5 }}>{w('updated', { time: new Date(r.generated_at).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) })}</span>
            </section>

            {view.rights && (
              <section style={card}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={h2}>{w('rights.t')}</h2>
                  <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{w('rights.level', { n: view.rights.level })} · {view.rights.name}</span>
                </div>
                <p style={p}>{w('rights.s')}</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {view.rights.ladder.map((l) => (
                    <div key={l.level} aria-current={l.on ? 'step' : undefined}
                      style={{ borderRadius: 10, padding: '8px 6px', textAlign: 'center', border: `1px solid ${l.on ? 'transparent' : BORDER}`, background: l.on ? T1 : l.passed ? 'rgb(var(--ink)/0.12)' : INNER_BG, color: l.on ? 'var(--sf-000000)' : T1 }}>
                      <div style={{ fontSize: 10.5, opacity: 0.7 }}>{l.level}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{l.name}</div>
                      <div style={{ fontSize: 10.5, opacity: 0.7 }}>{l.daily}/j</div>
                    </div>
                  ))}
                </div>
                {view.rights.progress && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ position: 'relative', height: 8, borderRadius: 99, background: 'rgb(var(--ink)/0.1)', overflow: 'hidden' }} role="progressbar" aria-valuemin={0} aria-valuemax={view.rights.progress.total} aria-valuenow={view.rights.progress.passed} aria-label={view.rights.progress.label}>
                      <div style={{ position: 'absolute', inset: 0, width: `${Math.max(4, view.rights.progress.ratio * 100)}%`, borderRadius: 99, background: '#E8192C' }} />
                    </div>
                    <span style={{ color: T2, fontSize: 12 }}>{view.rights.progress.label}</span>
                  </div>
                )}
                <span style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{w('rights.current')}</span>
                <div className="flex flex-wrap gap-2">
                  {view.rights.limits.map((x) => <span key={x} style={{ padding: '4px 10px', borderRadius: 999, background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, fontSize: 12 }}>{x}</span>)}
                </div>
                {view.rights.next && (
                  <div style={{ borderRadius: 12, padding: 12, background: INNER_BG, border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <strong style={{ color: T1, fontSize: 13 }}>{view.rights.next.title}</strong>
                    {view.rights.next.checks.map((c) => (
                      <div key={c.key} className="flex items-start gap-2" style={{ fontSize: 12.5, color: c.ok ? T1 : T2 }}>
                        <span aria-hidden style={{ color: c.ok ? 'var(--acc-34d399)' : T3, fontWeight: 700, width: 12 }}>{c.ok ? '✓' : '·'}</span>{c.label}
                      </div>
                    ))}
                    <span style={{ color: T3, fontSize: 11.5 }}>{view.rights.next.when}</span>
                  </div>
                )}
                {view.rights.nextNote && <p style={p}>{view.rights.nextNote}</p>}
                {view.rights.history.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong style={{ color: T1, fontSize: 12.5 }}>{w('hist.t')}</strong>
                    {view.rights.history.map((h, i) => <p key={`${h.at}-${i}`} style={p}><b style={{ color: T1 }}>{h.at}</b> · {h.label}{h.from != null ? ` (${h.from} → ${h.to})` : ` (${h.to})`}</p>)}
                  </div>
                )}
              </section>
            )}

            {view.platform && (
              <section style={{ ...card, flexDirection: 'row', background: TONE.warn.bg, border: `1px solid ${TONE.warn.border}` }}>
                <AlertTriangle className="w-4 h-4 flex-none mt-0.5" style={{ color: 'var(--acc-fcd34d)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <strong style={{ color: T1, fontSize: 14 }}>{view.platform.title}</strong>
                  <p style={p}>{view.platform.text}</p>
                </div>
              </section>
            )}

            {/* Règles */}
            <section style={card}>
              <div><h2 style={h2}>{w('rules.t')}</h2><p style={{ ...p, marginTop: 4 }}>{w('rules.s')}</p></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {view.rules.map((x) => (
                  <div key={x.key} style={{ borderRadius: 12, padding: 14, background: INNER_BG, border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ color: T1, fontSize: 13.5 }}>{w(`rule.${x.key}.t`)}</strong>
                      <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: x.active ? T1 : T3, background: x.active ? 'rgb(var(--ink)/0.1)' : 'transparent', border: `1px solid ${BORDER}` }}>{x.active ? w('on') : w('off')}</span>
                    </div>
                    <p style={{ ...p, color: T1 }}>{x.text}</p>
                    {x.why && <p style={p}><b style={{ color: T1, fontWeight: 600 }}>{w('rule.why')} · </b>{x.why}</p>}
                    {x.lift && <p style={p}><b style={{ color: T1, fontWeight: 600 }}>{w('rule.lift')} · </b>{x.lift}</p>}
                    {x.ifBad && <p style={p}><b style={{ color: T1, fontWeight: 600 }}>{w('rule.ifBad')} · </b>{x.ifBad}</p>}
                  </div>
                ))}
              </div>
            </section>

            {/* Chiffres */}
            <section style={card}>
              <h2 style={h2}>{w('m.t')}</h2>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {view.tiles.map((tl) => {
                  const tc = tl.gauge ? TONE[tl.gauge.tone] : null;
                  return (
                    <div key={tl.key} style={{ borderRadius: 12, padding: 12, background: INNER_BG, border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ color: T2, fontSize: 11.5 }}>{w(`m.${tl.key}`)}</span>
                      <span style={{ color: T1, fontSize: tl.key === 'gmail' ? 14 : 20, fontWeight: 640 }}>{tl.value}</span>
                      {tl.gauge && (
                        <div style={{ position: 'relative', height: 5, borderRadius: 99, background: 'rgb(var(--ink)/0.1)' }} aria-hidden>
                          <div style={{ position: 'absolute', inset: 0, width: `${Math.max(3, tl.gauge.ratio * 100)}%`, borderRadius: 99, background: tc?.dot }} />
                          <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${tl.gauge.threshold * 100}%`, width: 2, background: T2 }} />
                        </div>
                      )}
                      {tl.sub && <span style={{ color: T3, fontSize: 11 }}>{tl.sub}</span>}
                    </div>
                  );
                })}
              </div>
              <p style={{ ...p, fontSize: 12 }}>{w('m.gmailNote')}</p>
            </section>

            {/* Base */}
            <section style={card}>
              <div><h2 style={h2}>{w('base.t')}</h2><p style={{ ...p, marginTop: 4 }}>{w('base.s', { n: n(view.base.total) })}</p></div>
              {view.base.total > 0 && (
                <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', background: INNER_BG }} aria-hidden>
                  {view.base.segments.map((s) => s.n > 0 && <div key={s.key} style={{ width: `${(s.n / view.base.total) * 100}%`, background: segColor[s.key] }} />)}
                </div>
              )}
              {view.base.segments.map((s) => (
                <div key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: segColor[s.key], flex: 'none', border: `1px solid ${BORDER}` }} />
                  <p style={{ ...p, color: T1 }}>
                    <b>{n(s.n)}</b> {s.label.toLowerCase()}{view.base.total > 0 && <span style={{ color: T3 }}> ({fmtPct((s.n * 100) / view.base.total, L, 0)})</span>} — <span style={{ color: T2 }}>{s.what}</span>
                  </p>
                </div>
              ))}
              <p style={p}>{view.base.gmail}</p>
              {view.held.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
                  <strong style={{ color: T1, fontSize: 13 }}>{w('held.t')}</strong>
                  {view.held.map((h) => <p key={h.key} style={p}><b style={{ color: T1 }}>{n(h.n)}</b> · {h.label}</p>)}
                </div>
              )}
            </section>

            {/* Campagnes */}
            <section style={card}>
              <h2 style={h2}>{w('c.t')}</h2>
              {r.campaigns.length === 0 ? <p style={p}>{w('c.empty')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ fontSize: 12.5, minWidth: 680, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: T3 }}>
                        {['c.name', 'c.sent', 'c.bounce', 'c.opens', 'c.gmail', 'c.held', 'c.mode'].map((k, i) => (
                          <th key={k} className="font-medium py-2 px-2" style={{ textAlign: i === 0 ? 'left' : 'right', whiteSpace: 'nowrap' }}>{w(k)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.campaigns.map((c) => {
                        const other = c.sent - c.gmail_sent;
                        const go = c.gmail_sent >= 30 ? (c.gmail_opened * 100) / c.gmail_sent : null;
                        const oo = other >= 30 ? ((c.opened - c.gmail_opened) * 100) / other : null;
                        const bad = go != null && oo != null && oo > 0 && go / oo < r.thresholds.gmail_relative;
                        return (
                          <tr key={c.id} style={{ borderTop: `1px solid ${BORDER}`, color: T1 }}>
                            <td className="py-2 px-2">
                              <button type="button" onClick={() => navigate(`${basePath}/${c.id}/report`)} className="text-left font-semibold hover:underline">{c.name || '—'}</button>
                              <div style={{ color: T3, fontSize: 11 }}>{c.at ? dShort(c.at) : ''}{c.kind === 'info' ? ` · ${w('c.info')}` : ''}</div>
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums">{n(c.sent)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtPct(c.sent >= 50 ? (c.bounced * 100) / c.sent : null, L)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtPct(c.sent >= 50 ? (c.opened * 100) / c.sent : null, L)}</td>
                            <td className="py-2 px-2 text-right tabular-nums" style={{ color: bad ? 'var(--acc-ff5c63)' : undefined, fontWeight: bad ? 600 : undefined }}>{fmtPct(go, L)} / {fmtPct(oo, L)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{c.held ? n(c.held) : '—'}</td>
                            <td className="py-2 px-2 text-right" style={{ whiteSpace: 'nowrap', color: c.wave_state === 'halted' ? 'var(--acc-ff5c63)' : T2 }}>{c.kind === 'info' ? '—' : campaignModeLabel(c, L)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section style={{ ...card, background: INNER_BG, boxShadow: 'none' }}>
              <strong style={{ color: T1, fontSize: 13.5 }}>{w('how.t')}</strong>
              <p style={p}>{w('how.s')}</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
