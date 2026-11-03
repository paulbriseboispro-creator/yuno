/**
 * E-mails › Santé (`/crm/emails/health`) — « mes e-mails arrivent-ils, et
 * pourquoi Yuno me limite ? ». Une lecture (`email_sender_health_report`),
 * mise en phrases par `buildHealthView` (même vue que la Billetterie) : le
 * verdict et ses raisons, la reprise Gmail de la plateforme, les règles
 * appliquées au compte (pourquoi, ce qui les lève), les chiffres face aux
 * seuils, la base joignable, ce qui a été gardé de côté, les dernières
 * campagnes. Rien d'estimé : tout vient des envois réels.
 */
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useEmailCampaigns } from '@/crm/data/emails';
import { buildHealthView, campaignModeLabel, fmtPct, useSenderHealth, type HealthView } from '@/lib/email/senderHealth';
import { healthWord, type HealthLang } from '@/lib/email/senderHealthWords';
import { EmailsShell } from '../EmailsShell';

const TONE = {
  ok: { dot: 'var(--green-500)', bg: 'rgba(23,163,74,.08)', fg: 'var(--green-700, #15803d)' },
  warn: { dot: 'var(--amber-500, #f59e0b)', bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
  bad: { dot: 'var(--red-500)', bg: 'rgba(232,25,44,.07)', fg: 'var(--red-600, #c81325)' },
  neutral: { dot: 'var(--sand-400)', bg: 'var(--sand-50)', fg: 'var(--sand-700)' },
} as const;

const card: CSSProperties = { borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', padding: 'clamp(20px,3vw,28px)', display: 'flex', flexDirection: 'column', gap: 14 };
const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21, letterSpacing: '-.02em', color: 'var(--ink)' };
const small: CSSProperties = { fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', margin: 0 };
const rise = (d: number): CSSProperties => ({ animation: `yc-rise 700ms cubic-bezier(.22,1,.36,1) ${d}ms both` });

export default function EmailHealthPage() {
  const { t, n, dShort, time, lang } = useCrmT();
  const { rpc } = useCrmScope();
  const list = useEmailCampaigns();
  const drafts = (list.data?.campaigns ?? []).filter((c) => c.status === 'draft').length;
  const q = useSenderHealth(rpc.p_venue_id, rpc.p_organizer_user_id, 'crm');
  const L = lang as HealthLang;
  const w = (k: string, v?: Record<string, string | number | null | undefined>) => healthWord(L, k, v);
  const view = q.data ? buildHealthView(q.data, L, (v) => n(v), (iso) => dShort(iso)) : null;

  return (
    <EmailsShell tab="health" title={w('title')} sub={w('sub')} drafts={drafts} hideNew>
      {q.loading && !q.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Skel h={180} r={28} /><Skel h={260} r={28} /><Skel h={200} r={28} />
        </div>
      ) : q.error || !q.data || !view ? (
        <section style={{ ...card, alignItems: 'flex-start' }}>
          <p style={small}>{w('error')}</p>
          <button type="button" onClick={() => { void q.reload(); }} style={{ height: 40, padding: '0 18px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>{w('retry')}</button>
        </section>
      ) : (
        <Body view={view} q={q.data} w={w} n={n} dShort={dShort} lang={L} time={time} />
      )}
    </EmailsShell>
  );
}

function Body({ view, q, w, n, dShort, lang, time }: {
  view: HealthView;
  q: NonNullable<ReturnType<typeof useSenderHealth>['data']>;
  w: (k: string, v?: Record<string, string | number | null | undefined>) => string;
  n: (v: number) => string;
  dShort: (d: string) => string;
  lang: HealthLang;
  time: (d: string) => string;
}) {
  const tone = TONE[view.tone];
  const base = view.base;
  const segColor = { engaged: 'var(--green-500)', contacted: 'var(--sand-400)', never: 'var(--sand-200)' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Verdict */}
      <section style={{ ...card, background: tone.bg, boxShadow: 'none', ...rise(0) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, background: tone.dot, flex: 'none', boxShadow: `0 0 0 6px color-mix(in srgb, ${tone.dot} 18%, transparent)` }} />
          <h2 style={{ ...h2, fontSize: 'clamp(22px,3vw,28px)' }}>{view.title}</h2>
        </div>
        <p style={{ ...small, fontSize: 15.5, color: 'var(--sand-700)' }}>{view.sub}</p>
        {view.reasons.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: tone.fg }}>{w('reason.t')}</span>
            {view.reasons.map((r) => <p key={r} style={{ ...small, color: 'var(--ink)', fontSize: 15 }}>{r}</p>)}
          </div>
        )}
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{w('updated', { time: time(q.generated_at) })}</span>
      </section>

      {view.rights && <RightsCard r={view.rights} w={w} />}

      {/* Reprise Gmail de la plateforme */}
      {view.platform && (
        <section style={{ ...card, background: 'var(--amber-50)', boxShadow: 'none', flexDirection: 'row', gap: 14, ...rise(80) }}>
          <span style={{ flex: 'none', color: 'var(--amber-700)', marginTop: 2 }}><Icon name="alert" size={20} stroke={2.2} /></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontSize: 15.5, color: 'var(--ink)' }}>{view.platform.title}</strong>
            <p style={{ ...small, color: 'var(--sand-700)' }}>{view.platform.text}</p>
          </div>
        </section>
      )}

      {/* Règles */}
      <section style={{ ...card, ...rise(140) }}>
        <div><h2 style={h2}>{w('rules.t')}</h2><p style={{ ...small, marginTop: 4 }}>{w('rules.s')}</p></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 12 }}>
          {view.rules.map((r) => (
            <div key={r.key} style={{ borderRadius: 20, padding: 18, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <strong style={{ fontSize: 15.5, color: 'var(--ink)' }}>{w(`rule.${r.key}.t`)}</strong>
                <span style={{ height: 24, padding: '0 10px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', background: r.active ? 'var(--ink)' : 'var(--sand-200)', color: r.active ? '#fff' : 'var(--sand-700)' }}>{r.active ? w('on') : w('off')}</span>
              </div>
              <p style={{ ...small, color: 'var(--ink)' }}>{r.text}</p>
              {r.why && <p style={small}><b style={{ color: 'var(--sand-700)' }}>{w('rule.why')} · </b>{r.why}</p>}
              {r.lift && <p style={small}><b style={{ color: 'var(--sand-700)' }}>{w('rule.lift')} · </b>{r.lift}</p>}
              {r.ifBad && <p style={small}><b style={{ color: 'var(--sand-700)' }}>{w('rule.ifBad')} · </b>{r.ifBad}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Chiffres */}
      <section style={{ ...card, ...rise(200) }}>
        <h2 style={h2}>{w('m.t')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 12 }}>
          {view.tiles.map((tl) => {
            const tc = tl.gauge ? TONE[tl.gauge.tone] : null;
            return (
              <div key={tl.key} style={{ borderRadius: 20, padding: 16, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--sand-600)', fontWeight: 500 }}>{w(`m.${tl.key}`)}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: tl.key === 'gmail' ? 17 : 26, fontWeight: 600, letterSpacing: '-.02em', color: tc && tl.gauge?.tone !== 'ok' ? tc.fg : 'var(--ink)' }}>{tl.value}</span>
                {tl.gauge && (
                  <div style={{ position: 'relative', height: 6, borderRadius: 99, background: 'var(--sand-200)' }} aria-hidden>
                    <div style={{ position: 'absolute', inset: 0, width: `${Math.max(3, tl.gauge.ratio * 100)}%`, borderRadius: 99, background: tc?.dot }} />
                    <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${tl.gauge.threshold * 100}%`, width: 2, background: 'var(--ink)', opacity: 0.6 }} />
                  </div>
                )}
                {tl.sub && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tl.sub}</span>}
              </div>
            );
          })}
        </div>
        <p style={{ ...small, fontSize: 13.5 }}>{w('m.gmailNote')}</p>
      </section>

      {/* Base */}
      <section style={{ ...card, ...rise(260) }}>
        <div><h2 style={h2}>{w('base.t')}</h2><p style={{ ...small, marginTop: 4 }}>{w('base.s', { n: n(base.total) })}</p></div>
        {base.total > 0 && (
          <div style={{ display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', background: 'var(--sand-100)' }} aria-hidden>
            {base.segments.map((s) => s.n > 0 && <div key={s.key} style={{ width: `${(s.n / base.total) * 100}%`, background: segColor[s.key] }} />)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {base.segments.map((s) => (
            <div key={s.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: segColor[s.key], flex: 'none', boxShadow: 'inset 0 0 0 1px var(--sand-300)' }} />
              <p style={{ ...small, color: 'var(--ink)' }}>
                <b>{n(s.n)}</b> {s.label.toLowerCase()} {fmtPct(base.total ? (s.n * 100) / base.total : null, lang, 0) !== '—' && <span style={{ color: 'var(--sand-500)' }}>({fmtPct((s.n * 100) / base.total, lang, 0)})</span>} — <span style={{ color: 'var(--sand-600)' }}>{s.what}</span>
              </p>
            </div>
          ))}
        </div>
        <p style={small}>{base.gmail}</p>
        {view.held.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--sand-200)', paddingTop: 12 }}>
            <strong style={{ fontSize: 14.5, color: 'var(--ink)' }}>{w('held.t')}</strong>
            {view.held.map((h) => <p key={h.key} style={small}><b style={{ color: 'var(--ink)' }}>{n(h.n)}</b> · {h.label}</p>)}
          </div>
        )}
      </section>

      {/* Campagnes */}
      <section style={{ ...card, ...rise(320) }}>
        <h2 style={h2}>{w('c.t')}</h2>
        {q.campaigns.length === 0 ? <p style={small}>{w('c.empty')}</p> : (
          <div className="yc-thin-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 720 }}>
              <thead>
                <tr style={{ color: 'var(--sand-500)', textAlign: 'left' }}>
                  {['c.name', 'c.sent', 'c.bounce', 'c.opens', 'c.gmail', 'c.held', 'c.mode'].map((k, i) => (
                    <th key={k} style={{ fontWeight: 500, padding: '8px 10px', textAlign: i === 0 ? 'left' : 'right', whiteSpace: 'nowrap' }}>{w(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.campaigns.map((c) => {
                  const other = c.sent - c.gmail_sent;
                  const go = c.gmail_sent >= 30 ? (c.gmail_opened * 100) / c.gmail_sent : null;
                  const oo = other >= 30 ? ((c.opened - c.gmail_opened) * 100) / other : null;
                  const bad = go != null && oo != null && oo > 0 && go / oo < q.thresholds.gmail_relative;
                  return (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--sand-200)' }}>
                      <td style={{ padding: '10px' }}>
                        <Hv as={Link} to={CRM_ROUTES.emailResults(c.id)} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }} hover={{ textDecoration: 'underline' }}>{c.name || '—'}</Hv>
                        <div style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{c.at ? dShort(c.at) : ''}{c.kind === 'info' ? ` · ${w('c.info')}` : ''}</div>
                      </td>
                      <td style={{ padding: 10, textAlign: 'right' }}>{n(c.sent)}</td>
                      <td style={{ padding: 10, textAlign: 'right' }}>{fmtPct(c.sent >= 50 ? (c.bounced * 100) / c.sent : null, lang)}</td>
                      <td style={{ padding: 10, textAlign: 'right' }}>{fmtPct(c.sent >= 50 ? (c.opened * 100) / c.sent : null, lang)}</td>
                      <td style={{ padding: 10, textAlign: 'right', color: bad ? 'var(--red-500)' : undefined, fontWeight: bad ? 600 : undefined }}>{fmtPct(go, lang)} / {fmtPct(oo, lang)}</td>
                      <td style={{ padding: 10, textAlign: 'right' }}>{c.held ? n(c.held) : '—'}</td>
                      <td style={{ padding: 10, textAlign: 'right', whiteSpace: 'nowrap', color: c.wave_state === 'halted' ? 'var(--red-500)' : 'var(--sand-700)' }}>{c.kind === 'info' ? '—' : campaignModeLabel(c, lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ ...card, background: 'var(--sand-50)', boxShadow: 'none', ...rise(380) }}>
        <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{w('how.t')}</strong>
        <p style={small}>{w('how.s')}</p>
      </section>
    </div>
  );
}

/** Vos droits d'envoi : le niveau, ses limites, l'échelle, le palier suivant et l'historique. */
function RightsCard({ r, w }: { r: NonNullable<HealthView['rights']>; w: (k: string, v?: Record<string, string | number | null | undefined>) => string }) {
  return (
    <section style={{ ...card, ...rise(110) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={h2}>{w('rights.t')}</h2>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{w('rights.level', { n: r.level })} · {r.name}</span>
      </div>
      <p style={small}>{w('rights.s')}</p>
      <div role="list" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 6 }}>
        {r.ladder.map((l) => (
          <div role="listitem" key={l.level} aria-current={l.on ? 'step' : undefined}
            style={{ borderRadius: 14, padding: '10px 8px', textAlign: 'center', background: l.on ? 'var(--ink)' : l.passed ? 'var(--sand-200)' : 'var(--sand-50)', color: l.on ? '#fff' : 'var(--ink)', boxShadow: l.on ? 'none' : 'inset 0 0 0 1px var(--sand-200)' }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{l.level}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>{l.name}</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{l.daily}/j</div>
          </div>
        ))}
      </div>
      {r.progress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative', height: 10, borderRadius: 99, background: 'var(--sand-200)', overflow: 'hidden' }} role="progressbar" aria-valuemin={0} aria-valuemax={r.progress.total} aria-valuenow={r.progress.passed} aria-label={r.progress.label}>
            <div style={{ position: 'absolute', inset: 0, width: `${Math.max(4, r.progress.ratio * 100)}%`, borderRadius: 99, background: 'var(--gradient-brand)', transition: 'width 600ms' }} />
          </div>
          <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{r.progress.label}</span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{w('rights.current')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {r.limits.map((x) => <span key={x} style={{ padding: '6px 12px', borderRadius: 99, background: 'var(--sand-100)', fontSize: 13.5, color: 'var(--ink)' }}>{x}</span>)}
        </div>
      </div>
      {r.next && (
        <div style={{ borderRadius: 20, padding: 16, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{r.next.title}</strong>
          {r.next.checks.map((c) => (
            <div key={c.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45, color: c.ok ? 'var(--ink)' : 'var(--sand-600)' }}>
              <span aria-hidden style={{ flex: 'none', width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: c.ok ? 'var(--green-500)' : 'var(--sand-200)', color: c.ok ? '#fff' : 'var(--sand-600)' }}>{c.ok ? '✓' : '·'}</span>
              {c.label}
            </div>
          ))}
          <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{r.next.when}</span>
        </div>
      )}
      {r.nextNote && <p style={small}>{r.nextNote}</p>}
      {r.history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{w('hist.t')}</strong>
          {r.history.map((h, i) => (
            <p key={`${h.at}-${i}`} style={small}><b style={{ color: 'var(--ink)' }}>{h.at}</b> · {h.label}{h.from != null ? ` (${h.from} → ${h.to})` : ` (${h.to})`}</p>
          ))}
        </div>
      )}
    </section>
  );
}
