/**
 * Quatre feux (paiements, e-mail, tâches planifiées, apps), lus dans le bloc
 * `health` d'admin_cockpit. Jamais admin_release_health ici : son historique
 * pg_cron coûte des secondes, il vit dans Système.
 */
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, ErrorState, Section, Status, useAdminT } from '@/admin/ui';
import type { CockpitHealth } from './data';
import { lightsOf, type Light } from './health';

export function HealthLights({ health, loading, error, onRetry }: { health: CockpitHealth | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const { t, lang } = useAdminT();
  const lights: (Light | null)[] = health ? lightsOf(health, t, lang) : [null, null, null, null];
  return (
    <Section title={t('adm.today.health.title')} description={t('adm.today.health.desc')}
      actions={<Link to="/admin/system" className="a-btn a-btn--ghost a-btn--sm">{t('adm.today.health.open')}<ChevronRight className="h-3.5 w-3.5" /></Link>}>
      {error && !health ? (
        <Card padded={false}><ErrorState onRetry={onRetry} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {lights.map((l, i) => (
            <Link key={l?.key ?? i} to="/admin/system" className="a-focus block rounded-[12px] [&>div:hover]:border-[var(--a-border-strong)]">
              <div className="a-card flex h-full flex-col gap-1.5 p-4">
                {l && !loading ? (
                  <>
                    <Status tone={l.tone}><span className="a-t1 font-medium">{l.label}</span></Status>
                    <span className="a-t2 text-[12.5px] leading-snug">{l.value}</span>
                  </>
                ) : (
                  <><div className="a-skel h-4 w-24" /><div className="a-skel h-3 w-32" /></>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}
