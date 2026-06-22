import { Zap, Star, ArrowRight, Music, Users, Megaphone } from 'lucide-react';
import type { GuestListTemplate } from '@/hooks/useGuestListTemplates';
import { RED, T1, T2, T3, F_BORDER, TILE_BG, CARD_BG, CARD_SHADOW, BORDER } from './ui';

interface PresetBarProps {
  templates: GuestListTemplate[];
  hasClubPart: boolean;
  onApplyClub: (tpl: GuestListTemplate) => void;
  onDistributeDj: (tpl: GuestListTemplate) => void;
  onPromoterPreset: (tpl: GuestListTemplate) => void;
  onGoToTemplates: () => void;
  t: (key: string) => string;
}

function Chip({ tpl, onClick }: { tpl: GuestListTemplate; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1"
      style={{ padding: '7px 12px', borderRadius: 8, background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T1, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
      {tpl.is_default && <Star className="h-3 w-3" style={{ color: RED }} />}
      {tpl.name} <span style={{ color: T3, fontWeight: 400 }}>· {tpl.quota}</span>
    </button>
  );
}

/**
 * Quick-apply bar on the Événements tab. Club presets publish/apply the club list in
 * one tap. DJ presets distribute to the whole lineup at once. Creation and management
 * live in the Templates tab.
 */
export function PresetBar({ templates, hasClubPart, onApplyClub, onDistributeDj, onPromoterPreset, onGoToTemplates, t }: PresetBarProps) {
  const clubPresets = templates.filter(tpl => tpl.holder_type === 'club');
  const djPresets = templates.filter(tpl => tpl.holder_type === 'dj');
  const promoterPresets = templates.filter(tpl => tpl.holder_type === 'promoter');
  const hasAny = clubPresets.length > 0 || djPresets.length > 0 || promoterPresets.length > 0;

  return (
    <div style={{ padding: '12px 16px', borderRadius: 14, background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
      <div className="flex items-center justify-between mb-2.5">
        <p className="flex items-center gap-1.5" style={{ color: T2, fontSize: 12.5, fontWeight: 600, margin: 0 }}>
          <Zap className="h-3.5 w-3.5" style={{ color: RED }} />{t('guestList.presets.applyTitle')}
        </p>
        <button type="button" onClick={onGoToTemplates} className="flex items-center gap-1" style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3, fontSize: 11.5, fontWeight: 600 }}>
          {t('guestList.presets.manage')}<ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {!hasAny ? (
        <button type="button" onClick={onGoToTemplates} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3, fontSize: 11.5, margin: 0, padding: 0, textAlign: 'left' }}>
          {t('guestList.presets.emptyClub')}
        </button>
      ) : (
        <div className="space-y-3">
          {clubPresets.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 mb-1.5" style={{ color: T3, fontSize: 11, fontWeight: 600 }}>
                <Users className="h-3 w-3" />{hasClubPart ? t('guestList.presets.clubRowApply') : t('guestList.presets.clubRowPublish')}
              </p>
              <div className="flex flex-wrap gap-2">
                {clubPresets.map(tpl => <Chip key={tpl.id} tpl={tpl} onClick={() => onApplyClub(tpl)} />)}
              </div>
            </div>
          )}
          {djPresets.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 mb-1.5" style={{ color: T3, fontSize: 11, fontWeight: 600 }}>
                <Music className="h-3 w-3" />{t('guestList.presets.djRow')}
              </p>
              <div className="flex flex-wrap gap-2">
                {djPresets.map(tpl => <Chip key={tpl.id} tpl={tpl} onClick={() => onDistributeDj(tpl)} />)}
              </div>
            </div>
          )}
          {promoterPresets.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 mb-1.5" style={{ color: T3, fontSize: 11, fontWeight: 600 }}>
                <Megaphone className="h-3 w-3" />{t('guestList.presets.promoterRow')}
              </p>
              <div className="flex flex-wrap gap-2">
                {promoterPresets.map(tpl => <Chip key={tpl.id} tpl={tpl} onClick={() => onPromoterPreset(tpl)} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
