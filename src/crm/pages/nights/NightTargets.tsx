/**
 * Tiroir d'une soirée à venir › « Qui cibler » (RPC crm_night_targets,
 * migration 20261011110000). Les audiences de personnes SANS place, chacune
 * avec sa taille, ses joignables, le statut de la famille d'hypothèses qui la
 * porte, le moment et l'angle conseillés. « Leur écrire » ouvre WriteModal sur
 * le filtre `ntgt` (même porte serveur que les chiffres), la soirée reliée.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, PillButton, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { WriteModal } from '@/crm/components/WriteModal';
import { HoldoutResults } from '@/crm/components/HoldoutResults';
import { StatusBadge } from '@/crm/components/analysis/HypBits';
import { familyKind } from '@/crm/lib/analysis';
import type { AnFamily } from '@/crm/lib/analysis';
import { useNightTargets } from '@/crm/data/analysis';
import type { NightTargetAudience, NightTargets as Targets } from '@/crm/data/analysis';
import { useSaveSegment } from '@/crm/data/clients';
import { joinHostNames } from '@/lib/coorg';
import type { ClientFilterDef } from '@/crm/data/clients';

type T = ReturnType<typeof useCrmT>;

const genreName = (g: string) => {
  const s = g.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function NightTargets({ eventId }: { eventId: string }) {
  const T = useCrmT();
  const q = useNightTargets(eventId);
  const d = q.data;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
        : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={28} w={240} /><Skel h={120} r={16} /><Skel h={120} r={16} /></div>
          : !d.ok ? <Note text={T.t(d.error === 'not_upcoming' ? 'yc.tgt.notUpcoming' : 'yc.ni.dr.notFound')} />
            : <Body d={d} T={T} />}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{text}</span>;
}

function Body({ d, T }: { d: Targets; T: T }) {
  const { t, n } = T;
  const auds = (d.audiences ?? []).filter((a) => a.n > 0);
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,3vw,28px)', lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('yc.tgt.title')}</h2>
        <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.tgt.sub')}</span>
      </div>
      {!d.computed ? <Note text={t('yc.tgt.notComputed')} />
        : auds.length === 0 ? <Note text={t('yc.tgt.empty')} />
          : (
            <>
              {d.union && (
                <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('yc.tgt.union', { n: n(d.union.n), e: n(d.union.email), s: n(d.union.sms) })}</span>
                  {d.score?.status === 'ok' && d.score.expected !== undefined && (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t('yc.sc.expAll', { n: n(d.score.expected), p: n(d.score.people ?? 0) })}</span>
                  )}
                  {d.score?.projection && (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {t('yc.sc.proj', { n: n(d.score.projection.total), lo: n(d.score.projection.low), hi: n(d.score.projection.high) })}
                    </span>
                  )}
                  {(d.score?.status === 'weak' || d.score?.status === 'insufficient') && (
                    <span style={{ color: 'var(--sand-600)' }}>{t(`yc.sc.st.${d.score.status}`)}</span>
                  )}
                  {(d.has_ticket ?? 0) > 0 && <span style={{ color: 'var(--sand-600)' }}>{t('yc.tgt.hasTicket', { n: n(d.has_ticket ?? 0) })}</span>}
                </div>
              )}
              {auds.length > 1 && auds.some((a) => a.order) && <Note text={t('yc.tgt.orderHint')} />}
              {auds.map((a) => <AudienceCard key={a.key} a={a} d={d} T={T} />)}
            </>
          )}
      {d.event?.id && <HoldoutResults eventId={d.event.id} />}
    </>
  );
}

/** « 1er envoi », « 2e envoi »… (ordre conseillé, décision de Paul du 08/10). */
function orderLabel(k: number, T: T): string {
  return k <= 3 ? T.t(`yc.tgt.order.${k}`) : T.t('yc.tgt.order.n', { n: T.n(k) });
}

function ruleText(a: NightTargetAudience, T: T): string {
  const p = a.params ?? {};
  if (a.key === 'concept') return T.t('yc.tgt.aud.concept.rule', { s: p.series ?? '', e: T.n(p.editions ?? 0) });
  if (a.key === 'lineup') {
    const names = (p.artists ?? []).slice(0, 3).map((x) => x.name);
    return names.length
      ? T.t('yc.tgt.aud.lineup.rule', { a: joinHostNames(names, T.locale) })
      : T.t('yc.tgt.aud.lineup.ruleNone');
  }
  if (a.key === 'genre') return T.t('yc.tgt.aud.genre.rule', { g: (p.genres ?? []).map(genreName).join(', ') });
  return T.t(`yc.tgt.aud.${a.key}.rule`);
}

function AudienceCard({ a, d, T }: { a: NightTargetAudience; d: Targets; T: T }) {
  const { t, tp, n, dShort, time } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const save = useSaveSegment();
  const [writing, setWriting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const eventId = d.event?.id ?? '';
  const def: ClientFilterDef = { seg: 'all', f: { ntgt: { e: eventId, a: a.key } } };
  const name = t(`yc.tgt.aud.${a.key}.name`);
  const when = a.moment === 'now' ? t('yc.tgt.when.now') : t(`yc.tgt.when.${a.moment}`, { d: `${dShort(a.send_at)} · ${time(a.send_at)}` });
  const fam = a.family as AnFamily | undefined;

  const saveSegment = () => {
    const series = d.event?.series ?? d.event?.title ?? '';
    save.mutate(
      { name: t('yc.tgt.segName', { s: series }), definition: def, template: `concept_no_ticket:${eventId}` },
      {
        onSuccess: (r) => { setSavedId(r.id); toast(t('yc.tgt.saved')); },
        onError: () => toast(t('yc.set.err.failed')),
      },
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 20, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {a.order !== undefined && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sand-500)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{orderLabel(a.order, T)}</span>}
          <span style={{ fontSize: 16, fontWeight: 600 }}>{name}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
            {tp('yc.tgt.people', a.n, { n: n(a.n) })}
            {(a.order ?? 1) > 1 && a.new_n !== undefined && a.new_n < a.n && (
              <span style={{ fontFamily: 'var(--font-body, inherit)', fontSize: 14, fontWeight: 500, letterSpacing: 0, color: 'var(--sand-600)' }}> {tp('yc.tgt.newOf', a.new_n, { n: n(a.new_n) })}</span>
            )}
          </span>
          {a.expected !== null && a.expected !== undefined && (
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--red-700)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.sc.exp', { n: n(a.expected) })}</span>
          )}
          {a.overlap && (
            <span style={{ fontSize: 13.5, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
              {t('yc.tgt.overlap', { p: n(a.overlap.pct), a: t(`yc.tgt.aud.${a.overlap.key}.name`) })}
            </span>
          )}
        </div>
        {fam
          ? <StatusBadge f={{ status: a.status ?? null, availability: a.availability ?? null, kind: familyKind(fam) }} T={T} />
          : a.key === 'likely'
            ? <Badge tone="warn">{t('yc.sc.estimate')}</Badge>
            : <span style={{ fontSize: 12.5, color: 'var(--sand-500)', maxWidth: 220, textAlign: 'right' }}>{t('yc.tgt.noFamily')}</span>}
      </div>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>{ruleText(a, T)}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13.5, color: 'var(--sand-600)' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t('yc.tgt.reach', { e: n(a.email), s: n(a.sms) })}</span>
        <span>{when}</span>
        <span>{t(`yc.tgt.angle.${a.key}`)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
        <PillButton tone="dark" onClick={() => setWriting(true)} disabled={!caps.write}>{t('yc.tgt.write')}</PillButton>
        {a.key === 'concept' && !savedId && caps.write && (
          <PillButton tone="ghost" onClick={saveSegment} disabled={save.isPending}>{t('yc.tgt.save')}</PillButton>
        )}
        {savedId && (
          <Link to={`${CRM_ROUTES.clients}?seg=${savedId}`} style={{ alignSelf: 'center', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t('yc.tgt.see')}</Link>
        )}
      </div>
      <WriteModal
        open={writing}
        onClose={() => setWriting(false)}
        scope="filtered"
        who={name}
        def={def}
        eventId={eventId}
        eyebrow={t('yc.tgt.eyebrow', { t: d.event?.title ?? '' })}
      />
    </div>
  );
}
