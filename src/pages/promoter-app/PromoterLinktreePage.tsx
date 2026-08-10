import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Star, CalendarRange, Share2 } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import {
  PromoPCard, PromoButton, CopyField,
  T1, T3, BORDER, INNER_BG,
} from '@/components/promoter/promoter-ui';
import { shareContent } from '@/lib/share';

export default function PromoterLinktreePage() {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, scopeName, assignments, setAssignments } = usePromoterData();

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [agendaQrDataUrl, setAgendaQrDataUrl] = useState<string | null>(null);

  const getBaseUrl = () => 'https://yunoapp.eu';
  const promoLink = promoter?.promo_code ? `${getBaseUrl()}/promoteur/${promoter.promo_code}` : null;
  // Agenda complet — page web-only (exclue des universal links) qui liste TOUTES
  // les soirées rattachées ; le linktree, lui, met en avant les prochaines.
  const agendaLink = promoter?.promo_code ? `${getBaseUrl()}/promoteur/${promoter.promo_code}/agenda` : null;

  useEffect(() => {
    if (!promoLink) return;
    QRCode.toDataURL(promoLink, { width: 256, margin: 2 }).then(setQrDataUrl).catch(() => {});
  }, [promoLink]);

  useEffect(() => {
    if (!agendaLink) return;
    QRCode.toDataURL(agendaLink, { width: 256, margin: 2 }).then(setAgendaQrDataUrl).catch(() => {});
  }, [agendaLink]);

  // Épingler/dépingler une soirée sur le linktree — RPC SECURITY DEFINER (le
  // promoteur n'a pas d'UPDATE direct sur promoter_event_assignments).
  const toggleFeatured = async (eventId: string, next: boolean) => {
    const prev = assignments;
    setAssignments(list => list.map(a => a.eventId === eventId ? { ...a, featuredOnLinktree: next } : a));
    const { error } = await (supabase as any).rpc('set_promoter_linktree_featured', {
      p_event_id: eventId,
      p_featured: next,
    });
    if (error) {
      setAssignments(prev);
      toast.error(t('common.error'));
    }
  };

  if (!promoter) return null;

  const share = async (url: string) => {
    const outcome = await shareContent({ title: `${scopeName} — ${promoter.promo_code}`, url });
    if (outcome === 'copied') toast.success(t('promoter.linkCopied'));
  };

  const now = Date.now();
  const upcoming = assignments
    .filter(a => a.eventEndAt && new Date(a.eventEndAt).getTime() >= now)
    .sort((a, b) => new Date(a.eventStartAt).getTime() - new Date(b.eventStartAt).getTime());
  const pinnedCount = upcoming.filter(a => a.featuredOnLinktree).length;
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';

  return (
    <PromoterPage>
      <PromoHeading title={t('promoter.linktreeTab')} subtitle={t('promoter.myLinktreeDesc')} />

      {/* ── Vitrine publique ── */}
      {promoLink && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <PromoPCard accent icon={<ExternalLink className="w-4 h-4" />} title={t('promoter.myLinktree')} sub={t('promoter.myLinktreeDesc')}>
            <div className="space-y-3">
              <CopyField label="Linktree" value={promoLink} onCopy={() => toast.success(t('promoter.linkCopied'))} />
              <div className="flex gap-2">
                <PromoButton variant="secondary" full onClick={() => share(promoLink)}>
                  <Share2 className="h-4 w-4" />
                  {t('promoter.shareLink')}
                </PromoButton>
                <PromoButton variant="ghost" full onClick={() => window.open(promoLink, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink className="h-4 w-4" />
                  {t('promoter.viewPage')}
                </PromoButton>
              </div>
              {qrDataUrl && (
                <div className="flex justify-center pt-1">
                  <img src={qrDataUrl} alt="QR Code Linktree" className="w-40 h-40 rounded-xl" />
                </div>
              )}
            </div>
          </PromoPCard>
        </motion.div>
      )}

      {/* ── Curation — le promoteur choisit ce qui s'affiche ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <PromoPCard icon={<Star className="w-4 h-4" />} title={t('promoter.linktreeCuration')} sub={t('promoter.linktreeCurationDesc')}>
          {upcoming.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: T3 }}>{t('promoterAgenda.empty')}</p>
          ) : (
            <>
              <p className="text-xs mb-3 tabular-nums" style={{ color: T3 }}>
                {pinnedCount > 0
                  ? `${pinnedCount} ${t('promoter.linktreePinnedCount')}`
                  : t('promoter.linktreeAutoMode')}
              </p>
              <div className="space-y-2">
                {upcoming.map((a, i) => (
                  <motion.div
                    key={a.eventId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    className="flex items-center gap-3 rounded-xl px-3.5 py-3"
                    style={a.featuredOnLinktree
                      ? { background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.3)' }
                      : { background: INNER_BG, border: `1px solid ${BORDER}` }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" style={{ color: T1 }}>{a.eventTitle}</p>
                      <p className="text-xs" style={{ color: T3 }}>
                        {a.eventStartAt ? new Date(a.eventStartAt).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
                      </p>
                    </div>
                    <PromoButton
                      size="sm"
                      variant={a.featuredOnLinktree ? 'primary' : 'ghost'}
                      onClick={() => toggleFeatured(a.eventId, !a.featuredOnLinktree)}
                    >
                      <Star className="h-3.5 w-3.5" style={a.featuredOnLinktree ? { fill: 'currentColor' } : undefined} />
                      {a.featuredOnLinktree ? t('promoter.linktreePinned') : t('promoter.linktreePin')}
                    </PromoButton>
                  </motion.div>
                ))}
              </div>
            </>
          )}
        </PromoPCard>
      </motion.div>

      {/* ── Page Agenda — toutes les soirées, web-only ── */}
      {agendaLink && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <PromoPCard icon={<CalendarRange className="w-4 h-4" />} title={t('promoter.agendaPage')} sub={t('promoter.agendaPageDesc')}>
            <div className="space-y-3">
              <CopyField label="Agenda" value={agendaLink} onCopy={() => toast.success(t('promoter.linkCopied'))} />
              <div className="flex gap-2">
                <PromoButton variant="secondary" full onClick={() => share(agendaLink)}>
                  <Share2 className="h-4 w-4" />
                  {t('promoter.shareLink')}
                </PromoButton>
                <PromoButton variant="ghost" full onClick={() => window.open(agendaLink, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink className="h-4 w-4" />
                  {t('promoter.viewPage')}
                </PromoButton>
              </div>
              {agendaQrDataUrl && (
                <div className="flex justify-center pt-1">
                  <img src={agendaQrDataUrl} alt="QR Code Agenda" className="w-40 h-40 rounded-xl" />
                </div>
              )}
            </div>
          </PromoPCard>
        </motion.div>
      )}
    </PromoterPage>
  );
}
