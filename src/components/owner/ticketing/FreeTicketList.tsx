import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Layers, ListPlus, Pencil, Plus, Shapes, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TicketRound } from '@/types/ticketing';
import type { TicketGroup } from '@/lib/ticketGroups';
import { formatMoneyAuto } from '@/lib/money';
import { BORDER, C_FAINT, INNER_CARD, LABEL, RED, T1, T2, T3 } from './ticketing-ui';

interface FreeTicketListProps {
  /** Les billets de la soirée, dans l'ordre de la page publique. */
  tickets: TicketRound[];
  groups: TicketGroup[];
  /** Une ligne de billet ; `prev` / `next` = voisins dans SA section (pour monter / descendre). */
  renderTicket: (ticket: TicketRound, prev: TicketRound | null, next: TicketRound | null) => ReactNode;
  onCreateGroup: () => void;
  onEditGroup: (group: TicketGroup) => void;
  onDeleteGroup: (group: TicketGroup) => void;
  onMoveGroup: (group: TicketGroup, dir: -1 | 1) => void;
  /** Masque / affiche le pack côté acheteurs (ticket_groups.hidden). */
  onToggleGroupHidden: (group: TicketGroup) => void;
  /** Nouvel ordre complet des packs (glisser-déposer). */
  onReorderGroups: (orderedIds: string[]) => void;
  onAddTicketInGroup: (group: TicketGroup) => void;
  /** Ouvre le choix d'un billet déjà créé à ranger dans ce pack. */
  onAddExistingTicket: (group: TicketGroup) => void;
}

// La liste de la billetterie libre, rangée comme la page de choix : les
// billets hors pack d'abord, puis chaque pack (nom, phrase, ses billets).
// Un pack se crée d'un bouton ; un billet y entre par « Ajouter un billet dans
// ce pack » ou par le choix « Pack » de sa fiche.
export function FreeTicketList({
  tickets, groups, renderTicket, onCreateGroup, onEditGroup, onDeleteGroup, onMoveGroup, onToggleGroupHidden, onReorderGroups, onAddTicketInGroup, onAddExistingTicket,
}: FreeTicketListProps) {
  const { t } = useLanguage();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const known = new Set(groups.map(g => g.id));
  const loose = tickets.filter(r => !r.groupId || !known.has(r.groupId));
  const orderedGroups = [...groups].sort((a, b) => a.position - b.position);

  const section = (list: TicketRound[]) => list.map((r, i) => (
    <div key={r.id}>{renderTicket(r, list[i - 1] ?? null, list[i + 1] ?? null)}</div>
  ));

  const drop = (targetId: string) => {
    if (dragId && dragId !== targetId) {
      const ids = orderedGroups.map(g => g.id).filter(id => id !== dragId);
      ids.splice(ids.indexOf(targetId) + (orderedGroups.findIndex(g => g.id === dragId) < orderedGroups.findIndex(g => g.id === targetId) ? 1 : 0), 0, dragId);
      onReorderGroups(ids);
    }
    setDragId(null); setOverId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2" style={{ ...LABEL, fontSize: 11, color: T3 }}>
          <Shapes className="h-3.5 w-3.5" />
          {t('tickets.free.listTitle')}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCreateGroup}
          className="h-8 px-2.5 text-[12.5px] hover:bg-white/[0.06]"
          style={{ color: T1 }}
        >
          <Layers className="h-3.5 w-3.5 mr-1.5" />{t('tickets.packs.new')}
        </Button>
      </div>

      {groups.length === 0 && tickets.length > 1 && (
        <p style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>{t('tickets.packs.emptyHint')}</p>
      )}

      {loose.length > 0 && (
        <div className="space-y-2">
          {groups.length > 0 && <div style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.packs.loose')}</div>}
          {section(loose)}
        </div>
      )}

      {orderedGroups.map((group, gi) => {
        const inPack = tickets.filter(r => r.groupId === group.id);
        const onSale = group.hidden ? [] : inPack.filter(r => !r.manuallySoldOut && r.ticketsSold < r.maxTickets && r.isActive && !r.hidden);
        const from = onSale.length ? Math.min(...onSale.map(r => r.price)) : null;
        return (
          <div
            key={group.id}
            className="p-3 space-y-2 transition-opacity"
            style={{ ...INNER_CARD, opacity: dragId === group.id ? 0.5 : 1, outline: overId === group.id && dragId !== group.id ? `2px solid ${RED}` : undefined }}
            draggable={orderedGroups.length > 1}
            onDragStart={(e) => { setDragId(group.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(group.id); } }}
            onDragLeave={() => setOverId(cur => (cur === group.id ? null : cur))}
            onDrop={(e) => { e.preventDefault(); drop(group.id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
          >
            <div className="flex items-start gap-2">
              {orderedGroups.length > 1 && (
                <GripVertical className="h-4 w-4 flex-none mt-0.5 cursor-grab" style={{ color: T3 }} aria-hidden />
              )}
              <div className="flex flex-col flex-none -my-0.5">
                <button type="button" disabled={gi === 0} onClick={() => onMoveGroup(group, -1)} aria-label={t('tickets.packs.moveUp')} title={t('tickets.packs.moveUp')} className="p-1 rounded disabled:opacity-20 hover:bg-white/[0.06]" style={{ color: T3 }}>
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" disabled={gi === orderedGroups.length - 1} onClick={() => onMoveGroup(group, 1)} aria-label={t('tickets.packs.moveDown')} title={t('tickets.packs.moveDown')} className="p-1 rounded disabled:opacity-20 hover:bg-white/[0.06]" style={{ color: T3 }}>
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Layers className="h-3.5 w-3.5 flex-none" style={{ color: RED }} />
                  <span className="uppercase [overflow-wrap:anywhere]" style={{ color: group.hidden ? T3 : T1, fontSize: 13.5, fontWeight: 650, letterSpacing: '0.03em' }}>{group.name}</span>
                  {group.hidden && (
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5" style={{ ...LABEL, fontSize: 10, color: T2, background: C_FAINT, border: `1px solid ${BORDER}` }}>
                      <EyeOff className="h-3 w-3" />{t('tickets.packs.hiddenBadge')}
                    </span>
                  )}
                </div>
                {group.hidden && (
                  <p className="mt-1" style={{ color: T2, fontSize: 12, lineHeight: 1.45 }}>{t('tickets.packs.hiddenHint')}</p>
                )}
                <p className="mt-1 tabular-nums" style={{ color: T3, fontSize: 12 }}>
                  {t('tickets.packs.count').replace('{n}', String(inPack.length))}
                  {from !== null && <> · {t('ticketSel.packFrom').replace('{price}', formatMoneyAuto(from))}</>}
                </p>
                {group.description && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-line" style={{ color: T2, fontSize: 12, lineHeight: 1.45 }}>{group.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-none">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onToggleGroupHidden(group)}
                  className="hover:bg-white/[0.06]"
                  style={{ color: group.hidden ? T1 : T2 }}
                  aria-label={group.hidden ? t('tickets.packs.show') : t('tickets.packs.hide')}
                  title={group.hidden ? t('tickets.packs.show') : t('tickets.packs.hide')}
                >
                  {group.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => onEditGroup(group)} className="hover:bg-white/[0.06]" style={{ color: T2 }} aria-label={t('tickets.packs.editTitle')}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => onDeleteGroup(group)} className="hover:bg-[rgba(232,25,44,0.12)]" style={{ color: RED }} aria-label={t('tickets.packs.delete')}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {inPack.length > 0
              ? <div className="space-y-2">{section(inPack)}</div>
              : <p style={{ color: T3, fontSize: 12 }}>{t('tickets.packs.emptyPack')}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 text-[12.5px]"
                onClick={() => onAddTicketInGroup(group)}
                style={{ background: C_FAINT, border: `1px dashed ${BORDER}`, color: T2 }}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />{t('tickets.packs.addTicket')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 text-[12.5px]"
                disabled={tickets.every(r => r.groupId === group.id)}
                onClick={() => onAddExistingTicket(group)}
                style={{ background: C_FAINT, border: `1px dashed ${BORDER}`, color: T2 }}
              >
                <ListPlus className="h-3.5 w-3.5 mr-1.5" />{t('tickets.packs.addExisting')}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
