/**
 * Page bio › Réglages : liens, contenu et sections de la page publique.
 * Même lecture / écriture qu'avant (`fetchLinksConfig`, `saveLinksConfig`).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { Block, ErrorState, useAdminT } from '@/admin/ui';
import { DEFAULT_LINKS_CONFIG, fetchLinksConfig, saveLinksConfig, type LinksConfig } from '@/lib/yunoLinks';
import { COMMS_KEY } from './data';
import { Field, SwitchRow } from '@/admin/ui';

const splitCities = (s: string) => Array.from(new Set(s.split(/[,\n;]/).map((x) => x.trim()).filter(Boolean))).slice(0, 12);
const phoneStyle = { background: 'var(--a-panel)', border: '1px solid var(--a-border)', borderRadius: 8, color: 'var(--a-text)', fontSize: 13 } as const;

export default function LinksSettings() {
  const { t } = useAdminT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...COMMS_KEY, 'links-config'], queryFn: fetchLinksConfig });
  const [config, setConfig] = useState<LinksConfig>(DEFAULT_LINKS_CONFIG);
  const [live, setLive] = useState('');
  const [wait, setWait] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setConfig(q.data); setLive(q.data.live_cities.join(', ')); setWait(q.data.waitlist_cities.join(', '));
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      const next: LinksConfig = {
        ...config,
        live_cities: splitCities(live).length ? splitCities(live) : DEFAULT_LINKS_CONFIG.live_cities,
        waitlist_cities: splitCities(wait).length ? splitCities(wait) : DEFAULT_LINKS_CONFIG.waitlist_cities,
        featured_limit: Math.min(12, Math.max(1, Math.round(Number(config.featured_limit) || 6))),
      };
      await saveLinksConfig(next);
      return next;
    },
    onSuccess: (next) => {
      setConfig(next); setLive(next.live_cities.join(', ')); setWait(next.waitlist_cities.join(', '));
      toast.success(t('adminLinks.saved'));
      void qc.invalidateQueries({ queryKey: [...COMMS_KEY, 'links-config'] });
    },
    onError: () => toast.error(t('adminLinks.saveError')),
  });

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <div className="a-skel h-64" />;
  const set = <K extends keyof LinksConfig>(k: K, v: LinksConfig[K]) => setConfig((c) => ({ ...c, [k]: v }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-2">
        <Block title={t('adminLinks.setLinks')}>
          <div className="flex flex-col gap-4">
            <Field label={t('adminLinks.setInstagramFr')}><input className="a-input" value={config.instagram_fr} onChange={(e) => set('instagram_fr', e.target.value)} placeholder="https://www.instagram.com/…" /></Field>
            <Field label={t('adminLinks.setInstagramIntl')} hint={t('adminLinks.setInstagramHint')}><input className="a-input" value={config.instagram_intl} onChange={(e) => set('instagram_intl', e.target.value)} placeholder="https://www.instagram.com/…" /></Field>
            <Field label={t('adminLinks.setTiktok')} hint={t('adminLinks.setTiktokHint')}><input className="a-input" value={config.tiktok} onChange={(e) => set('tiktok', e.target.value)} placeholder="https://www.tiktok.com/@…" /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adminLinks.setWhatsapp')}</span>
              <PhoneInputWithCountry value={config.whatsapp_number} onChange={(v) => set('whatsapp_number', v)} size="sm" inputStyle={phoneStyle} triggerStyle={phoneStyle} />
              <span className="a-t3 text-[12px]">{t('adminLinks.setWhatsappHint')}</span>
            </div>
            <Field label={t('adminLinks.setAppStore')}><input className="a-input" value={config.app_store_url} onChange={(e) => set('app_store_url', e.target.value)} /></Field>
          </div>
        </Block>
        <div className="flex flex-col gap-10">
          <Block title={t('adminLinks.setContent')}>
            <div className="flex flex-col gap-4">
              <Field label={t('adminLinks.setLiveCities')} hint={t('adminLinks.setLiveCitiesHint')}><input className="a-input" value={live} onChange={(e) => setLive(e.target.value)} placeholder="Madrid, Paris" /></Field>
              <Field label={t('adminLinks.setWaitlistCities')} hint={t('adminLinks.setWaitlistCitiesHint')}><input className="a-input" value={wait} onChange={(e) => setWait(e.target.value)} placeholder="Lyon, Bordeaux, Toulouse" /></Field>
              <Field label={t('adminLinks.setFeaturedLimit')} className="max-w-[160px]"><input className="a-input a-num" type="number" min={1} max={12} value={config.featured_limit} onChange={(e) => set('featured_limit', Number(e.target.value))} /></Field>
            </div>
          </Block>
          <Block title={t('adminLinks.setSections')} meta={t('adminLinks.preview')}>
            <SwitchRow label={t('adminLinks.setShowFeatured')} checked={config.show_featured} onChange={(v) => set('show_featured', v)} />
            <SwitchRow label={t('adminLinks.setShowWaitlist')} checked={config.show_waitlist} onChange={(v) => set('show_waitlist', v)} />
            <SwitchRow label={t('adminLinks.setShowPros')} checked={config.show_pros} onChange={(v) => set('show_pros', v)} />
          </Block>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="button" className="a-btn a-btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('adm.ui.working') : t('adminLinks.save')}</button>
      </div>
    </div>
  );
}
