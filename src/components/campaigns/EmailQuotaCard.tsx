// Quota d'envoi du mois — visible AVANT d'écrire la campagne.
//
// Le plafond mensuel (allocation offerte + crédits achetés) n'était affiché
// qu'au dernier écran du Studio, juste avant l'envoi : un club ou un
// organisateur composait donc toute une campagne sans savoir combien d'emails
// il lui restait, et découvrait la limite au moment de partir. Cette carte
// pose le chiffre sur la page Campagnes, à côté du bouton qui en consomme.
//
// `remaining` vient TOUJOURS du serveur (get_email_quota_status) : le front ne
// recalcule jamais offert − envoyé, la formule crédits/dépassement vit en base.

import { useEffect } from 'react';
import { Gauge, Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useEmailQuota, type StudioScope } from '@/components/email-studio/hooks';

const RED = '#E8192C';
const WARN = '#FCD34D';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const nf = (n: number) => n.toLocaleString('fr-FR');

interface Props {
  scope: StudioScope;
  /** Ouvre le dialogue d'achat d'emails supplémentaires. */
  onBuy: () => void;
  /** Incrémenté par le parent après un achat : relit le quota serveur. */
  refreshKey?: number;
}

export default function EmailQuotaCard({ scope, onBuy, refreshKey = 0 }: Props) {
  const { t, language } = useLanguage();
  const { quota, refresh } = useEmailQuota(scope);

  useEffect(() => { if (refreshKey > 0) refresh(); }, [refreshKey, refresh]);

  // Rien tant que le serveur n'a pas répondu : un plafond provisoire vaudrait
  // moins que pas de plafond du tout.
  if (!quota) return null;

  // La jauge se lit sur la capacité RÉELLE du mois (offert + crédits), pas sur
  // la seule allocation offerte : un compte qui a acheté 10 000 emails ne doit
  // pas voir une barre rouge à 13 000 envoyés alors qu'il lui en reste 11 900.
  // `used + remaining` est la capacité vue par le serveur — jamais recalculée.
  const total = Math.max(1, quota.used + quota.remaining);
  const pct = Math.min(1, quota.used / total);
  const exhausted = quota.remaining <= 0;
  const warn = !exhausted && quota.remaining <= total * 0.2;
  const tone = exhausted ? RED : warn ? WARN : 'rgba(255,255,255,0.42)';
  const resetDate = new Date(quota.resetsOn).toLocaleDateString(language, { day: 'numeric', month: 'long' });

  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${exhausted ? 'rgba(232,25,44,0.35)' : warn ? 'rgba(252,211,77,0.28)' : BORDER}`,
        borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 18px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 12, flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`,
        color: exhausted ? RED : warn ? WARN : T2,
      }}>
        <Gauge className="w-4 h-4" />
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            {t('em.quota.title')}
          </span>
          {quota.credits > 0 && (
            <span style={{
              color: T2, fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, fontVariantNumeric: 'tabular-nums',
            }}>{t('studio.sched.quotaCredits').replace('{n}', nf(quota.credits))}</span>
          )}
        </div>

        <div style={{
          margin: '5px 0 8px', color: exhausted ? RED : T1, fontSize: 17, fontWeight: 620,
          letterSpacing: '-0.015em', fontVariantNumeric: 'tabular-nums',
        }}>
          {exhausted ? t('em.quota.exhausted') : t('em.quota.remaining').replace('{n}', nf(quota.remaining))}
        </div>

        <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${Math.round(pct * 100)}%`, borderRadius: 999,
            background: tone, transition: 'width .3s, background .3s',
          }} />
        </div>

        <p style={{ margin: '8px 0 0', color: T3, fontSize: 11.5 }}>
          {t('em.quota.usedOf').replace('{used}', nf(quota.used)).replace('{free}', nf(quota.free))}
          {' · '}
          {t('em.quota.resets').replace('{date}', resetDate)}
        </p>
      </div>

      <button
        type="button" onClick={onBuy} className="cursor-pointer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, flex: 'none',
          padding: '9px 15px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
          background: exhausted ? RED : 'rgba(255,255,255,0.025)',
          border: `1px solid ${exhausted ? RED : BORDER}`,
          color: exhausted ? '#fff' : T2,
          boxShadow: exhausted ? '0 0 18px -6px #E8192C' : 'none',
        }}
      >
        <Plus className="w-4 h-4" /> {t('studio.sched.quotaBuy')}
      </button>
    </div>
  );
}
