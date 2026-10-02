// Revenu récurrent Yuno CRM (super admin) — une lecture : admin_crm_revenue.
// Le mensuel équivalent ramène l'annuel au mois (10 mois payés / 12) ; un
// essai, une offre accordée à la main ou un compte gratuit comptent 0 €.

import { useEffect, useState } from 'react';
import { CreditCard, Repeat, Sparkles, Timer, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, DistRow, ErrorState, SectionHeading, Stat, T3 } from '@/components/admin/ui';
import { fmtEur, fmtNum } from '@/lib/adminFormat';

interface CrmRevenue {
  accounts: number; mrr: number; paying: number; trialing: number; past_due: number; founders: number;
  by_plan: Record<string, number>;
}

const PLAN_ORDER = ['free', 'essential', 'pro', 'business'];

export function AdminCrmRevenue({ includeDemo, n }: { includeDemo: boolean; n: number }) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<CrmRevenue | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: d, error: e } = await supabase.rpc('admin_crm_revenue', { p_include_demo: includeDemo });
      if (cancelled) return;
      if (e) { setError(true); return; }
      setError(false);
      setData(d as unknown as CrmRevenue);
    })();
    return () => { cancelled = true; };
  }, [includeDemo]);

  return (
    <div>
      <SectionHeading n={n} label={t('adm.revenue.crm.title')} icon={Repeat} right={<span style={{ color: T3, fontSize: 11.5 }}>{t('adm.revenue.crm.hint')}</span>} />
      {error && <Card><ErrorState text={t('adm.common.error')} /></Card>}
      {data && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3">
          <div className="grid grid-cols-2 gap-3 xl:col-span-2">
            <Stat compact label={t('adm.revenue.crm.mrr')} value={fmtEur(data.mrr, language)} icon={CreditCard} highlight />
            <Stat compact label={t('adm.revenue.crm.paying')} value={fmtNum(data.paying, language)} icon={Users}
              sub={t('adm.revenue.crm.accounts').replace('{n}', fmtNum(data.accounts, language))} />
            <Stat compact label={t('adm.revenue.crm.trialing')} value={fmtNum(data.trialing, language)} icon={Timer} />
            <Stat compact label={t('adm.revenue.crm.founders')} value={`${fmtNum(data.founders, language)} / 15`} icon={Sparkles}
              tone={data.past_due > 0 ? 'warn' : undefined}
              sub={data.past_due > 0 ? t('adm.revenue.crm.pastDue').replace('{n}', fmtNum(data.past_due, language)) : undefined} />
          </div>
          <Card title={t('adm.revenue.crm.byPlan')}>
            <div className="space-y-2.5">
              {PLAN_ORDER.map((p) => {
                const v = data.by_plan[p] ?? 0;
                return <DistRow key={p} label={t(`crm.plan.${p}`)} value={fmtNum(v, language)} pct={data.accounts > 0 ? (v / data.accounts) * 100 : 0} />;
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
