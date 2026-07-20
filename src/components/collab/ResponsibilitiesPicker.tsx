import { Users, Palette, Settings2, Lock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  COLLAB_DOMAINS,
  type CollabDomain, type CollabResponsibilities, type DomainHolder,
} from '@/utils/collabResponsibilities';

const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

const DOMAIN_ICON: Record<CollabDomain, typeof Palette> = {
  design: Palette,
  operations: Settings2,
};

/** Club · Les deux · Organisateur — l'ordre met « les deux » au milieu, entre les deux extrêmes. */
const HOLDERS: DomainHolder[] = ['venue', 'both', 'organizer'];

/**
 * Réglage de l'axe RESPONSABILITÉS : qui habille la soirée, qui la fait tourner.
 *
 * Deux lignes, trois boutons. Pas de préréglages : ils n'existaient que pour
 * éviter de cliquer quatre lignes, et avec deux domaines la grille EST le
 * préréglage.
 *
 * Volontairement séparé du réglage des %. Un club et un organisateur peuvent
 * partager 50/50 les billets sans partager la main sur l'affiche — c'est
 * précisément ce que le modèle ne savait pas dire quand `event_mode` portait
 * les deux sens à la fois.
 */
export function ResponsibilitiesPicker({
  value, onChange, disabled = false, partnerName, note,
}: {
  value: CollabResponsibilities;
  onChange: (next: CollabResponsibilities) => void;
  disabled?: boolean;
  partnerName?: string | null;
  note?: string;
}) {
  const { t } = useLanguage();

  // Le nom réel du partenaire rend le choix concret, mais seul il devient
  // ambigu quand l'organisateur s'appelle comme la plateforme. On garde donc
  // toujours le rôle devant le nom.
  const holderLabel = (h: DomainHolder) =>
    h === 'organizer' && partnerName
      ? `${t('collabResp.holder.organizer')} · ${partnerName}`
      : t(`collabResp.holder.${h}`);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4" style={{ color: RED }} />
        <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('collabResp.title')}</p>
        {disabled && <Lock className="w-3 h-3" style={{ color: T3 }} />}
      </div>
      <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45, marginTop: -6 }}>
        {disabled ? t('collabResp.lockedByContract') : t('collabResp.desc')}
      </p>

      <div className="space-y-2">
        {COLLAB_DOMAINS.map(domain => {
          const Icon = DOMAIN_ICON[domain];
          return (
            <div
              key={domain}
              className="rounded-xl p-3"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-start gap-2 mb-2.5">
                <Icon className="w-4 h-4 mt-0.5 flex-none" style={{ color: T3 }} />
                <div className="min-w-0">
                  <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                    {t(`collabResp.domain.${domain}`)}
                  </p>
                  <p style={{ color: T3, fontSize: 11, lineHeight: 1.4 }}>
                    {t(`collabResp.domainDesc.${domain}`)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {HOLDERS.map(h => {
                  const on = value[domain] === h;
                  return (
                    <button
                      key={h} type="button" disabled={disabled}
                      onClick={() => onChange({ ...value, [domain]: h })}
                      className="rounded-lg px-2 py-2 text-[11.5px] font-medium truncate transition-all duration-150"
                      style={{
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled && !on ? 0.4 : 1,
                        ...(on
                          ? { background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.32)', color: RED }
                          : { background: 'transparent', border: `1px solid ${BORDER}`, color: T3 }),
                      }}
                    >
                      {holderLabel(h)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {note && <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>{note}</p>}
    </div>
  );
}

export default ResponsibilitiesPicker;
