/**
 * Les fenêtres de l'éditeur de scénario : ajouter une étape, « Avant de
 * publier » (erreurs nœud par nœud, qui entrerait aujourd'hui, estimation par
 * semaine, plafond de Yunits), tester chaque message (gratuit), et le résumé
 * des résultats (témoin, ventes attribuées, sorties).
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CtaButton, Modal, Skel } from '@/crm/ui/kit';
import { YunitFace } from '@/crm/ui/YunitFace';
import { holdoutVerdict } from '@/crm/lib/holdout';
import { useScenarioPreview, type ScnIssue, type ScnReport } from '@/crm/data/scenarios';
import { WARN_CODES, errorText, type T } from './scnText';
import { NodeGlyph, Note, SmallButton } from './scnUi';

function Head({ T, title, sub, onClose }: { T: T; title: string; sub?: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{title}</h2>
        {sub && <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)', marginTop: 3, textWrap: 'pretty' }}>{sub}</div>}
      </div>
      <Hv as="button" type="button" onClick={onClose} aria-label={T.t('yc.scn.close')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
        <Icon name="x" size={16} stroke={2.4} />
      </Hv>
    </div>
  );
}

// ── Ajouter une étape ──────────────────────────────────────────────────────

const STEP_TYPES = ['email', 'sms', 'wait', 'branch', 'split', 'tag', 'notify', 'instagram_dm'] as const;

export function AddStepModal({ T, allowEnd, onPick, onClose }: { T: T; allowEnd: boolean; onPick: (type: string) => void; onClose: () => void }) {
  const { t } = T;
  const types: string[] = [...STEP_TYPES, ...(allowEnd ? ['end'] : [])];
  return (
    <Modal open onClose={onClose} width={520} label={t('yc.scn.add.title')}>
      <div style={{ padding: 'clamp(18px,3vw,26px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Head T={T} title={t('yc.scn.add.title')} sub={t('yc.scn.add.sub')} onClose={onClose} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,210px),1fr))', gap: 8 }}>
          {types.map((type) => {
            const soon = type === 'instagram_dm';
            return (
              <Hv key={type} as="button" type="button" disabled={soon} onClick={() => onPick(type)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', textAlign: 'left', cursor: soon ? 'default' : 'pointer', opacity: soon ? 0.55 : 1 }}
                hover={soon ? undefined : { borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
                <NodeGlyph type={type} size={32} />
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t(`yc.scn.node.${type}`)}{soon ? ` · ${t('yc.scn.soon')}` : ''}</span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t(`yc.scn.node.${type}.d`)}</span>
                </span>
              </Hv>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

// ── Avant de publier ───────────────────────────────────────────────────────

export function PublishModal({
  T, id, live, hasChanges, holdout, balance, nodeLabel, onGoto, onPublish, onClose,
}: {
  T: T; id: string; live: boolean; hasChanges: boolean; holdout: boolean; balance: number;
  nodeLabel: (id: string) => string; onGoto: (node: string | null) => void;
  onPublish: () => Promise<{ ok: boolean; errors?: ScnIssue[] }>; onClose: () => void;
}) {
  const { t, tp, n, n1 } = T;
  const q = useScenarioPreview(id, true);
  const [busy, setBusy] = useState(false);
  const [late, setLate] = useState<ScnIssue[] | null>(null);
  const d = q.data;
  const errs = late ?? d?.errors ?? [];
  const hard = errs.filter((e) => !WARN_CODES.has(e.code));
  const warns = [...(d?.warnings ?? []), ...errs.filter((e) => WARN_CODES.has(e.code))];
  const week = d?.week.estimate ?? null;
  const ceilFr = week !== null && d ? Math.ceil(week * d.cost.max_fr) : null;
  const ceilIntl = week !== null && d ? Math.ceil(week * d.cost.max_intl) : null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await onPublish();
      if (!r.ok) setLate(r.errors ?? []);
    } finally { setBusy(false); }
  };
  const stat = (label: string, value: string, sub?: string, tag?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 14, borderRadius: 16, background: 'var(--sand-50)', minWidth: 0 }}>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--sand-600)', fontWeight: 600 }}>
        {label}
        {tag && <span style={{ marginLeft: 6, height: 18, padding: '0 7px', borderRadius: 99, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{tag}</span>}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{sub}</span>}
    </div>
  );
  return (
    <Modal open onClose={onClose} width={700} label={t('yc.scn.pub.title')}>
      <div style={{ padding: 'clamp(18px,3vw,28px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Head T={T} title={t('yc.scn.pub.title')} sub={t(live ? 'yc.scn.pub.subLive' : 'yc.scn.pub.sub')} onClose={onClose} />
        {!d && !q.isError && <div style={{ display: 'grid', gap: 10 }}><Skel h={60} r={14} /><Skel h={90} r={14} /><Skel h={90} r={14} /></div>}
        {q.isError && <Note tone="error">{t('yc.scn.pub.loadErr')}</Note>}
        {d && (
          <>
            {hard.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{tp('yc.scn.pub.errors', hard.length)}</span>
                {hard.map((e) => (
                  <Note key={`${e.code}:${e.node}:${e.field}`} tone="error"
                    action={e.node ? <SmallButton tone="light" onClick={() => onGoto(e.node)}>{t('yc.scn.pub.see')}</SmallButton> : <SmallButton tone="light" onClick={() => onGoto(null)}>{t('yc.scn.pub.see')}</SmallButton>}>
                    <b>{e.node ? nodeLabel(e.node) : t('yc.scn.flow.start')}</b> · {errorText(T, e)}
                  </Note>
                ))}
              </div>
            )}
            {warns.map((e) => <Note key={`w:${e.code}:${e.node}:${e.field}`} tone="warn"><b>{e.node ? nodeLabel(e.node) : t('yc.scn.flow.start')}</b> · {errorText(T, e)}</Note>)}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,132px),1fr))', gap: 8 }}>
              {stat(t('yc.scn.pub.now'), d.now ? n(d.now.entered) : '—', d.now ? t('yc.scn.pub.nowSub', { c: n(d.now.candidates) }) : t('yc.scn.pub.nowNone'))}
              {stat(t('yc.scn.pub.week'), week === null ? '—' : `≈ ${n1(week)}`, week === null ? t('yc.scn.pub.weekNone') : t(`yc.scn.pub.basis.${d.week.basis ?? 'events'}`), t('yc.scn.estimate'))}
              {stat(t('yc.scn.pub.perPerson'), tp('yc.scn.yunits', d.cost.max_fr, { n: n(d.cost.max_fr) }),
                d.cost.max_sms > 0 ? t('yc.scn.pub.perPersonSms', { e: d.cost.max_emails, s: d.cost.max_sms, seg: d.cost.sms_segments, intl: n(d.cost.max_intl) }) : t('yc.scn.pub.perPersonMail', { e: d.cost.max_emails }))}
              {stat(t('yc.scn.pub.ceiling'), ceilFr === null ? '—' : tp('yc.scn.yunits', ceilFr, { n: n(ceilFr) }),
                ceilFr === null ? t('yc.scn.pub.weekNone') : t('yc.scn.pub.ceilingSub', { intl: n(ceilIntl ?? 0), bal: n(balance) }), t('yc.scn.estimate'))}
            </div>
            {ceilFr !== null && ceilFr > balance && <Note tone="warn">{t('yc.scn.pub.lowBalance')}</Note>}
            {holdout && d.holdout_pct > 0 && <Note tone="info">{t('yc.scn.pub.holdout', { pct: d.holdout_pct })}</Note>}
            <Note tone="info">{t('yc.scn.pub.rules')}</Note>
            {!d.can_publish && <Note tone="warn">{t('yc.scn.pub.cannot')}</Note>}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
              <SmallButton tone="ghost" onClick={onClose}>{t('yc.scn.cancel')}</SmallButton>
              <CtaButton onClick={() => void go()} disabled={busy || hard.length > 0 || !d.can_publish || (live && !hasChanges)} icon="check">
                {t(live ? 'yc.scn.pub.goLive' : 'yc.scn.pub.go')}
              </CtaButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Tester ─────────────────────────────────────────────────────────────────

export type TestState = Record<string, 'sending' | 'ok' | string>;

export function TestModal({
  T, messages, state, onSend, onClose,
}: { T: T; messages: { id: string; type: string; label: string; line: string; ready: boolean }[]; state: TestState; onSend: (id: string) => void; onClose: () => void }) {
  const { t } = T;
  return (
    <Modal open onClose={onClose} width={540} label={t('yc.scn.test.title')}>
      <div style={{ padding: 'clamp(18px,3vw,26px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Head T={T} title={t('yc.scn.test.title')} sub={t('yc.scn.test.sub')} onClose={onClose} />
        {!messages.length && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 0', textAlign: 'center' }}>
            <YunitFace mood="inquiet" size={52} />
            <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.scn.test.none')}</span>
          </div>
        )}
        {messages.map((m) => {
          const s = state[m.id];
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, border: '1px solid var(--sand-200)', minWidth: 0 }}>
              <NodeGlyph type={m.type} size={32} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{m.label}</span>
                <span style={{ fontSize: 12.5, color: s && s !== 'sending' && s !== 'ok' ? 'var(--red-700)' : s === 'ok' ? 'var(--green-700)' : 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s === 'ok' ? t('yc.scn.test.sent') : s && s !== 'sending' ? t(s) : m.line}
                </span>
              </span>
              <SmallButton tone="dark" icon="send" disabled={!m.ready || s === 'sending'} onClick={() => onSend(m.id)}>{t(s === 'sending' ? 'yc.scn.test.sending' : 'yc.scn.test.send')}</SmallButton>
            </div>
          );
        })}
        <Note tone="info">{t('yc.scn.test.note')}</Note>
      </div>
    </Modal>
  );
}

// ── Résultats ──────────────────────────────────────────────────────────────

export function ReportSummary({ T, r, entered, goal }: { T: T; r: ScnReport; entered: number; goal: number }) {
  const { t, tp, n, eur } = T;
  const demo = !!r.holdout.demo;
  const v = demo ? 'demo' : holdoutVerdict(r.holdout);
  const exits = Object.entries(r.exits ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 16, background: 'var(--sand-50)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.scn.rep.title')}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10 }}>
        <Num label={t('yc.scn.rep.entered')} v={n(entered)} />
        <Num label={t('yc.scn.rep.goal')} v={n(goal)} />
        {r.attributed && <Num label={t('yc.scn.rep.purchases')} v={n(r.attributed.purchases)} />}
        {r.attributed && r.attributed.revenue !== null && <Num label={t('yc.scn.rep.revenue')} v={eur(r.attributed.revenue)} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {!demo && (
          <span style={{ fontSize: 13.5, color: 'var(--sand-700)', fontVariantNumeric: 'tabular-nums' }}>
            {tp('yc.hold.res.buyers', r.holdout.contacted.buyers, { b: n(r.holdout.contacted.buyers), n: n(r.holdout.contacted.n), who: t('yc.hold.res.contacted') })}
            {' · '}
            {tp('yc.hold.res.buyers', r.holdout.control.buyers, { b: n(r.holdout.control.buyers), n: n(r.holdout.control.n), who: t('yc.hold.res.control') })}
          </span>
        )}
        <span style={{ fontSize: 13.5, fontWeight: v === 'gain' || v === 'loss' ? 600 : 500, color: v === 'gain' ? 'var(--green-700)' : v === 'loss' ? 'var(--amber-700)' : 'var(--sand-600)' }}>
          {t(`yc.scn.verdict.${v}`, { x: n(Math.round(r.holdout.extra ?? 0)) })}
        </span>
      </div>
      {r.attributed && <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: 1.45 }}>{t('yc.scn.rep.attribNote')}</span>}
      {exits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('yc.scn.rep.exits')}</span>
          {exits.map(([k, c]) => <span key={k} style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{t(`yc.scn.exit.${k}`)} · {n(c)}</span>)}
        </div>
      )}
    </section>
  );
}

function Num({ label, v }: { label: string; v: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
      <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{label}</span>
    </div>
  );
}
