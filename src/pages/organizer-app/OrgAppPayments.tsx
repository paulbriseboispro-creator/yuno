import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Banknote, Clock, Landmark, Receipt } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { OrgStripeConnectCard } from '@/components/organizer-app/OrgStripeConnectCard';
import { OrgPage, OrgPageHeader, OrgCard, OrgButton, T1, T2, T3, RED, BORDER, INNER_BG } from '@/components/org-ui';

/**
 * Dedicated payments page for organizers — manages the Stripe Connect account in isolation
 * (status, onboarding, dashboard access). Also the landing target for the Stripe onboarding
 * return flow: the edge function's return_url is `/organizer-app/settings?stripe=...`, which is
 * routed here, so we keep handling that query param.
 */
export default function OrgAppPayments() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'success') {
      toast.success(t('Onboarding Stripe terminé', 'Stripe onboarding complete'));
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('stripe') === 'refresh') {
      toast.info(t('Reprenez votre onboarding Stripe', 'Resume your Stripe onboarding'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [language]);

  const facts: { icon: typeof Banknote; title: string; desc: string }[] = [
    {
      icon: Banknote,
      title: t('Vous êtes payé directement', 'You get paid directly'),
      desc: t(
        "L'argent des billets arrive sur votre compte Stripe, puis sur votre compte bancaire. Yuno ne touche jamais vos fonds.",
        'Ticket money lands in your Stripe account, then your bank account. Yuno never holds your funds.',
      ),
    },
    {
      icon: Clock,
      title: t('Virements automatiques', 'Automatic payouts'),
      desc: t(
        'Stripe verse vos revenus sur votre compte bancaire selon le calendrier défini dans votre dashboard Stripe.',
        'Stripe pays out your revenue to your bank account on the schedule set in your Stripe dashboard.',
      ),
    },
    {
      icon: Receipt,
      title: t('Frais de service Yuno', 'Yuno service fee'),
      desc: t(
        'Yuno applique 4 % de frais de service sur la billetterie (min. 0,99 €), prélevés automatiquement à chaque vente.',
        'Yuno applies a 4% service fee on ticketing (min. €0.99), deducted automatically on each sale.',
      ),
    },
  ];

  return (
    <OrgPage className="mx-auto max-w-2xl">
      <OrgPageHeader
        title={t('Paiements', 'Payments')}
        subtitle={t('Gérez votre compte Stripe et vos virements en toute autonomie.', 'Manage your Stripe account and payouts independently.')}
      />

      <div className="space-y-4">
        <OrgStripeConnectCard userId={user?.id} />

        <OrgCard style={{ padding: 24 }}>
          <h3 className="mb-3" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
            {t('Comment ça marche', 'How it works')}
          </h3>
          <div className="space-y-3">
            {facts.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(232,25,44,0.1)' }}>
                  <Icon className="h-4 w-4" style={{ color: RED }} />
                </div>
                <div>
                  <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{title}</p>
                  <p className="mt-0.5" style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3" style={{ color: T3, fontSize: 11.5 }}>
            {t(
              'Pour modifier votre IBAN, vos coordonnées bancaires ou votre calendrier de virement, ouvrez votre dashboard Stripe ci-dessus.',
              'To change your IBAN, bank details or payout schedule, open your Stripe dashboard above.',
            )}
          </p>
        </OrgCard>

        <CollabIbanCard userId={user?.id} />
      </div>
    </OrgPage>
  );
}

/**
 * IBAN pour les règlements collab HORS Stripe : quand un contrat de
 * collaboration partage les tables sur le TOTAL dépensé de la soirée, le club
 * règle le complément de fin de soirée par virement SEPA direct. Cet IBAN vit
 * dans organizer_payout_details (table dédiée, jamais lisible publiquement —
 * le club ne le voit qu'au moment de régler, via le lot de règlement).
 * Changer d'IBAN gèle les règlements 24 h (anti-fraude, comme les promoteurs).
 */
function CollabIbanCard({ userId }: { userId?: string }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [iban, setIban] = useState('');
  const [bic, setBic] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('organizer_payout_details')
        .select('iban, bic')
        .eq('user_id', userId)
        .maybeSingle();
      if (!active) return;
      setIban((data?.iban as string | null) ?? '');
      setBic((data?.bic as string | null) ?? '');
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [userId]);

  const save = async () => {
    if (!userId || saving) return;
    const cleaned = iban.replace(/\s+/g, '').toUpperCase();
    if (cleaned && cleaned.length < 8) {
      toast.error(t('IBAN trop court', 'IBAN too short', 'IBAN demasiado corto'));
      return;
    }
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('organizer_payout_details')
        .upsert({ user_id: userId, iban: cleaned || null, bic: bic.trim().toUpperCase() || null }, { onConflict: 'user_id' });
      if (error) throw error;
      toast.success(t('Coordonnées enregistrées', 'Bank details saved', 'Datos bancarios guardados'));
    } catch {
      toast.error(t('Erreur d\'enregistrement', 'Save failed', 'Error al guardar'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <OrgCard style={{ padding: 24 }}>
      <div className="mb-2 flex items-center gap-2">
        <Landmark className="h-4 w-4" style={{ color: RED }} />
        <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
          {t('IBAN pour les règlements collab', 'IBAN for collab settlements', 'IBAN para liquidaciones de colaboración')}
        </h3>
      </div>
      <p className="mb-3" style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>
        {t(
          "Utilisé uniquement quand un contrat de collaboration partage les tables sur le total dépensé : le club vous règle le complément de fin de soirée par virement direct. Le club ne voit cet IBAN qu'au moment de régler.",
          'Used only when a collaboration contract splits tables on total spend: the club settles the end-of-night top-up by direct bank transfer. The club only sees this IBAN when settling.',
          'Se usa solo cuando un contrato de colaboración reparte las mesas sobre el gasto total: el club le liquida el complemento de fin de noche por transferencia directa. El club solo ve este IBAN al liquidar.',
        )}
      </p>
      <div className="space-y-2">
        <input
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          placeholder="FR76 3000 4000 0312 3456 7890 143"
          autoComplete="off"
          className="w-full font-mono"
          style={{ padding: '10px 12px', borderRadius: 12, fontSize: 13, background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
        />
        <input
          value={bic}
          onChange={(e) => setBic(e.target.value)}
          placeholder={t('BIC (facultatif)', 'BIC (optional)', 'BIC (opcional)')}
          autoComplete="off"
          className="w-full font-mono"
          style={{ padding: '10px 12px', borderRadius: 12, fontSize: 13, background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
        />
        <div className="flex items-center justify-between gap-3">
          <p style={{ color: T3, fontSize: 10.5 }}>
            {t('Tout changement d\'IBAN gèle les règlements 24 h (anti-fraude).', 'Any IBAN change freezes settlements for 24h (anti-fraud).', 'Cualquier cambio de IBAN congela las liquidaciones 24 h (antifraude).')}
          </p>
          <OrgButton variant="primary" size="sm" onClick={save} disabled={!loaded || saving}>
            {saving ? t('Enregistrement…', 'Saving…', 'Guardando…') : t('Enregistrer', 'Save', 'Guardar')}
          </OrgButton>
        </div>
      </div>
    </OrgCard>
  );
}
