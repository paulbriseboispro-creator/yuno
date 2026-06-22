import { Plus, Pencil, Trash2, Star, Clock, Wine, Eye, FolderOpen } from 'lucide-react';
import type { GuestListTemplate, TemplateHolderType } from '@/hooks/useGuestListTemplates';
import { RED, T1, T2, T3, BORDER, F_BORDER, INNER_BG, TILE_BG, CARD_BG, CARD_SHADOW } from './ui';

interface PresetsManagerProps {
  templates: GuestListTemplate[];
  onNew: () => void;
  onEdit: (tpl: GuestListTemplate) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}

const GROUPS: TemplateHolderType[] = ['club', 'dj', 'promoter'];

/** The "Templates" tab — create and manage reusable guest-list presets, grouped by type. */
export function PresetsManager({ templates, onNew, onEdit, onDelete, t }: PresetsManagerProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 style={{ color: T1, fontSize: 15, fontWeight: 600, margin: 0 }}>{t('guestList.presets.tabTitle')}</h2>
          <p style={{ color: T3, fontSize: 12, margin: 0 }}>{t('guestList.presets.tabSubtitle')}</p>
        </div>
        <button type="button" onClick={onNew} className="flex items-center gap-1.5"
          style={{ background: RED, border: 'none', borderRadius: 10, padding: '9px 14px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Plus className="h-4 w-4" />{t('guestList.presets.new')}
        </button>
      </div>

      {templates.length === 0 ? (
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '40px 20px', textAlign: 'center' }}>
          <FolderOpen className="h-10 w-10 mx-auto mb-3" style={{ color: T3, opacity: 0.4 }} />
          <p style={{ color: T2, fontSize: 14, marginBottom: 4 }}>{t('guestList.presets.emptyTitle')}</p>
          <p style={{ color: T3, fontSize: 12.5, marginBottom: 16 }}>{t('guestList.presets.emptyDesc')}</p>
          <button type="button" onClick={onNew} className="inline-flex items-center gap-1.5"
            style={{ background: RED, border: 'none', borderRadius: 10, padding: '10px 16px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <Plus className="h-4 w-4" />{t('guestList.presets.new')}
          </button>
        </div>
      ) : (
        GROUPS.map(group => {
          const items = templates.filter(tpl => tpl.holder_type === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="space-y-2">
              <p style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
                {t(`guestList.holderType.${group}`)}
              </p>
              {items.map(tpl => (
                <div key={tpl.id} className="flex items-center gap-3" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '14px 16px' }}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>
                      {tpl.is_default && <Star className="h-3.5 w-3.5 flex-none" style={{ color: RED }} />}{tpl.name}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap mt-1" style={{ color: T3, fontSize: 11.5 }}>
                      <span style={{ color: T2, fontWeight: 600 }}>{tpl.quota} {t('guestList.presets.spots')}</span>
                      {(tpl.quota_female !== null || tpl.quota_male !== null) && <span>· ♀{tpl.quota_female ?? 0}/♂{tpl.quota_male ?? 0}</span>}
                      <span className="flex items-center gap-1">· <Clock className="h-3 w-3" />{tpl.free_before_time?.substring(0, 5)}</span>
                      {tpl.includes_drink && <span className="flex items-center gap-1">· <Wine className="h-3 w-3" /></span>}
                      {tpl.visible_on_club_page && <span className="flex items-center gap-1">· <Eye className="h-3 w-3" /></span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => onEdit(tpl)} aria-label="edit"
                    style={{ width: 36, height: 36, background: INNER_BG, border: `1px solid ${F_BORDER}`, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: T2 }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => onDelete(tpl.id)} aria-label="delete"
                    style={{ width: 36, height: 36, background: 'rgba(255,92,99,0.10)', border: '1px solid rgba(255,92,99,0.25)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#FF5C63' }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
