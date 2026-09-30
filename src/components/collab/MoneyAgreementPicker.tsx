import type { ReactNode } from 'react';
import { Handshake, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgTabs, BORDER, INNER_BG, RED, T1, T2, T3 } from '@/components/org-ui';
import type { ExternalCollector } from '@/lib/splitRules';

export type MoneyAgreement = 'external' | 'yuno';

/**
 * « Partage de l'argent » — le choix que le formulaire de soirée pose dès qu'il
 * y a un partenaire (club × orga) ou des organisations partenaires
 * (co-organisation). Deux voies, jamais une obligation :
 *
 *  • « Réglé entre vous » — Yuno ne s'occupe pas de l'argent. Pas de contrat :
 *    la vente ouvre tout de suite, chaque pilier est encaissé EN DIRECT par la
 *    partie choisie (bar toujours au club). C'est le défaut quand rien n'a été
 *    convenu, parce qu'une collaboration commence souvent avant d'avoir parlé
 *    rémunération.
 *  • « Encadré par Yuno » — contrat signé en ligne (club × orga) ou accord de
 *    co-organisation : partage automatique par Stripe, ou décompte après la
 *    soirée et virements suivis.
 *
 * Le détail de chaque voie (qui encaisse, conditions du contrat) s'affiche
 * sous le choix : une décision à la fois.
 */
export function MoneyAgreementPicker({
  value, onChange, side, hasClubPartner, partnerName,
  collectors, onCollectorsChange, yunoDetails, cohostOnlyNote,
}: {
  value: MoneyAgreement;
  onChange: (v: MoneyAgreement) => void;
  /** Qui remplit le formulaire. */
  side: 'venue' | 'organizer';
  /** Collab club × organisateur (contrat Yuno possible), sinon co-organisation seule. */
  hasClubPartner: boolean;
  partnerName: string;
  collectors: { tickets: ExternalCollector; tables: ExternalCollector };
  onCollectorsChange: (c: { tickets: ExternalCollector; tables: ExternalCollector }) => void;
  /** Conditions du contrat qui partira (club × orga, voie Yuno). */
  yunoDetails?: ReactNode;
  /** Co-organisation seule : rien à régler dans le formulaire, juste la suite. */
  cohostOnlyNote?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const me = t('Toi', 'You', 'Tú');
  const partner = partnerName || (side === 'venue' ? t('L’organisateur', 'The organizer', 'El organizador') : t('Le club', 'The club', 'El club'));
  // Libellé d'un côté vu par CELUI qui remplit.
  const who = (c: ExternalCollector) => (c === (side === 'venue' ? 'venue' : 'organizer') ? me : partner);
  const tabs = [
    { value: (side === 'venue' ? 'venue' : 'organizer') as ExternalCollector, label: me },
    { value: (side === 'venue' ? 'organizer' : 'venue') as ExternalCollector, label: partner },
  ];

  return (
    <div className="space-y-2">
      <Choice
        selected={value === 'external'}
        onClick={() => onChange('external')}
        icon={Handshake}
        title={t('Réglé entre vous', 'Settled between you', 'Lo arregláis entre vosotros')}
        body={t(
          'Aucun contrat à signer : la vente ouvre tout de suite. Chaque vente est encaissée directement par qui la tient, et vous réglez le reste entre vous. Tu pourras passer par Yuno plus tard.',
          'No contract to sign: sales open right away. Each sale is collected directly by whoever runs it, and you settle the rest between you. You can switch to Yuno later.',
          'Sin contrato que firmar: la venta abre enseguida. Cada venta la cobra directamente quien la lleva, y el resto lo arregláis entre vosotros. Podrás pasar por Yuno más tarde.',
        )}
      />
      <Choice
        selected={value === 'yuno'}
        onClick={() => onChange('yuno')}
        icon={ShieldCheck}
        title={t('Encadré par Yuno', 'Secured by Yuno', 'Gestionado por Yuno')}
        body={hasClubPartner
          ? t(
            'Un contrat signé en ligne par vous deux : une partie encaisse, Yuno calcule le décompte après la soirée et suit le virement de la part de l’autre.',
            'An agreement you both sign online: one side collects, Yuno computes the statement after the night and tracks the transfer of the other side’s share.',
            'Un contrato firmado en línea por los dos: una parte cobra, Yuno calcula la liquidación tras la noche y sigue la transferencia de la parte del otro.',
          )
          : t(
            'Les parts de chacun fixées sur Yuno (simple accord ou contrat signé) : décompte validé par tous après la soirée, virements suivis et relancés.',
            'Each party’s share set on Yuno (simple agreement or signed contract): a statement everyone approves after the night, tracked and chased transfers.',
            'La parte de cada uno fijada en Yuno (acuerdo simple o contrato firmado): liquidación validada por todos tras la noche, transferencias seguidas.',
          )}
      />

      {/* Le détail de la voie choisie, et seulement celle-là. */}
      {value === 'external' && hasClubPartner && (
        <div className="rounded-xl p-3 space-y-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('Qui encaisse ?', 'Who collects?', '¿Quién cobra?')}</p>
          <CollectorRow label={t('Billets', 'Tickets', 'Entradas')}>
            <OrgTabs size="sm" tabs={tabs} value={collectors.tickets}
              onChange={(v) => onCollectorsChange({ ...collectors, tickets: v })} />
          </CollectorRow>
          <CollectorRow label={t('Tables VIP', 'VIP tables', 'Mesas VIP')}>
            <OrgTabs size="sm" tabs={tabs} value={collectors.tables}
              onChange={(v) => onCollectorsChange({ ...collectors, tables: v })} />
          </CollectorRow>
          <CollectorRow label={t('Bar', 'Bar', 'Barra')}>
            <span style={{ color: T2, fontSize: 12 }}>{who('venue')} · {t('licence alcool', 'alcohol licence', 'licencia de alcohol')}</span>
          </CollectorRow>
          <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
            {t(
              'Chaque vente part directement sur le compte Stripe de qui l’encaisse. Yuno ne calcule ni décompte ni virement ; ton partenaire voit les ventes de la soirée depuis sa Console.',
              'Each sale goes straight to the Stripe account of whoever collects it. Yuno computes no statement and no transfer; your partner sees the night’s sales in their Console.',
              'Cada venta va directamente a la cuenta Stripe de quien la cobra. Yuno no calcula liquidación ni transferencia; tu socio ve las ventas desde su Consola.',
            )}
          </p>
        </div>
      )}
      {value === 'external' && !hasClubPartner && (
        <p className="px-1" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
          {t(
            'Les ventes en ligne sont encaissées par toi, l’organisateur principal. Chaque partenaire voit les mêmes chiffres que toi (ventes, CA, ce que chacun a amené) pour régler en confiance.',
            'Online sales are collected by you, the main organizer. Each partner sees the same figures as you (sales, revenue, what each one brought) to settle with confidence.',
            'Las ventas online las cobras tú, el organizador principal. Cada socio ve las mismas cifras que tú (ventas, ingresos, lo que aportó cada uno) para liquidar con confianza.',
          )}
        </p>
      )}
      {value === 'yuno' && hasClubPartner && yunoDetails}
      {value === 'yuno' && cohostOnlyNote && (
        <p className="px-1" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
          {t(
            'Dès que tes partenaires ont accepté, fixe les parts depuis la page Co-organisation de la soirée. Rien ne bloque la vente en attendant.',
            'As soon as your partners have accepted, set the shares from the event’s Co-organization page. Nothing blocks sales in the meantime.',
            'En cuanto tus socios acepten, fija las partes desde la página Coorganización del evento. Nada bloquea la venta mientras tanto.',
          )}
        </p>
      )}
    </div>
  );
}

function CollectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span style={{ color: T2, fontSize: 12.5 }}>{label}</span>
      {children}
    </div>
  );
}

function Choice({ selected, onClick, icon: Icon, title, body }: {
  selected: boolean; onClick: () => void; icon: LucideIcon; title: string; body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="w-full text-left flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150"
      style={selected
        ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.35)' }
        : { background: 'rgb(var(--ink)/0.018)', border: `1px solid ${BORDER}` }}
    >
      <span className="mt-0.5 h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0"
        style={selected ? { border: `1px solid ${RED}` } : { border: '1px solid rgb(var(--ink)/var(--ink-a25,0.25))' }}>
        {selected && <span className="h-2 w-2 rounded-full" style={{ background: RED }} />}
      </span>
      <span className="flex-1">
        <span className="flex items-center gap-2" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>
          <Icon className="h-4 w-4" style={{ color: selected ? RED : T3 }} />
          {title}
        </span>
        <span className="block" style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>{body}</span>
      </span>
    </button>
  );
}
