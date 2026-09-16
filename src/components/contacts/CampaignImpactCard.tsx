// « Effet sur votre base » — ce qu'une campagne a fait à la liste.
//
// Une campagne n'est pas qu'un taux d'ouverture : elle apprend à la base qui
// ouvre, qui clique, qui part, qui n'existe plus, et elle déplace des gens
// entre les segments. Cette carte le dit en trois lignes : ce que la campagne
// a mesuré, où en sont ses destinataires aujourd'hui (barre de statuts), et
// ce que ça a changé dans les segments (« +3 dans Meilleurs clients »).
//
// Deux entrées : un bilan déjà chargé (vue d'ensemble de la base) ou un id de
// campagne (rapport de campagne, la RPC recalcule la photo si elle a plus de
// 10 minutes). Les statuts et les écarts viennent du serveur ; ici on affiche.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  ENGAGEMENT_STATUSES, STATUS_COLOR, fill, fmtDate, fmtN, impactFromRpc,
  type CampaignImpact, type EngagementCounts, type EngagementStatus,
} from '@/lib/contactBase';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const RED = '#E8192C';
const POS = '#34D399';
const NEG = '#FF5C63';

/** Barre empilée des statuts (destinataires d'une campagne, ou base entière). */
export function StatusBar({ counts, height = 8, onPick, active }: {
  counts: EngagementCounts | null | undefined; height?: number;
  onPick?: (s: EngagementStatus) => void; active?: EngagementStatus | null;
}) {
  const { t } = useLanguage();
  if (!counts) return null;
  const total = ENGAGEMENT_STATUSES.reduce((a, s) => a + Number(counts[s] || 0), 0);
  if (total <= 0) return null;
  return (
    <div style={{ display: 'flex', height, borderRadius: 999, overflow: 'hidden', background: INNER_BG }}>
      {ENGAGEMENT_STATUSES.map((s) => {
        const n = Number(counts[s] || 0);
        if (n <= 0) return null;
        return (
          <div
            key={s}
            title={`${t(`cbase.status.${s}`)} · ${n.toLocaleString()}`}
            onClick={onPick ? () => onPick(s) : undefined}
            style={{
              width: `${(n / total) * 100}%`, background: STATUS_COLOR[s],
              opacity: active && active !== s ? 0.35 : 1, cursor: onPick ? 'pointer' : 'default',
              transition: 'opacity .15s',
            }}
          />
        );
      })}
    </div>
  );
}

export function StatusLegend({ counts, onPick, active, compact }: {
  counts: EngagementCounts | null | undefined; onPick?: (s: EngagementStatus | null) => void; active?: EngagementStatus | null; compact?: boolean;
}) {
  const { t, language } = useLanguage();
  if (!counts) return null;
  return (
    <div className="flex flex-wrap" style={{ gap: compact ? 8 : 10 }}>
      {ENGAGEMENT_STATUSES.map((s) => {
        const n = Number(counts[s] || 0);
        if (n <= 0 && compact) return null;
        const on = active === s;
        return (
          <button
            key={s} type="button"
            onClick={onPick ? () => onPick(on ? null : s) : undefined}
            className="inline-flex items-center gap-1.5"
            style={{
              padding: compact ? '2px 0' : '4px 9px', borderRadius: 999, fontSize: compact ? 11 : 11.5,
              background: on ? 'rgba(255,255,255,0.08)' : compact ? 'transparent' : INNER_BG,
              border: compact ? 'none' : `1px solid ${on ? 'rgba(255,255,255,0.22)' : BORDER}`,
              color: on ? T1 : T2, cursor: onPick ? 'pointer' : 'default',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[s], flex: 'none' }} />
            <span style={{ fontWeight: 600, color: T1, fontVariantNumeric: 'tabular-nums' }}>{fmtN(n, language)}</span>
            <span>{t(`cbase.status.${s}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function CampaignImpactCard({ impact: given, campaignId, basePath, compact }: {
  impact?: CampaignImpact | null;
  campaignId?: string;
  /** Racine des campagnes de la portée : le lien « Voir la base » mène à `${basePath}/contacts`. */
  basePath: string;
  compact?: boolean;
}) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [fetched, setFetched] = useState<CampaignImpact | null>(null);
  const [loading, setLoading] = useState(!given && !!campaignId);

  useEffect(() => {
    if (given || !campaignId) return;
    let cancelled = false;
    setLoading(true);
    supabase.rpc('get_campaign_list_impact' as never, { p_campaign_id: campaignId } as never)
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as unknown as Parameters<typeof impactFromRpc>[0] | null;
        setFetched(row && row.campaign ? impactFromRpc(row) : null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [given, campaignId]);

  const impact = given || fetched;
  if (loading) {
    return (
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '14px 16px' }}>
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }
  if (!impact) return null;

  const cur = impact.current;
  const rec = cur?.recipients || null;
  const moved = impact.deltas.filter((d) => d.delta !== 0).slice(0, compact ? 3 : 6);
  const hasBaseline = !!impact.baseline?.segments && impact.baseline.segments.length > 0;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: compact ? '12px 14px' : '14px 16px' }}>
      <div className="flex items-start gap-2.5">
        <div style={{ width: 28, height: 28, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', color: RED, flex: 'none' }}>
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: T1, fontSize: compact ? 13 : 14, fontWeight: 600 }}>
            {compact ? impact.name : t('cimpact.title')}
          </div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
            {compact ? fmtDate(impact.sentAt, language) : `${impact.name} · ${fmtDate(impact.sentAt, language)}`}
            {' · '}{fill(t('cimpact.sentTo'), { n: fmtN(impact.recipients, language) })}
          </div>
        </div>
        {!compact && (
          <button
            type="button" onClick={() => navigate(`${basePath}/contacts`)} className="cursor-pointer hidden sm:inline-flex items-center gap-1"
            style={{ background: 'none', border: 'none', padding: 0, color: RED, fontSize: 11.5, fontWeight: 600, flex: 'none' }}
          >
            {t('cimpact.seeBase')} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Ce que la campagne a mesuré */}
      <div className="mt-3 flex flex-wrap" style={{ gap: 6 }}>
        <Chip label={t('cimpact.opened')} n={impact.opens} language={language} />
        <Chip label={t('cimpact.clicked')} n={impact.clickers} language={language} />
        <Chip label={t('cimpact.unsubscribed')} n={impact.unsubscribes} language={language} tone={impact.unsubscribes > 0 ? NEG : undefined} />
        <Chip label={t('cimpact.bounced')} n={impact.bounced} language={language} tone={impact.bounced > 0 ? '#FB923C' : undefined} />
        {typeof cur?.newly_engaged === 'number' && (
          <Chip label={t('cimpact.newlyEngaged')} n={cur.newly_engaged} language={language} tone={cur.newly_engaged > 0 ? POS : undefined} />
        )}
        {typeof cur?.reactivated === 'number' && cur.reactivated > 0 && (
          <Chip label={t('cimpact.reactivated')} n={cur.reactivated} language={language} tone={POS} />
        )}
      </div>

      {/* Où en sont ses destinataires aujourd'hui */}
      {rec && (
        <div className="mt-3">
          <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
            {t('cimpact.recipientsNow')}
          </div>
          <StatusBar counts={rec} height={7} />
          <div className="mt-2"><StatusLegend counts={rec} compact /></div>
        </div>
      )}

      {/* Ce que ça a changé dans les segments */}
      <div className="mt-3">
        <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
          {t('cimpact.segments')}
        </div>
        {!hasBaseline ? (
          <div style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('cimpact.noBaseline')}</div>
        ) : moved.length === 0 ? (
          <div style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('cimpact.noMove')}</div>
        ) : (
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            {moved.map((d) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1.5"
                style={{
                  padding: '4px 9px', borderRadius: 999, fontSize: 11.5, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2,
                }}
              >
                <span style={{ fontWeight: 700, color: d.delta > 0 ? POS : NEG, fontVariantNumeric: 'tabular-nums' }}>
                  {d.delta > 0 ? '+' : '−'}{fmtN(Math.abs(d.delta), language)}
                </span>
                <span style={{ color: T1 }}>{d.name}</span>
                <span style={{ color: T3 }}>· {fmtN(d.after, language)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, n, language, tone }: { label: string; n: number; language: string; tone?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ padding: '4px 9px', borderRadius: 999, fontSize: 11.5, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
    >
      <span style={{ fontWeight: 700, color: tone || T1, fontVariantNumeric: 'tabular-nums' }}>{fmtN(n, language)}</span>
      {label}
    </span>
  );
}
