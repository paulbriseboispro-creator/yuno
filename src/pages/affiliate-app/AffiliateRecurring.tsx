import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { AlertTriangle, Pencil, Play, Plus, RefreshCw, Trash2, ArrowRight } from 'lucide-react';
import {
  AffPage, AffHeading, AffCard, AffButton, AffLinkButton, AffSpinner, AffEmpty, SectionLabel,
  RED, POS, WARN, T1, T3, BORDER, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

// Jour → suffixe de clé i18n (les libellés vivent dans les locales, aff.recurring.day*.*)
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type Template = {
  id: string;
  name: string;
  day_of_week: number;
  advance_days: number;
  start_time: string | null;
  end_time: string | null;
  is_free: boolean;
  price_from: number | null;
  is_active: boolean;
  flyer_url: string | null;
  publication_url: string | null;
  affiliate_venues: { name: string } | null;
};

export default function AffiliateRecurring() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user.id).single();
    if (!aff) { setLoading(false); return; }

    const { data: tplData } = await supabase
      .from('affiliate_recurring_templates')
      .select('id, name, day_of_week, advance_days, start_time, end_time, is_free, price_from, is_active, flyer_url, publication_url, affiliate_venues(name)')
      .eq('affiliate_id', aff.id)
      .order('day_of_week');

    setTemplates((tplData ?? []) as Template[]);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('aff.recurring.deleteConfirm'))) return;
    await supabase.from('affiliate_recurring_templates').delete().eq('id', id);
    setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    toast({ title: t('aff.recurring.deletedToast') });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-affiliate-recurring-events');
      if (error) throw error;
      toast({ title: t('aff.recurring.generatedToast').replace('{count}', String(data.generated ?? 0)) });
      fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('aff.recurring.errorTitle');
      toast({ title: t('aff.recurring.errorTitle'), description: msg, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const todayDow = new Date().getDay();
  const daysUntil = (dow: number) => ((dow - todayDow + 7) % 7) || 7;
  const missing = templates
    .filter((tpl) => tpl.is_active && !tpl.publication_url)
    .sort((a, b) => daysUntil(a.day_of_week) - daysUntil(b.day_of_week));

  if (loading) return <AffSpinner />;

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title={t('aff.recurring.title')}
          subtitle={t('aff.recurring.subtitle')}
          right={
            <div className="flex gap-2">
              <AffButton variant="secondary" size="sm" onClick={handleGenerate} disabled={generating}>
                <Play className="h-4 w-4" /> {generating ? t('aff.recurring.generating') : t('aff.recurring.generate')}
              </AffButton>
              <AffLinkButton to="/affiliate/recurring/new" size="sm">
                <Plus className="h-4 w-4" /> {t('aff.recurring.newTemplate')}
              </AffLinkButton>
            </div>
          }
        />
      </motion.div>

      {/* Templates sans lien de publication */}
      {missing.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>
            <span className="inline-flex items-center gap-1.5" style={{ color: WARN }}>
              <AlertTriangle className="h-3.5 w-3.5" />
              {(missing.length > 1 ? t('aff.recurring.missingLinkMany') : t('aff.recurring.missingLinkOne')).replace('{count}', String(missing.length))}
            </span>
          </SectionLabel>
          <div className="space-y-2">
            {missing.map((tpl) => {
              const dLeft = daysUntil(tpl.day_of_week);
              const label = dLeft === 1 ? t('aff.recurring.tomorrow') : dLeft === 7 ? t('aff.recurring.today') : t('aff.recurring.inDays').replace('{count}', String(dLeft));
              return (
                <div key={tpl.id} className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.22)' }}>
                  <div className="flex flex-col items-center justify-center w-12 flex-none">
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(251,191,36,0.8)' }}>{t(`aff.recurring.dayShort.${DAY_KEYS[tpl.day_of_week]}`)}</span>
                    <span style={{ fontSize: 9.5, color: 'rgba(251,191,36,0.55)', marginTop: 1 }}>{label}</span>
                  </div>
                  <div className="w-px h-8 flex-none" style={{ background: 'rgba(251,191,36,0.2)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{tpl.name}</p>
                    {tpl.affiliate_venues && <p style={{ fontSize: 11.5, color: 'rgba(251,191,36,0.6)', marginTop: 1 }}>{tpl.affiliate_venues.name}</p>}
                  </div>
                  <Link to={`/affiliate/recurring/${tpl.id}/edit`}
                    className="inline-flex items-center gap-1 flex-none text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                    style={{ color: WARN, border: '1px solid rgba(251,191,36,0.3)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(251,191,36,0.1)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    {t('aff.recurring.addLink')} <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Liste des templates */}
      {templates.length === 0 ? (
        <AffEmpty
          icon={RefreshCw}
          title={t('aff.recurring.emptyTitle')}
          description={t('aff.recurring.emptyDesc')}
          action={<AffLinkButton to="/affiliate/recurring/new" size="sm"><Plus className="h-4 w-4" /> {t('aff.recurring.createTemplate')}</AffLinkButton>}
        />
      ) : (
        <AffCard padding={0}>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {templates.map((tpl, i) => (
              <motion.div key={tpl.id}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="flex items-center gap-4 px-4 py-3.5">
                {tpl.flyer_url ? (
                  <img src={tpl.flyer_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />
                ) : (
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-none"
                    style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: RED }}>{t(`aff.recurring.dayShort.${DAY_KEYS[tpl.day_of_week]}`)}</span>
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{tpl.name}</p>
                    {!tpl.is_active && (
                      <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', color: T3, background: 'rgba(255,255,255,0.05)', border: `1px solid ${F_BORDER}`, padding: '1px 6px', borderRadius: 5 }}>{t('aff.recurring.inactiveBadge')}</span>
                    )}
                  </div>
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                    {t(`aff.recurring.dayFull.${DAY_KEYS[tpl.day_of_week]}`)}
                    {tpl.start_time ? ` · ${tpl.start_time}` : ''}
                    {tpl.end_time ? ` → ${tpl.end_time}` : ''}
                    {` · ${t('aff.recurring.generatesBefore').replace('{count}', String(tpl.advance_days))}`}
                    {tpl.affiliate_venues ? ` · ${tpl.affiliate_venues.name}` : ''}
                    {tpl.is_free ? ` · ${t('aff.recurring.free')}` : tpl.price_from ? ` · €${tpl.price_from}` : ''}
                  </p>
                </div>

                <div className="w-2 h-2 rounded-full flex-none" style={{ background: tpl.is_active ? POS : T3 }} />

                <div className="flex items-center gap-1 flex-none">
                  <button onClick={() => navigate(`/affiliate/recurring/${tpl.id}/edit`)}
                    className="p-1.5 transition-colors" style={{ color: T3 }} title={t('aff.recurring.editTitle')}
                    onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(tpl.id)}
                    className="p-1.5 transition-colors" style={{ color: T3 }} title={t('aff.recurring.deleteTitle')}
                    onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </AffCard>
      )}
    </AffPage>
  );
}
