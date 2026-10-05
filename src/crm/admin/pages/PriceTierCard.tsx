/**
 * Admin CRM › Argent › le prix public (seuil des 50 comptes) : le niveau en
 * vigueur (crm_admin_price_tier) et l'état des prix publics CHEZ STRIPE, lu par
 * l'action crm_price_status de club-subscription (LECTURE seule). Activer les
 * prix publics est un geste explicite de Paul dans Stripe : l'écran donne la
 * procédure, il n'active rien.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { RowLine, Section } from '../ui';

interface Tier { tier: 'launch' | 'public'; paying: number; switch_at: number; public_active: boolean; checked_at: string | null }
interface StripeStatus { prices: { lookup_key: string; found: boolean; active: boolean; amount: number | null }[]; public_active: boolean }

export default function PriceTierCard() {
  const { t, dShort, time } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['crm-admin', 'price-tier'], staleTime: 30_000, queryFn: () => rpc<Tier>('crm_admin_price_tier') });
  const [st, setSt] = useState<StripeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('club-subscription', { body: { action: 'crm_price_status' } });
    setBusy(false);
    if (error || !(data as { success?: boolean } | null)?.success) { toast(t('adm.crm.pt.checkFail')); return; }
    setSt(data as StripeStatus);
    void qc.invalidateQueries({ queryKey: ['crm-admin', 'price-tier'] });
  };
  const d = q.data;
  const active = st ? st.public_active : d?.public_active ?? false;
  return (
    <Section title={t('adm.crm.pt.title')} sub={t('adm.crm.pt.sub')} pad={24} gap={10}
      right={<Hv as="button" type="button" disabled={busy} onClick={() => void check()} style={{ height: 38, padding: '0 14px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 13.5, cursor: busy ? 'wait' : 'pointer' }} hover={{ background: 'var(--sand-50)' }}>{busy ? t('adm.crm.pt.checking') : t('adm.crm.pt.check')}</Hv>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <span style={{ height: 30, padding: '0 12px', borderRadius: 99, background: active ? 'var(--green-50)' : 'var(--amber-50)', color: active ? 'var(--green-700)' : 'var(--amber-700)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
          {t(active ? 'adm.crm.pt.active' : 'adm.crm.pt.pending')}
        </span>
        {d && <span style={{ height: 30, padding: '0 12px', borderRadius: 99, background: 'var(--sand-100)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t(d.tier === 'public' ? 'adm.crm.pt.tierPublic' : 'adm.crm.pt.tierLaunch', { n: d.paying, at: d.switch_at })}</span>}
      </div>
      {st && st.prices.map((p, i) => (
        <RowLine key={p.lookup_key} first={i === 0}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{p.lookup_key}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: !p.found ? 'var(--red-600)' : p.active ? 'var(--green-700)' : 'var(--amber-700)' }}>
            {!p.found ? t('adm.crm.pt.missing') : `${p.amount ?? '—'} € · ${t(p.active ? 'adm.crm.pt.on' : 'adm.crm.pt.off')}`}
          </span>
        </RowLine>
      ))}
      {!st && d?.checked_at && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('adm.crm.pt.lastCheck', { date: `${dShort(d.checked_at)} ${time(d.checked_at)}` })}</span>}
      <p style={{ margin: 0, padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.55, color: 'var(--sand-700)' }}>{t('adm.crm.pt.howto')}</p>
    </Section>
  );
}
