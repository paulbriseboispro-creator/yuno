import { useEffect, useState } from 'react';
import { Check, Loader2, Lock, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AudienceKind } from '@/lib/email';
import { useStudio } from './store';
import { useAudienceCount, type SavedSegment, type StudioEvent, type StudioScope } from './hooks';
import {
  BORDER, Field, FONT_UI, Help, MicroLabel, RED, SegBtns, SUBTLE, T1, T2, T3, Toggle,
} from './ui';

const PROMO_KINDS: { kind: AudienceKind; labelKey: string; descKey: string }[] = [
  { kind: 'all_subscribers', labelKey: 'em.seg.all_subscribers', descKey: 'studio.aud.desc.all' },
  { kind: 'event_subscribers', labelKey: 'em.seg.event_subscribers', descKey: 'studio.aud.desc.eventSubs' },
  { kind: 'vip', labelKey: 'em.seg.vip', descKey: 'studio.aud.desc.vip' },
  { kind: 'big_spenders', labelKey: 'em.seg.big_spenders', descKey: 'studio.aud.desc.big' },
  { kind: 'regulars', labelKey: 'em.seg.regulars', descKey: 'studio.aud.desc.regulars' },
  { kind: 'new_customers', labelKey: 'em.seg.new_customers', descKey: 'studio.aud.desc.new' },
  { kind: 'dormant', labelKey: 'em.seg.dormant', descKey: 'studio.aud.desc.dormant' },
];

const INFO_KINDS: { kind: AudienceKind; labelKey: string }[] = [
  { kind: 'event_buyers', labelKey: 'em.seg.event_buyers' },
  { kind: 'event_table_buyers', labelKey: 'em.seg.event_table_buyers' },
  { kind: 'event_all_buyers', labelKey: 'em.seg.event_all_buyers' },
];

/** Écran Audience : segments multiples + exclusions + net réel. */
export default function AudienceStep({ scope, events, segments }: {
  scope: StudioScope; events: StudioEvent[]; segments: SavedSegment[];
}) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const saveSeq = useStudio((s) => s.saveSeq);
  const patchCampaign = useStudio((s) => s.patchCampaign);
  const setAudiences = useStudio((s) => s.setAudiences);
  const setExclusions = useStudio((s) => s.setExclusions);

  const [perKindCounts, setPerKindCounts] = useState<Record<string, number>>({});

  const hasAudience = campaign.audiences.length > 0;
  const { count, loading } = useAudienceCount(campaign.id, saveSeq, hasAudience);

  // Effectifs par segment (clubs uniquement — la RPC v1 est venue-scopée).
  useEffect(() => {
    if (scope.kind !== 'venue' || campaign.type !== 'promotional') return;
    let cancelled = false;
    (async () => {
      const out: Record<string, number> = {};
      const targets: { key: string; kind: string; segmentId?: string }[] = [
        ...PROMO_KINDS.map((k) => ({ key: k.kind, kind: k.kind })),
        ...segments.map((sg) => ({ key: `seg:${sg.id}`, kind: 'custom_segment', segmentId: sg.id })),
      ];
      await Promise.all(targets.map(async (target) => {
        if (target.kind === 'event_subscribers' && !campaign.eventId) { out[target.key] = 0; return; }
        const { data } = await supabase.rpc('count_campaign_recipients' as never, {
          p_venue_id: scope.venueId,
          p_type: 'promotional',
          p_audience_type: target.kind,
          p_event_id: campaign.eventId,
          p_segment_id: target.segmentId || null,
        } as never);
        out[target.key] = Number(data || 0);
      }));
      if (!cancelled) setPerKindCounts(out);
    })();
    return () => { cancelled = true; };
  }, [scope, campaign.type, campaign.eventId, segments, saveSeq]);

  const isSelected = (kind: AudienceKind, segmentId?: string) =>
    campaign.audiences.some((a) => a.kind === kind && (kind !== 'segment' || a.segmentId === segmentId));

  const toggleAudience = (kind: AudienceKind, segmentId?: string) => {
    if (campaign.type === 'informational') {
      setAudiences([{ kind }]);
      return;
    }
    const selected = isSelected(kind, segmentId);
    setAudiences(selected
      ? campaign.audiences.filter((a) => !(a.kind === kind && (kind !== 'segment' || a.segmentId === segmentId)))
      : [...campaign.audiences, segmentId ? { kind, segmentId } : { kind }]);
  };

  const needsEvent = campaign.type === 'informational'
    || campaign.audiences.some((a) => a.kind === 'event_subscribers')
    || campaign.exclusions.excludeEventBuyers;

  return (
    <div className="yn-in" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Type d'email */}
        <section style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
          <MicroLabel style={{ marginBottom: 8 }}>{t('studio.aud.type')}</MicroLabel>
          <SegBtns
            value={campaign.type}
            onChange={(v) => {
              patchCampaign({ type: v });
              setAudiences(v === 'informational' ? [{ kind: 'event_buyers' }] : []);
            }}
            options={[
              { value: 'informational', label: t('em.builder.info') },
              { value: 'promotional', label: t('em.builder.marketing') },
            ]}
          />
          <Help style={{ marginTop: 8 }}>
            {campaign.type === 'informational' ? t('em.builder.infoHelp') : t('em.builder.marketingHelp')}
          </Help>
        </section>

        {/* Événement lié */}
        <section style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
          <Field label={`${t('studio.aud.event')}${needsEvent ? ' *' : ''}`}>
            <select
              value={campaign.eventId || ''}
              onChange={(e) => patchCampaign({ eventId: e.target.value || null })}
              aria-label={t('studio.aud.event')}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`,
                borderRadius: 7, color: T1, fontSize: 12.5, fontFamily: FONT_UI, padding: '8px 8px', outline: 'none',
              }}
            >
              <option value="">{t('studio.aud.eventNone')}</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title} — {new Date(e.start_at).toLocaleDateString()}</option>
              ))}
            </select>
          </Field>
          <Help style={{ marginTop: 6 }}>{t('studio.aud.eventHelp')}</Help>
        </section>

        {/* Segments */}
        <section style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
          <MicroLabel style={{ marginBottom: 10 }}>
            {campaign.type === 'promotional' ? t('studio.aud.segments') : t('studio.aud.audience')}
          </MicroLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(campaign.type === 'promotional' ? PROMO_KINDS : INFO_KINDS).map((k) => {
              const selected = isSelected(k.kind);
              const eff = perKindCounts[k.kind];
              return (
                <SegmentCard
                  key={k.kind}
                  selected={selected}
                  onClick={() => toggleAudience(k.kind)}
                  title={t(k.labelKey)}
                  description={'descKey' in k ? t((k as { descKey: string }).descKey) : undefined}
                  effectif={campaign.type === 'promotional' ? eff : undefined}
                />
              );
            })}
            {campaign.type === 'promotional' && segments.map((sg) => (
              <SegmentCard
                key={sg.id}
                selected={isSelected('segment', sg.id)}
                onClick={() => toggleAudience('segment', sg.id)}
                title={sg.name}
                description={sg.description || t('studio.aud.desc.saved')}
                effectif={perKindCounts[`seg:${sg.id}`]}
              />
            ))}
          </div>
          {campaign.type === 'promotional' && !hasAudience && (
            <Help style={{ marginTop: 10, color: RED }}>{t('studio.aud.pickOne')}</Help>
          )}
        </section>

        {/* Exclusions */}
        {campaign.type === 'promotional' && (
          <section style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <MicroLabel>{t('studio.aud.exclusions')}</MicroLabel>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Lock size={14} strokeWidth={1.75} style={{ color: T3, marginTop: 2, flex: 'none' }} />
              <div>
                <div style={{ fontSize: 12.5, color: T1, fontWeight: 600, fontFamily: FONT_UI }}>{t('studio.aud.exclBounces')}</div>
                <div style={{ fontSize: 11.5, color: T3, fontFamily: FONT_UI, lineHeight: 1.45 }}>{t('studio.aud.exclBouncesHelp')}</div>
              </div>
            </div>
            <Toggle
              checked={campaign.exclusions.recentDays != null}
              onChange={(v) => setExclusions({ ...campaign.exclusions, recentDays: v ? 7 : null })}
              label={t('studio.aud.exclRecent')}
              help={t('studio.aud.exclRecentHelp')}
            />
            {campaign.exclusions.recentDays != null && (
              <SegBtns
                value={String(campaign.exclusions.recentDays)}
                onChange={(v) => setExclusions({ ...campaign.exclusions, recentDays: Number(v) })}
                options={[3, 7, 14, 30].map((d) => ({ value: String(d), label: `${d} j` }))}
              />
            )}
            <Toggle
              checked={!!campaign.exclusions.excludeEventBuyers}
              onChange={(v) => setExclusions({ ...campaign.exclusions, excludeEventBuyers: v })}
              label={t('studio.aud.exclBuyers')}
              help={t('studio.aud.exclBuyersHelp')}
            />
          </section>
        )}
      </div>

      {/* Net réel */}
      <aside style={{
        position: 'sticky', top: 16, background: SUBTLE, border: `1px solid ${BORDER}`,
        borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={15} strokeWidth={1.75} style={{ color: T3 }} />
          <MicroLabel>{t('studio.aud.netTitle')}</MicroLabel>
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, color: T1, fontFamily: FONT_UI, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          {loading ? <Loader2 size={22} className="animate-spin" style={{ color: T3 }} /> : (count?.net ?? '—')}
        </div>
        {count && (
          <div style={{ fontSize: 11.5, color: T3, fontFamily: FONT_UI, lineHeight: 1.6 }}>
            {t('studio.aud.netDetail')
              .replace('{gross}', String(count.gross))
              .replace('{suppressed}', String(count.suppressed))}
          </div>
        )}
        <Help>{t('studio.aud.netHelp')}</Help>
      </aside>
    </div>
  );
}

function SegmentCard({ selected, onClick, title, description, effectif }: {
  selected: boolean; onClick: () => void; title: string; description?: string; effectif?: number;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left',
        background: selected ? 'rgba(232,25,44,0.08)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${selected ? 'rgba(232,25,44,0.45)' : BORDER}`,
        borderRadius: 10, padding: '10px 12px', cursor: 'pointer', transition: 'all .12s',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T1, fontFamily: FONT_UI }}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {typeof effectif === 'number' && (
            <span style={{ fontSize: 11, color: T3, fontFamily: FONT_UI, fontVariantNumeric: 'tabular-nums' }}>{effectif}</span>
          )}
          {selected && <Check size={13} strokeWidth={2.25} style={{ color: RED }} />}
        </span>
      </span>
      {description && (
        <span style={{ fontSize: 11, color: T2, fontFamily: FONT_UI, lineHeight: 1.45 }}>{description}</span>
      )}
    </button>
  );
}
