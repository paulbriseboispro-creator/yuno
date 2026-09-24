/**
 * « Qui recevra tes notifications ? » — les abonnés de la page (club ou
 * organisateur), la part joignable par push, et les deux gestes qui en
 * ramènent : partager le lien de la page, afficher son QR à la porte.
 * Chiffres de `get_push_campaigns.followers`.
 */
import { useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, QrCode, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { MetricHint } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { ReportCard } from '@/components/event-report/ui';
import { INNER_BG } from '@/components/event-report/tokens';
import { deliverDocument } from '@/lib/generateDocuments';
import { reachableShare, type PushCampaignsPage } from '@/lib/pushHistory';

interface Props {
  followers: PushCampaignsPage['followers'];
  /** URL publique absolue de la page à suivre ; sans elle, pas de gestes. */
  pageUrl: string | null;
  fileSlug: string;
}

export default function FollowersNudge({ followers, pageUrl, fileSlug }: Props) {
  const { t } = useLanguage();
  const { n, locale } = useNumberFormat();
  const [copied, setCopied] = useState(false);
  const share = reachableShare(followers);

  const copy = async () => {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('ph.copyError'));
    }
  };

  const qr = async () => {
    if (!pageUrl) return;
    try {
      const dataUrl = await QRCode.toDataURL(pageUrl, { width: 1024, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
      const blob = await (await fetch(dataUrl)).blob();
      const outcome = await deliverDocument(blob, `qr-${fileSlug}.png`, t('ph.qrTitle'));
      if (outcome === 'failed') toast.error(t('ph.qrError'));
    } catch {
      toast.error(t('ph.qrError'));
    }
  };

  return (
    <ReportCard padding={18}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
            <Users className="h-4 w-4" style={{ color: KIT.T2 }} />
          </div>
          <div className="min-w-0">
            <p style={{ color: KIT.T1, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('ph.fol.title')}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums" style={{ color: KIT.T2, fontSize: 13 }}>
              <span>
                <strong style={{ color: KIT.T1, fontSize: 18, fontWeight: 640 }}>{n(followers.total)}</strong>{' '}
                {followers.total === 1 ? t('ph.fol.followersOne') : t('ph.fol.followers')}
              </span>
              <span className="inline-flex items-center gap-1">
                <strong style={{ color: KIT.T1, fontWeight: 600 }}>{n(followers.reachable)}</strong>{' '}
                {t('ph.fol.reachable')}{share != null && ` (${pctFmt(share, locale)})`}
                <MetricHint text={t('ph.fol.reachableHint')} label={t('ph.fol.reachable')} />
              </span>
              {followers.new30d > 0 && (
                <span style={{ color: KIT.POS }}>{t('ph.fol.new30d').replace('{n}', n(followers.new30d))}</span>
              )}
            </p>
            <p style={{ color: KIT.T3, fontSize: 12, marginTop: 6, lineHeight: 1.5, maxWidth: '70ch' }}>
              {followers.total === 0 ? t('ph.fol.emptyHint') : t('ph.fol.hint')}
            </p>
          </div>
        </div>
        {pageUrl && (
          <div className="flex flex-none flex-wrap gap-2">
            <ActionBtn onClick={copy} icon={copied ? <Check className="h-3.5 w-3.5" style={{ color: KIT.POS }} /> : <Copy className="h-3.5 w-3.5" />}>
              {copied ? t('ph.fol.copied') : t('ph.fol.copy')}
            </ActionBtn>
            <ActionBtn onClick={qr} icon={<QrCode className="h-3.5 w-3.5" />}>{t('ph.fol.qr')}</ActionBtn>
          </div>
        )}
      </div>
    </ReportCard>
  );
}

function ActionBtn({ children, icon, onClick }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium transition-colors"
      style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}
    >
      {icon}
      {children}
    </button>
  );
}
