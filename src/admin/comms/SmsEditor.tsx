/**
 * Communication › SMS de Yuno : l'éditeur et le rapport d'une campagne SMS
 * (`SmsCampaignsPanel`, partagé avec les Consoles des pros) dans la portée
 * plateforme. Yuno n'achète pas de crédits : le SMS part sur son compte
 * Octopush, le coût reste lisible sur chaque destinataire. Le panneau garde
 * son cadre d'origine ; l'entrée et le retour sont ceux du kit.
 */
import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import SmsCampaignsPanel from '@/components/sms/SmsCampaignsPanel';
import { Page, useAdminT } from '@/admin/ui';
import type { SmsScope } from '@/lib/smsMarketing';
import { SuiteFrame } from '../shell/frames';

export default function SmsEditor() {
  const { t } = useAdminT();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [sp] = useSearchParams();
  const scope = useMemo<SmsScope>(() => ({ kind: 'platform', name: 'Yuno' }), []);
  return (
    <Page title={t('adm.comms.sms.title')} subtitle={t('pm.smsSubtitle')}
      actions={<button type="button" className="a-btn" onClick={() => navigate(id ? '/admin/comms/sms' : '/admin/comms?tab=sms')}>{t('adm.comms.ed.back')}</button>}>
      <SuiteFrame>
        <SmsCampaignsPanel scope={scope} basePath="/admin/comms/sms" selectedId={id ?? null} presetEventId={sp.get('event')} />
      </SuiteFrame>
    </Page>
  );
}
