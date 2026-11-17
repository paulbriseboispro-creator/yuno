/**
 * Raccourcis clavier de l'admin (v3, façon Linear) :
 *   g puis une lettre  change de rubrique ;
 *   [                  replie / déplie la barre latérale ;
 *   ?                  ouvre cette aide.
 * Les raccourcis d'une liste (j / k / e / l / entrée) vivent dans la page qui
 * a une file ; ils sont listés ici pour qu'on les trouve.
 * Jamais quand on écrit dans un champ, jamais avec ⌘ / Ctrl / Alt.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '../ui/Overlay';
import { useAdminT } from '../ui/i18n';
import { GO_KEYS, isTyping } from './keys';

export function useGlobalShortcuts({ onHelp, onRail }: { onHelp: () => void; onRail: () => void }) {
  const navigate = useNavigate();
  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (pendingG.current != null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const go = GO_KEYS.find((g) => g.key === e.key.toLowerCase());
        if (go) { e.preventDefault(); navigate(go.to); }
        return;
      }
      if (e.key === 'g') { pendingG.current = window.setTimeout(() => { pendingG.current = null; }, 1200); return; }
      if (e.key === '?') { e.preventDefault(); onHelp(); return; }
      if (e.key === '[') { e.preventDefault(); onRail(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [navigate, onHelp, onRail]);
}

export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useAdminT();
  const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
    { title: t('adm.kb.go'), rows: GO_KEYS.map((g) => [`g ${g.key}`, t(`adm.nav2.${g.rubric}`)]) },
    { title: t('adm.kb.list'), rows: [['j', t('adm.kb.next')], ['k', t('adm.kb.prev')], ['↵', t('adm.kb.open')], ['e', t('adm.kb.done')], ['l', t('adm.kb.later')]] },
    { title: t('adm.kb.app'), rows: [['⌘ K', t('adm.kb.search')], ['[', t('adm.kb.rail')], ['?', t('adm.kb.help')]] },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('adm.kb.title')} description={t('adm.kb.sub')}>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-2">
            <span className="a-kicker">{g.title}</span>
            <ul className="flex flex-col gap-1.5">
              {g.rows.map(([k, label]) => (
                <li key={k} className="flex items-center gap-2 text-[13px]">
                  <span className="a-kbd min-w-[2.4rem] text-center">{k}</span>
                  <span className="a-t2">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
