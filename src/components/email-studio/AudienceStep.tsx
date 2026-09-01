import { useEffect, useState } from 'react';
import { Check, Loader2, Lock, Pencil, UserMinus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AudienceKind, AudienceSel } from '@/lib/email';
import { useStudio } from './store';
import { useAudienceCount, useImportedLists, type SavedSegment, type StudioEvent, type StudioScope } from './hooks';
import {
  BORDER, FlowCard, FONT_UI, Help, MicroLabel, NEG, RED, RED_SOFT_GRAD, SegBtns,
  SUBTLE, Switch, T1, T2, T3, inputStyle,
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

interface Projection { openRate: number; clickRate: number; revPerSent: number | null }

/** Écran Audience : segments cumulables + exclusions + portée finale (prototype). */
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
  const [projection, setProjection] = useState<Projection | null>(null);

  const hasAudience = campaign.audiences.length > 0;
  const { count, loading } = useAudienceCount(campaign.id, saveSeq, hasAudience);
  const { lists: imports, rename: renameImport } = useImportedLists(scope);

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

  // Projection : moyennes des 5 dernières campagnes envoyées de CE compte
  // (jamais des moyennes marché) + revenu attribué par email envoyé.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query = supabase.from('email_campaigns')
        .select('id, recipients_count, opens_count, clicks_count')
        .eq('status', 'sent').gt('recipients_count', 0)
        .order('sent_at', { ascending: false }).limit(5);
      query = scope.kind === 'venue'
        ? query.eq('venue_id', scope.venueId)
        : query.eq('organizer_user_id', scope.organizerId);
      const { data: past } = await query;
      if (cancelled || !past || past.length === 0) return;
      const sent = past.reduce((a, c) => a + Number(c.recipients_count || 0), 0);
      const opens = past.reduce((a, c) => a + Number(c.opens_count || 0), 0);
      const clicks = past.reduce((a, c) => a + Number(c.clicks_count || 0), 0);
      let revPerSent: number | null = null;
      try {
        const { data: attr } = await supabase.rpc('get_email_campaign_attribution' as never, {
          p_subject_type: scope.kind === 'venue' ? 'venue' : 'organizer',
          p_subject_id: scope.kind === 'venue' ? scope.venueId : scope.organizerId,
        } as never);
        const payload = attr as unknown as { supported?: boolean; campaigns?: Array<{ id: string; revenue: number }> } | null;
        if (payload?.supported) {
          const ids = new Set(past.map((c) => c.id));
          const rev = (payload.campaigns || []).filter((c) => ids.has(c.id)).reduce((a, c) => a + Number(c.revenue || 0), 0);
          revPerSent = sent > 0 ? rev / sent : null;
        }
      } catch { /* tuiles absentes */ }
      if (!cancelled && sent > 0) {
        setProjection({ openRate: opens / sent, clickRate: clicks / sent, revPerSent });
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  // Une sélection = son kind + la référence qui la distingue (segment
  // sauvegardé ou lot d'import). Deux listes importées sont deux cases.
  const selKey = (a: AudienceSel) => `${a.kind}:${a.segmentId || a.importId || ''}`;

  const isSelected = (kind: AudienceKind, refId?: string) =>
    campaign.audiences.some((a) => selKey(a) === `${kind}:${refId || ''}`);

  const toggleAudience = (kind: AudienceKind, refId?: string) => {
    if (campaign.type === 'informational') {
      setAudiences([{ kind }]);
      return;
    }
    const key = `${kind}:${refId || ''}`;
    if (campaign.audiences.some((a) => selKey(a) === key)) {
      setAudiences(campaign.audiences.filter((a) => selKey(a) !== key));
      return;
    }
    const added: AudienceSel = kind === 'import' ? { kind, importId: refId }
      : kind === 'segment' ? { kind, segmentId: refId }
      : { kind };
    setAudiences([...campaign.audiences, added]);
  };

  const nf = (n: number) => n.toLocaleString('fr-FR');
  const grossSum = campaign.type === 'promotional'
    ? campaign.audiences.reduce((acc, a) => {
      if (a.kind === 'import') return acc + (imports.find((l) => l.id === a.importId)?.count || 0);
      const key = a.kind === 'segment' ? `seg:${a.segmentId}` : a.kind;
      return acc + (perKindCounts[key] || 0);
    }, 0)
    : (count?.gross ?? 0);
  const maxCount = Math.max(1, ...Object.values(perKindCounts), ...imports.map((l) => l.count));
  const net = count?.net ?? 0;
  const dedupAndExcl = Math.max(0, grossSum - (count?.gross ?? grossSum));
  const baseAll = perKindCounts['all_subscribers'] || 0;

  return (
    <div className="yn-in" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Segments ── */}
        <FlowCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
              border: '1px solid rgba(232,25,44,0.2)', color: RED,
            }}><Users size={16} strokeWidth={1.75} /></div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
                {t('studio.aud.segments')}
              </h3>
              <p style={{ margin: '2px 0 0', color: T3, fontSize: 11.5, fontFamily: FONT_UI }}>
                {t('studio.aud.selectedCount').replace('{n}', String(campaign.audiences.length))}
              </p>
            </div>
            <SegBtns
              value={campaign.type}
              onChange={(v) => {
                patchCampaign({ type: v });
                setAudiences(v === 'informational' ? [{ kind: 'event_buyers' }] : []);
              }}
              options={[
                { value: 'promotional', label: t('em.builder.marketing') },
                { value: 'informational', label: t('em.builder.info') },
              ]}
            />
          </div>

          {/* Événement lié */}
          <div style={{ marginBottom: 12 }}>
            <MicroLabel style={{ marginBottom: 7 }}>
              {t('studio.aud.event')}{campaign.type === 'informational' ? ' *' : ''}
            </MicroLabel>
            <select
              value={campaign.eventId || ''}
              onChange={(e) => patchCampaign({ eventId: e.target.value || null })}
              aria-label={t('studio.aud.event')}
              style={{ ...inputStyle, appearance: 'auto' as const }}
            >
              <option value="">{t('studio.aud.eventNone')}</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title} — {new Date(e.start_at).toLocaleDateString()}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(campaign.type === 'promotional' ? PROMO_KINDS : INFO_KINDS).map((k) => {
              const on = isSelected(k.kind);
              const eff = perKindCounts[k.kind];
              return (
                <SegmentRow
                  key={k.kind}
                  on={on}
                  onClick={() => toggleAudience(k.kind)}
                  name={t(k.labelKey)}
                  desc={'descKey' in k ? t((k as { descKey: string }).descKey) : undefined}
                  count={campaign.type === 'promotional' ? eff : undefined}
                  barPct={typeof eff === 'number' ? Math.round((eff / maxCount) * 100) : undefined}
                />
              );
            })}
            {campaign.type === 'promotional' && segments.map((sg) => {
              const eff = perKindCounts[`seg:${sg.id}`];
              return (
                <SegmentRow
                  key={sg.id}
                  on={isSelected('segment', sg.id)}
                  onClick={() => toggleAudience('segment', sg.id)}
                  name={sg.name}
                  desc={sg.description || t('studio.aud.desc.saved')}
                  count={eff}
                  barPct={typeof eff === 'number' ? Math.round((eff / maxCount) * 100) : undefined}
                />
              );
            })}
          </div>

          {/* Listes importées : un fichier = un segment, aux deux portées. */}
          {campaign.type === 'promotional' && imports.length > 0 && (
            <>
              <MicroLabel style={{ margin: '14px 0 7px' }}>{t('studio.aud.imported')}</MicroLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {imports.map((l) => (
                  <ImportRow
                    key={l.id}
                    on={isSelected('import', l.id)}
                    onToggle={() => toggleAudience('import', l.id)}
                    name={l.name}
                    desc={t('studio.aud.desc.imported').replace(
                      '{date}', new Date(l.createdAt).toLocaleDateString())}
                    count={l.count}
                    barPct={Math.round((l.count / maxCount) * 100)}
                    onRename={(v) => renameImport(l.id, v)}
                    t={t}
                  />
                ))}
              </div>
            </>
          )}
          {campaign.type === 'promotional' && !hasAudience && (
            <Help style={{ marginTop: 10, color: RED }}>{t('studio.aud.pickOne')}</Help>
          )}
        </FlowCard>

        {/* ── Exclusions ── */}
        {campaign.type === 'promotional' && (
          <FlowCard>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${BORDER}`, color: T2,
              }}><UserMinus size={16} strokeWidth={1.75} /></div>
              <div>
                <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
                  {t('studio.aud.exclusions')}
                </h3>
                <p style={{ margin: '2px 0 0', color: T3, fontSize: 11.5, fontFamily: FONT_UI }}>
                  {t('studio.aud.exclusionsSub')}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <ExclusionRow
                label={t('studio.aud.exclUnsub')}
                note={t('studio.aud.exclUnsubNote')}
                locked on
                count={count?.suppressed}
              />
              <ExclusionRow
                label={t('studio.aud.exclRecent')}
                note={t('studio.aud.exclRecentHelp')}
                on={campaign.exclusions.recentDays != null}
                onToggle={(v) => setExclusions({ ...campaign.exclusions, recentDays: v ? 7 : null })}
                extra={campaign.exclusions.recentDays != null ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[3, 7, 14, 30].map((d) => (
                      <button
                        key={d} type="button"
                        onClick={(e) => { e.stopPropagation(); setExclusions({ ...campaign.exclusions, recentDays: d }); }}
                        style={{
                          padding: '3px 8px', borderRadius: 7, fontSize: 10.5, fontWeight: 600,
                          fontFamily: FONT_UI, cursor: 'pointer',
                          color: campaign.exclusions.recentDays === d ? T1 : T3,
                          background: campaign.exclusions.recentDays === d ? 'rgba(255,255,255,0.08)' : 'transparent',
                          border: `1px solid ${campaign.exclusions.recentDays === d ? 'rgba(255,255,255,0.16)' : BORDER}`,
                        }}
                      >{d} j</button>
                    ))}
                  </div>
                ) : undefined}
              />
              <ExclusionRow
                label={t('studio.aud.exclBuyers')}
                note={t('studio.aud.exclBuyersHelp')}
                on={!!campaign.exclusions.excludeEventBuyers}
                onToggle={(v) => setExclusions({ ...campaign.exclusions, excludeEventBuyers: v })}
                disabled={!campaign.eventId}
              />
            </div>
          </FlowCard>
        )}
      </div>

      {/* ── Colonne droite : portée + projection ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 0 }}>
        <FlowCard red>
          <MicroLabel style={{ fontSize: 11 }}>{t('studio.aud.netTitle')}</MicroLabel>
          <div style={{
            color: T1, fontSize: 38, fontWeight: 640, letterSpacing: '-0.03em', marginTop: 8,
            fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            {loading ? <Loader2 size={24} className="animate-spin" style={{ color: T3 }} /> : nf(net)}
          </div>
          {baseAll > 0 && (
            <div style={{ color: T3, fontSize: 12, marginTop: 4, fontFamily: FONT_UI }}>
              {t('studio.aud.netPct').replace('{pct}', String(Math.round((net / Math.max(1, baseAll)) * 100)))}
            </div>
          )}
          <div style={{ height: 1, background: BORDER, margin: '16px 0' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <ReachRow label={t('studio.aud.reachRaw')} value={nf(grossSum)} />
            <ReachRow label={t('studio.aud.reachDedup')} value={`−${nf(dedupAndExcl)}`} muted />
            <ReachRow label={t('studio.aud.reachSuppressed')} value={`−${nf(count?.suppressed ?? 0)}`} negative />
          </div>
        </FlowCard>

        <FlowCard>
          <MicroLabel style={{ fontSize: 11, marginBottom: 14 }}>{t('studio.aud.projection')}</MicroLabel>
          {projection ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={{ color: T3, fontSize: 11, fontFamily: FONT_UI }}>{t('studio.aud.projOpens')}</div>
                  <div style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 3, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
                    {nf(Math.round(net * projection.openRate))}
                  </div>
                </div>
                <div>
                  <div style={{ color: T3, fontSize: 11, fontFamily: FONT_UI }}>{t('studio.aud.projClicks')}</div>
                  <div style={{ color: T1, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 3, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
                    {nf(Math.round(net * projection.clickRate))}
                  </div>
                </div>
              </div>
              {projection.revPerSent != null && projection.revPerSent > 0 && (
                <div style={{
                  marginTop: 14, padding: '12px 14px', borderRadius: 12,
                  background: RED_SOFT_GRAD, border: '1px solid rgba(232,25,44,0.22)',
                }}>
                  <div style={{ color: RED, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: FONT_UI }}>
                    {t('studio.aud.projRev')}
                  </div>
                  <div style={{ color: T1, fontSize: 20, fontWeight: 640, marginTop: 4, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
                    ≈ {nf(Math.round(net * projection.revPerSent))} €
                  </div>
                </div>
              )}
              <Help style={{ marginTop: 12 }}>{t('studio.aud.projNote')}</Help>
            </>
          ) : (
            <Help>{t('studio.aud.projEmpty')}</Help>
          )}
        </FlowCard>
      </div>
    </div>
  );
}

function SegmentRow({ on, onClick, name, desc, count, barPct }: {
  on: boolean; onClick: () => void; name: string; desc?: string; count?: number; barPct?: number;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 14,
        cursor: 'pointer', textAlign: 'left', transition: 'all .15s', width: '100%',
        background: on ? RED_SOFT_GRAD : SUBTLE,
        border: `1px solid ${on ? 'rgba(232,25,44,0.28)' : BORDER}`,
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: 6, flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? RED : 'transparent',
        border: `1px solid ${on ? RED : 'rgba(255,255,255,0.2)'}`, color: '#fff',
      }}>
        {on && <Check size={12} strokeWidth={2.5} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: on ? T1 : T2, fontSize: 13.5, fontWeight: 560, fontFamily: FONT_UI }}>{name}</div>
        {desc && <div style={{ color: T3, fontSize: 11.5, marginTop: 2, fontFamily: FONT_UI }}>{desc}</div>}
        {typeof barPct === 'number' && (
          <div style={{ height: 4, borderRadius: 999, marginTop: 8, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${barPct}%`, borderRadius: 999,
              background: on ? 'linear-gradient(90deg,rgba(232,25,44,0.8),rgba(232,25,44,0.3))' : 'rgba(255,255,255,0.22)',
            }} />
          </div>
        )}
      </div>
      {typeof count === 'number' && (
        <div style={{ color: on ? T1 : T2, fontSize: 14, fontWeight: 620, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
          {count.toLocaleString('fr-FR')}
        </div>
      )}
    </button>
  );
}

/**
 * Ligne d'une liste importée : la même carte qu'un segment, plus un crayon.
 * Le nom donné à l'import doit pouvoir se corriger — sinon un pro réimporte
 * son fichier « pour le renommer » et se retrouve avec un segment en double.
 * La carte porte le fond et la bordure ; le bouton de sélection et le crayon
 * sont deux boutons frères à l'intérieur (jamais un bouton dans un bouton).
 */
function ImportRow({ on, onToggle, name, desc, count, barPct, onRename, t }: {
  on: boolean; onToggle: () => void; name: string; desc: string;
  count: number; barPct: number;
  onRename: (value: string) => Promise<boolean>;
  t: (k: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  const open = () => { setDraft(name); setEditing(true); };

  const commit = async () => {
    setSaving(true);
    const ok = await onRename(draft);
    setSaving(false);
    if (!ok) { toast.error(t('studio.aud.renameError')); return; }
    setEditing(false);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '13px 15px', borderRadius: 14,
      transition: 'all .15s', width: '100%',
      background: on ? RED_SOFT_GRAD : SUBTLE,
      border: `1px solid ${on ? 'rgba(232,25,44,0.28)' : BORDER}`,
    }}>
      {editing ? (
        <>
          <input
            autoFocus value={draft} maxLength={60} disabled={saving}
            aria-label={t('studio.aud.rename')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
            style={{ ...inputStyle, flex: 1, height: 34 }}
          />
          <IconBtn label={t('common.save')} onClick={() => void commit()} disabled={saving} accent>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.5} />}
          </IconBtn>
          <IconBtn label={t('common.cancel')} onClick={() => setEditing(false)} disabled={saving}>
            <X size={13} strokeWidth={2.5} />
          </IconBtn>
        </>
      ) : (
        <>
          <button
            type="button" onClick={onToggle} aria-pressed={on}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0,
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{
              width: 18, height: 18, borderRadius: 6, flex: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: on ? RED : 'transparent',
              border: `1px solid ${on ? RED : 'rgba(255,255,255,0.2)'}`, color: '#fff',
            }}>
              {on && <Check size={12} strokeWidth={2.5} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: on ? T1 : T2, fontSize: 13.5, fontWeight: 560, fontFamily: FONT_UI }}>{name}</div>
              <div style={{ color: T3, fontSize: 11.5, marginTop: 2, fontFamily: FONT_UI }}>{desc}</div>
              <div style={{ height: 4, borderRadius: 999, marginTop: 8, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${barPct}%`, borderRadius: 999,
                  background: on ? 'linear-gradient(90deg,rgba(232,25,44,0.8),rgba(232,25,44,0.3))' : 'rgba(255,255,255,0.22)',
                }} />
              </div>
            </div>
            <div style={{ color: on ? T1 : T2, fontSize: 14, fontWeight: 620, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
              {count.toLocaleString('fr-FR')}
            </div>
          </button>
          <IconBtn label={t('studio.aud.rename')} onClick={open}>
            <Pencil size={13} strokeWidth={1.75} />
          </IconBtn>
        </>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, accent, children }: {
  label: string; onClick: () => void; disabled?: boolean; accent?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      style={{
        width: 28, height: 28, borderRadius: 9, flex: 'none', cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: accent ? RED : 'rgba(255,255,255,0.06)',
        border: `1px solid ${accent ? RED : BORDER}`,
        color: accent ? '#fff' : T2, opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function ExclusionRow({ label, note, on, locked, onToggle, count, extra, disabled }: {
  label: string; note: string; on: boolean; locked?: boolean;
  onToggle?: (v: boolean) => void; count?: number; extra?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <div
      role="presentation"
      onClick={() => { if (!locked && !disabled) onToggle?.(!on); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12,
        background: SUBTLE, border: `1px solid ${BORDER}`,
        cursor: locked || disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color: T1, fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI }}>{label}</span>
          {locked && <Lock size={11} strokeWidth={1.75} style={{ color: 'rgba(255,255,255,0.3)' }} />}
        </div>
        <div style={{ color: T3, fontSize: 11, marginTop: 2, fontFamily: FONT_UI }}>{note}</div>
        {extra && <div style={{ marginTop: 7 }}>{extra}</div>}
      </div>
      {typeof count === 'number' && count > 0 && (
        <span style={{ color: T2, fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>−{count.toLocaleString('fr-FR')}</span>
      )}
      <Switch checked={on} onChange={locked || disabled ? undefined : onToggle} disabled={locked || disabled} ariaLabel={label} />
    </div>
  );
}

function ReachRow({ label, value, muted, negative }: { label: string; value: string; muted?: boolean; negative?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: T2, fontSize: 12.5, fontFamily: FONT_UI }}>{label}</span>
      <span style={{
        color: negative ? NEG : muted ? T2 : T1, fontSize: 12.5,
        fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI,
      }}>{value}</span>
    </div>
  );
}
