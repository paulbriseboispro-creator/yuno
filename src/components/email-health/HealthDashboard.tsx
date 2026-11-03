/**
 * « Santé de vos e-mails » en schémas — une page pour la Console CRM et la
 * Billetterie, chacune avec sa palette. Données : `email_sender_health_report`
 * (verdict, base, campagnes) + `email_sender_health_visual` (aujourd'hui, 30
 * jours, envoi intelligent, incidents). Règles de dessin dans
 * `src/lib/email/senderHealthVisual.ts` (testées). Peu de texte : un titre et un
 * chiffre par bloc ; les explications longues restent repliées.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buildHealthView, campaignModeLabel, fmtPct, type HealthReport } from '@/lib/email/senderHealth';
import { healthWord, type HealthLang } from '@/lib/email/senderHealthWords';
import { canDo, chartPoints, signals, usage, type HealthVisual, type Tone } from '@/lib/email/senderHealthVisual';

export interface HealthPalette {
  ink: string; sub: string; muted: string; line: string; inner: string;
  card: CSSProperties; h2: CSSProperties; display: string;
  green: string; amber: string; red: string; neutral: string; blue: string;
  toneBg: Record<'ok' | 'warn' | 'bad' | 'neutral', string>;
  /** Couleur d'un texte posé sur `ink` (bouton plein, étape courante). */
  onInk: string;
}

type W = (k: string, v?: Record<string, string | number | null | undefined>) => string;

export function HealthDashboard({ report, visual, lang, n, dShort, time, P, campaignHref }: {
  report: HealthReport;
  visual: HealthVisual | null;
  lang: HealthLang;
  n: (v: number) => string;
  dShort: (iso: string) => string;
  time: (iso: string) => string;
  P: HealthPalette;
  campaignHref: (id: string) => string;
}) {
  const w: W = (k, v) => healthWord(lang, k, v);
  const view = buildHealthView(report, lang, n, dShort);
  const toneColor = (t: Tone | 'neutral') => (t === 'ok' ? P.green : t === 'warn' ? P.amber : t === 'bad' ? P.red : P.neutral);
  const heroTone = view.tone;
  const level = report.rights?.current.level ?? visual?.today.level ?? 1;
  const maxShared = visual?.today.shared_max_level ?? 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1. Le verdict, en un feu */}
      <section style={{ ...P.card, background: P.toneBg[heroTone], border: 'none', boxShadow: 'none', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <TrafficLight tone={heroTone} P={P} />
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ ...P.h2, fontSize: 'clamp(21px,2.6vw,27px)' }}>{view.title}</h2>
          <p style={{ margin: 0, color: P.sub, fontSize: 14.5, lineHeight: 1.5 }}>{view.sub}</p>
          {view.reasons.slice(0, 2).map((r) => (
            <p key={r} style={{ margin: 0, color: P.ink, fontSize: 13.5, lineHeight: 1.45 }}>· {r}</p>
          ))}
        </div>
        <LevelSteps level={level} maxShared={maxShared} P={P} w={w} />
      </section>

      {view.platform && (
        <section style={{ ...P.card, background: P.toneBg.warn, border: 'none', boxShadow: 'none', flexDirection: 'row', gap: 12, alignItems: 'center', padding: '14px 18px' }}>
          <Dot color={P.amber} />
          <span style={{ color: P.ink, fontSize: 14, fontWeight: 600 }}>{view.platform.title}</span>
        </section>
      )}

      {/* 2. Aujourd'hui : trois anneaux */}
      {visual && (
        <section style={P.card}>
          <Head P={P} title={w('v.today.t')} right={w('updated', { time: time(report.generated_at) })} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: 12 }}>
            <RingTile P={P} w={w} n={n} label={w('v.today.sent')} used={visual.today.sent} cap={visual.today.daily_cap} />
            <RingTile P={P} w={w} n={n} label={w('v.today.cold')} used={visual.today.cold} cap={report.rules.cold_frozen_until ? 0 : visual.today.cold_cap}
              foot={w('v.today.gmail', { n: n(visual.today.cold_gmail), max: n(visual.today.cold_gmail_cap) })} />
            <RingTile P={P} w={w} n={n} label={w('v.today.month')} used={visual.today.cold_month} cap={report.rules.cold_frozen_until ? 0 : visual.today.cold_month_cap} />
          </div>
        </section>
      )}

      {/* 3. Ce que vous pouvez faire */}
      <section style={P.card}>
        <Head P={P} title={w('v.can.t')} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 8 }}>
          {canDo(report, visual, n).map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: P.inner }}>
              <StateIcon state={c.state} P={P} />
              <span style={{ color: c.state === 'no' ? P.sub : P.ink, fontSize: 14, lineHeight: 1.35 }}>{w(c.word, c.vars)}</span>
            </div>
          ))}
        </div>
        <Fold P={P} label={w('v.why')}>
          {visual?.smart.on && <p style={{ margin: 0, color: P.sub, fontSize: 13.5, lineHeight: 1.5 }}>{w('v.can.smart.w', { a: n(visual.smart.min_audience), r: visual.smart.min_received, d: visual.smart.days })}</p>}
          {view.rules.map((r) => (
            <p key={r.key} style={{ margin: 0, color: P.sub, fontSize: 13.5, lineHeight: 1.5 }}>
              <b style={{ color: P.ink }}>{w(`rule.${r.key}.t`)}</b> · {r.text}{r.why ? ` ${r.why}` : ''}
            </p>
          ))}
        </Fold>
      </section>

      {/* 4. Les 30 derniers jours */}
      {visual && (
        <section style={P.card}>
          <Head P={P} title={w('v.chart.t')} />
          <DayChart visual={visual} P={P} w={w} n={n} dShort={dShort} lang={lang} />
        </section>
      )}

      {/* 5. Les trois signaux */}
      <section style={P.card}>
        <Head P={P} title={w('v.sig.t')} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 12 }}>
          {signals(report).map((s) => <SignalTile key={s.key} s={s} P={P} w={w} lang={lang} toneColor={toneColor} />)}
        </div>
      </section>

      {/* 6. Qui peut recevoir */}
      <section style={P.card}>
        <Head P={P} title={w('v.base.t')} right={n(report.base.total)} />
        <BaseBar report={report} P={P} w={w} n={n} lang={lang} />
      </section>

      {/* 7. Mis de côté par Yuno */}
      {view.held.length > 0 && (
        <section style={P.card}>
          <Head P={P} title={w('v.held.t')} />
          <HeldBars held={view.held} P={P} n={n} />
          <p style={{ margin: 0, color: P.muted, fontSize: 13 }}>{w('v.held.s')}</p>
        </section>
      )}

      {/* 8. Incidents */}
      {visual && <Incidents visual={visual} P={P} w={w} dShort={dShort} />}

      {/* 9. Les campagnes */}
      <section style={P.card}>
        <Head P={P} title={w('c.t')} />
        {report.campaigns.length === 0 ? <p style={{ margin: 0, color: P.sub, fontSize: 14 }}>{w('c.empty')}</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {report.campaigns.map((c) => <CampaignRow key={c.id} c={c} P={P} w={w} n={n} dShort={dShort} lang={lang} href={campaignHref(c.id)} gmailRel={report.thresholds.gmail_relative} />)}
          </div>
        )}
      </section>

      <Fold P={P} label={w('v.more')} plain>
        <p style={{ margin: 0, color: P.sub, fontSize: 13.5, lineHeight: 1.55 }}>{w('how.s')}</p>
      </Fold>
    </div>
  );
}

// ── Petits blocs ──────────────────────────────────────────────────────────
function Head({ P, title, right }: { P: HealthPalette; title: string; right?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <h2 style={P.h2}>{title}</h2>
      {right && <span style={{ color: P.muted, fontSize: 12.5 }}>{right}</span>}
    </div>
  );
}

function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: 99, background: color, flex: 'none', display: 'inline-block' }} />;
}

function TrafficLight({ tone, P }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; P: HealthPalette }) {
  const on = (t: 'ok' | 'warn' | 'bad') => tone === t || (tone === 'neutral' && t === 'ok');
  const col = { ok: P.green, warn: P.amber, bad: P.red };
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 18, background: '#16110f', flex: 'none' }} data-theme-island="dark">
      {(['bad', 'warn', 'ok'] as const).map((t) => (
        <span key={t} style={{ width: 18, height: 18, borderRadius: 99, background: col[t], opacity: on(t) && tone !== 'neutral' ? 1 : 0.22,
          boxShadow: on(t) && tone !== 'neutral' ? `0 0 12px ${col[t]}` : 'none' }} />
      ))}
    </div>
  );
}

function LevelSteps({ level, maxShared, P, w }: { level: number; maxShared: number; P: HealthPalette; w: W }) {
  return (
    <div style={{ flex: '0 1 240px', display: 'flex', flexDirection: 'column', gap: 8 }} aria-label={w('v.level', { n: level })}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 52 }}>
        {[1, 2, 3, 4, 5].map((l) => {
          const locked = l > maxShared;
          const on = l <= level;
          return (
            <div key={l} title={w(`lvl.${l}`)} style={{ flex: 1, height: 14 + l * 7, borderRadius: 8, display: 'grid', placeItems: 'center',
              background: on ? P.ink : 'transparent', color: on ? P.onInk : P.muted, fontSize: 11.5, fontWeight: 700,
              boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${P.line}`, borderStyle: locked ? 'dashed' : undefined, opacity: locked ? 0.55 : 1 }}>
              {locked ? <Lock color={P.muted} /> : l}
            </div>
          );
        })}
      </div>
      <span style={{ color: P.ink, fontSize: 13.5, fontWeight: 650 }}>{w('v.level', { n: level })} · {w(`lvl.${level}`)}</span>
      <span style={{ color: P.muted, fontSize: 12 }}>{w('v.levelOf', { n: level, max: maxShared })}</span>
    </div>
  );
}

function Lock({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function RingTile({ P, w, n, label, used, cap, foot }: { P: HealthPalette; w: W; n: (v: number) => string; label: string; used: number; cap: number; foot?: string }) {
  const u = usage(used, cap);
  const col = cap <= 0 ? P.neutral : u.tone === 'bad' ? P.red : u.tone === 'warn' ? P.amber : P.green;
  const R = 34; const C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, background: P.inner }}>
      <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${label} ${n(used)} / ${n(cap)}`} style={{ flex: 'none' }}>
        <circle cx="42" cy="42" r={R} fill="none" stroke={P.line} strokeWidth="9" />
        <circle cx="42" cy="42" r={R} fill="none" stroke={col} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${Math.max(cap > 0 ? 0.02 : 0, u.ratio) * C} ${C}`} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" fontSize="15" fontWeight="700" fill={P.ink} fontFamily={P.display}>{n(used)}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ color: P.sub, fontSize: 13 }}>{label}</span>
        <span style={{ color: P.ink, fontSize: 18, fontWeight: 650, fontFamily: P.display }}>/ {n(cap)}</span>
        <span style={{ color: cap > 0 && u.left === 0 ? P.red : P.muted, fontSize: 12.5 }}>
          {cap <= 0 ? w('v.can.cold.off').split(':').pop()?.trim() : u.left === 0 ? w('v.today.full') : w('v.today.left', { n: n(u.left) })}
        </span>
        {foot && <span style={{ color: P.muted, fontSize: 12 }}>{foot}</span>}
      </div>
    </div>
  );
}

function StateIcon({ state, P }: { state: 'yes' | 'limited' | 'no' | 'soon'; P: HealthPalette }) {
  const bg = state === 'yes' ? P.green : state === 'limited' ? P.blue : state === 'no' ? P.red : P.neutral;
  const glyph = state === 'yes' ? '✓' : state === 'limited' ? '≤' : state === 'no' ? '✕' : '…';
  return (
    <span aria-hidden style={{ width: 24, height: 24, borderRadius: 99, flex: 'none', display: 'grid', placeItems: 'center',
      background: bg, color: '#fff', fontSize: 13, fontWeight: 800 }}>{glyph}</span>
  );
}

function Fold({ P, label, children, plain }: { P: HealthPalette; label: string; children: ReactNode; plain?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={plain ? { ...P.card, gap: 10 } : { display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, color: P.sub, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
        {open ? '▾' : '▸'} {label}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
    </div>
  );
}

function DayChart({ visual, P, w, n, dShort, lang }: { visual: HealthVisual; P: HealthPalette; w: W; n: (v: number) => string; dShort: (iso: string) => string; lang: HealthLang }) {
  const pts = chartPoints(visual.series);
  const maxSent = Math.max(1, ...pts.map((p) => p.sent));
  const maxPct = Math.ceil(Math.max(20, ...pts.flatMap((p) => [p.gmail ?? 0, p.other ?? 0])) * 1.15 / 5) * 5;
  const Wd = 600; const H = 170; const top = 10; const bottom = 22;
  const bw = Wd / pts.length;
  const y = (pct: number) => top + (H - top - bottom) * (1 - pct / maxPct);
  // Les jours sans envoi ne cassent pas la courbe : elle relie les jours mesurés.
  const line = (k: 'gmail' | 'other') => pts
    .map((p, i) => (p[k] == null ? null : `${(i + 0.5) * bw},${y(p[k] as number)}`))
    .filter(Boolean)
    .map((xy, j) => `${j === 0 ? 'M' : 'L'}${xy}`)
    .join(' ');
  if (!pts.some((p) => p.sent > 0)) return <p style={{ margin: 0, color: P.sub, fontSize: 14 }}>{w('v.chart.empty')}</p>;
  const legend: [string, string, 'bar' | 'line'][] = [[w('v.chart.sent'), P.line, 'bar'], [w('v.chart.gmail'), P.red, 'line'], [w('v.chart.other'), P.blue, 'line']];
  const last = pts[pts.length - 1];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {legend.map(([l, c, kind]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: P.sub, fontSize: 12.5 }}>
            <span aria-hidden style={{ width: kind === 'bar' ? 10 : 16, height: kind === 'bar' ? 10 : 3, borderRadius: kind === 'bar' ? 3 : 99, background: c }} />{l}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${Wd} ${H}`} width="100%" role="img" aria-label={w('v.chart.t')} style={{ display: 'block', overflow: 'visible' }}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={Wd} y1={top + (H - top - bottom) * f} y2={top + (H - top - bottom) * f} stroke={P.line} strokeWidth="1" strokeDasharray="3 5" opacity="0.6" />)}
        {pts.map((p, i) => {
          const h = ((H - top - bottom) * p.sent) / maxSent;
          return p.sent > 0 ? (
            <rect key={p.d} x={i * bw + bw * 0.15} y={H - bottom - h} width={bw * 0.7} height={h} rx="2.5" fill={P.line}>
              <title>{`${dShort(p.d)} · ${n(p.sent)}${p.gmail != null ? ` · Gmail ${fmtPct(p.gmail, lang, 0)}` : ''}${p.other != null ? ` · ${fmtPct(p.other, lang, 0)}` : ''}`}</title>
            </rect>
          ) : null;
        })}
        <path d={line('other')} fill="none" stroke={P.blue} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line('gmail')} fill="none" stroke={P.red} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {(['other', 'gmail'] as const).map((k) => pts.map((p, i) => (p[k] == null ? null : (
          <circle key={`${k}-${p.d}`} cx={(i + 0.5) * bw} cy={y(p[k] as number)} r="3.5" fill={k === 'gmail' ? P.red : P.blue} />
        ))))}
        {[0, Math.floor(pts.length / 2), pts.length - 1].map((i) => (
          <text key={i} x={(i + 0.5) * bw} y={H - 4} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'} fontSize="11" fill={P.muted}>{dShort(pts[i].d)}</text>
        ))}
        <text x="2" y={top + 4} fontSize="10.5" fill={P.muted}>{fmtPct(maxPct, lang, 0)}</text>
      </svg>
      {last && (last.gmail != null || last.other != null) && (
        <span style={{ color: P.muted, fontSize: 12.5 }}>{dShort(last.d)} · Gmail {fmtPct(last.gmail, lang, 0)} · {w('v.chart.other')} {fmtPct(last.other, lang, 0)}</span>
      )}
    </div>
  );
}

function SignalTile({ s, P, w, lang, toneColor }: { s: ReturnType<typeof signals>[number]; P: HealthPalette; w: W; lang: HealthLang; toneColor: (t: Tone) => string }) {
  const [a, b, max] = s.zones;
  const pos = s.value == null ? null : Math.min(1, Math.max(0, s.value / max));
  const segs = s.higherIsBetter
    ? [{ to: a, c: P.red }, { to: b, c: P.amber }, { to: max, c: P.green }]
    : [{ to: a, c: P.green }, { to: b, c: P.amber }, { to: max, c: P.red }];
  const fmt = (v: number | null) => (v == null ? '—' : s.key === 'complaints'
    ? v.toLocaleString(lang === 'en' ? 'en-GB' : lang, { maximumFractionDigits: 1 })
    : fmtPct(v, lang, s.key === 'gmail' ? 0 : 1));
  const label = s.key === 'bounce' ? w('v.sig.bounce') : s.key === 'complaints' ? w('v.sig.complaints') : w('v.sig.gmail');
  const zoneWord = s.tone === 'none' ? w('v.zone.none') : w(`v.zone.${s.tone}`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 18, background: P.inner }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: P.sub, fontSize: 13 }}>{label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: toneColor(s.tone), fontSize: 12.5, fontWeight: 650 }}>
          <Dot color={toneColor(s.tone)} size={8} />{zoneWord}
        </span>
      </div>
      <span style={{ color: P.ink, fontSize: 26, fontWeight: 650, fontFamily: P.display, letterSpacing: '-.02em' }}>
        {fmt(s.value)}{s.key === 'complaints' && s.value != null ? <span style={{ fontSize: 13, color: P.muted, fontWeight: 500 }}> {w('v.sig.complaints.u')}</span> : null}
      </span>
      <div style={{ position: 'relative', height: 10 }} aria-hidden>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', borderRadius: 99, overflow: 'hidden', opacity: 0.85 }}>
          {segs.map((g, i) => {
            const from = i === 0 ? 0 : segs[i - 1].to;
            return <div key={i} style={{ width: `${((g.to - from) / max) * 100}%`, background: g.c }} />;
          })}
        </div>
        {pos != null && (
          <div style={{ position: 'absolute', top: -4, left: `calc(${pos * 100}% - 3px)`, width: 6, height: 18, borderRadius: 3, background: P.ink, boxShadow: `0 0 0 2px ${P.inner}` }} />
        )}
      </div>
      <span style={{ color: P.muted, fontSize: 12 }}>
        {s.higherIsBetter ? w('v.sig.min', { v: fmt(s.limit) }) : w('v.sig.limit', { v: fmt(s.limit) })}
      </span>
    </div>
  );
}

function BaseBar({ report, P, w, n, lang }: { report: HealthReport; P: HealthPalette; w: W; n: (v: number) => string; lang: HealthLang }) {
  const b = report.base;
  const recovery = report.rules.gmail_recovery;
  const segs = [
    { k: 'engaged', v: b.engaged, c: P.green, h: w('v.base.engaged.h') },
    { k: 'contacted', v: b.contacted, c: P.blue, h: w('v.base.contacted.h') },
    { k: 'never', v: b.never, c: P.neutral, h: recovery ? `${w('v.base.never.h')} · ${w('v.base.never.hg')}` : w('v.base.never.h') },
  ];
  const total = Math.max(1, b.total);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', height: 18, borderRadius: 99, overflow: 'hidden', background: P.line }} aria-hidden>
        {segs.map((s) => s.v > 0 && <div key={s.k} style={{ width: `${(s.v / total) * 100}%`, background: s.c }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 10 }}>
        {segs.map((s) => (
          <div key={s.k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span aria-hidden style={{ width: 12, height: 12, borderRadius: 4, background: s.c, marginTop: 4, flex: 'none' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: P.ink, fontSize: 15, fontWeight: 650 }}>{n(s.v)} <span style={{ color: P.muted, fontWeight: 500, fontSize: 12.5 }}>{fmtPct((s.v * 100) / total, lang, 0)}</span></span>
              <span style={{ color: P.sub, fontSize: 13 }}>{w(`v.base.${s.k}`)}</span>
              <span style={{ color: P.muted, fontSize: 12 }}>{s.h}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeldBars({ held, P, n }: { held: { key: string; n: number; label: string }[]; P: HealthPalette; n: (v: number) => string }) {
  const max = Math.max(1, ...held.map((h) => h.n));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {held.map((h) => (
        <div key={h.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 4, alignItems: 'center' }}>
          <span style={{ color: P.sub, fontSize: 13 }}>{h.label}</span>
          <span style={{ color: P.ink, fontSize: 13, fontWeight: 650 }}>{n(h.n)}</span>
          <div style={{ gridColumn: '1 / -1', height: 8, borderRadius: 99, background: P.line, overflow: 'hidden' }} aria-hidden>
            <div style={{ width: `${Math.max(2, (h.n / max) * 100)}%`, height: '100%', borderRadius: 99, background: P.ink, opacity: 0.75 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Incidents({ visual, P, w, dShort }: { visual: HealthVisual; P: HealthPalette; w: W; dShort: (iso: string) => string }) {
  const nInc = visual.incidents.length;
  const max = visual.recidive_count;
  return (
    <section style={P.card}>
      <Head P={P} title={w('v.inc.t')} right={w('v.inc.count', { n: nInc, max, d: visual.recidive_window_days })} />
      <div style={{ display: 'flex', gap: 8 }} aria-hidden>
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} style={{ flex: 1, height: 10, borderRadius: 99, background: i < nInc ? (nInc >= max ? P.red : P.amber) : P.line }} />
        ))}
      </div>
      {nInc === 0 ? <p style={{ margin: 0, color: P.sub, fontSize: 13.5 }}>{w('v.inc.none')}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visual.incidents.map((i, k) => (
            <p key={`${i.at}-${k}`} style={{ margin: 0, color: P.ink, fontSize: 13.5 }}>
              <b>{dShort(i.at)}</b> · {w(`v.inc.${i.kind}`)}{i.campaign ? ` · ${i.campaign}` : ''}
            </p>
          ))}
        </div>
      )}
      <p style={{ margin: 0, color: P.muted, fontSize: 12.5 }}>{w('v.inc.s', { max })}</p>
    </section>
  );
}

function CampaignRow({ c, P, w, n, dShort, lang, href, gmailRel }: {
  c: HealthReport['campaigns'][number]; P: HealthPalette; w: W; n: (v: number) => string; dShort: (iso: string) => string;
  lang: HealthLang; href: string; gmailRel: number;
}) {
  const open = c.sent >= 50 ? (c.opened * 100) / c.sent : null;
  const other = c.sent - c.gmail_sent;
  const go = c.gmail_sent >= 30 ? (c.gmail_opened * 100) / c.gmail_sent : null;
  const oo = other >= 30 ? ((c.opened - c.gmail_opened) * 100) / other : null;
  const bad = go != null && oo != null && oo > 0 && go / oo < gmailRel;
  const bar = (v: number | null, color: string) => (
    <div style={{ height: 6, borderRadius: 99, background: P.line, overflow: 'hidden' }} aria-hidden>
      <div style={{ width: `${v == null ? 0 : Math.min(100, v)}%`, height: '100%', background: color }} />
    </div>
  );
  return (
    <Link to={href} style={{ textDecoration: 'none', display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) repeat(2,minmax(0,1fr))', gap: 14, alignItems: 'center', padding: '12px 14px', borderRadius: 16, background: P.inner }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: P.ink, fontSize: 14, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || '—'}</div>
        <div style={{ color: P.muted, fontSize: 12 }}>
          {c.at ? dShort(c.at) : ''} · {n(c.sent)} {w('v.c.sent')}{c.kind === 'info' ? ` · ${w('c.info')}` : ` · ${campaignModeLabel(c, lang)}`}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: P.sub, fontSize: 12 }}>{fmtPct(open, lang, 0)} {w('v.c.opens')}</span>
        {bar(open, P.green)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: bad ? P.red : P.sub, fontSize: 12, fontWeight: bad ? 650 : 400 }}>Gmail {fmtPct(go, lang, 0)} · {fmtPct(oo, lang, 0)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{bar(go, P.red)}{bar(oo, P.blue)}</div>
      </div>
    </Link>
  );
}
