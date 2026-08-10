import { motion } from 'framer-motion';
import { Euro, Wallet, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import { PromoterPayoutInbox } from '@/components/promoter/PromoterPayoutInbox';
import { StatTile } from '@/components/promoter/promoter-ui';

export default function PromoterPayments() {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, scopeName, stats, refetchStats } = usePromoterData();

  if (!promoter) return null;

  const fmtEur = (n: number) => `${n.toFixed(2)}€`;

  return (
    <PromoterPage maxWidth={860}>
      <PromoHeading
        title={tt('Règlements', 'Payouts', 'Pagos')}
        subtitle={tt(
          'Virement SEPA de banque à banque — Yuno sécurise et horodate l’accord',
          'Bank-to-bank SEPA transfer — Yuno secures and timestamps the agreement',
          'Transferencia SEPA de banco a banco — Yuno asegura y sella el acuerdo',
        )}
      />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-3 gap-3">
        <StatTile icon={Wallet} value={fmtEur(stats.pendingCommission)} label={tt('À recevoir', 'To receive', 'Por recibir')} accent />
        <StatTile icon={Euro} value={fmtEur(stats.totalCommission)} label={tt('Total généré', 'Total earned', 'Total generado')} />
        <StatTile icon={CheckCircle2} value={fmtEur(stats.paidCommission)} label={tt('Déjà payé', 'Already paid', 'Ya pagado')} tone="pos" />
      </motion.div>

      {/* Règlements — accusé de réception, litige, reçus contresignés. La seule
          action qui solde réellement les commissions. */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <PromoterPayoutInbox
          promoterId={promoter.id}
          promoterIban={promoter.iban}
          payerName={scopeName}
          onSettled={refetchStats}
        />
      </motion.div>
    </PromoterPage>
  );
}
