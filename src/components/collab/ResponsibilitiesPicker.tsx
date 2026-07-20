import { Users, Palette, Ticket, Building2, Megaphone, Lock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  COLLAB_DOMAINS, RESPONSIBILITY_PRESETS, matchPreset,
  type CollabDomain, type CollabResponsibilities, type DomainHolder, type ResponsibilityPresetKey,
} from '@/utils/collabResponsibilities';

const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

const DOMAIN_ICON: Record<CollabDomain, typeof Palette> = {
  creative: Palette,
  ticketing: Ticket,
  operations: Building2,
  promotion: Megaphone,
};

const PRESET_ORDER: ResponsibilityPresetKey[] = [
  'venue_ops_org_creative', 'shared', 'org_runs', 'venue_runs',
];

const HOLDERS: DomainHolder[] = ['venue', 'both', 'organizer'];

/**
 * Réglage de l'axe RESPONSABILITÉS d'une collaboration : qui a la main sur la
 * création, la billetterie, les opérations et la promotion.
 *
 * Volontairement séparé du réglage des %. Un club et un organisateur peuvent
 * très bien partager 50/50 les billets sans partager la main sur l'affiche —
 * c'est précisément ce que le modèle ne savait pas dire tant que `event_mode`
 * portait les deux sens à la fois.
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
  const preset = matchPreset(value);

  const holderLabel = (h: DomainHolder) =>
    h === 'organizer' && partnerName ? partnerName : t(`collabResp.holder.${h}`);

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

      {/* Répartitions types — un clic pour la configuration courante. */}
      <div className="grid grid-cols-2 gap-2">
        {PRESET_ORDER.map(key => {
          const on = preset === key;
          return (
            <button
              key={key} type="button" disabled={disabled}
              onClick={() => onChange({ ...RESPONSIBILITY_PRESETS[key] })}
              className="rounded-xl px-3 py-2.5 text-left transition-all duration-150"
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled && !on ? 0.4 : 1,
                ...(on
                  ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)' }
                  : { background: INNER_BG, border: `1px solid ${BORDER}` }),
              }}
            >
              <span style={{ color: on ? RED : T1, fontSize: 12.5, fontWeight: 600 }}>
                {t(`collabResp.preset.${key}`)}
              </span>
              <span className="block" style={{ color: T3, fontSize: 10.5, lineHeight: 1.35, marginTop: 2 }}>
                {t(`collabResp.presetDesc.${key}`)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Détail domaine par domaine — toute combinaison hors préréglage est légale. */}
      <div className="space-y-2">
        {COLLAB_DOMAINS.map(domain => {
          const Icon = DOMAIN_ICON[domain];
          return (
            <div
              key={domain}
              className="rounded-xl p-2.5"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3.5 h-3.5" style={{ color: T3 }} />
                <div className="flex-1 min-w-0">
                  <p style={{ color: T1, fontSize: 12, fontWeight: 600 }}>
                    {t(`collabResp.domain.${domain}`)}
                  </p>
                  <p style={{ color: T3, fontSize: 10.5, lineHeight: 1.3 }}>
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
                      className="rounded-lg px-2 py-1.5 text-[11.5px] font-medium truncate transition-all duration-150"
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

      {note && (
        <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>{note}</p>
      )}
    </div>
  );
}

export default ResponsibilitiesPicker;
