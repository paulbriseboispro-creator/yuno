import { useLanguage } from '@/contexts/LanguageContext';
import { KIT } from '@/components/analytics/kitFormat';

/** Une partie d'une soirée à plusieurs : pastille + nom + son rôle, et « vous » pour l'appelant. */
export function PartyChip({ name, avatar, role, mine }: {
  name: string; avatar: string | null; role: 'lead' | 'partner' | 'cohost'; mine?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar
        ? <img src={avatar} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
        : <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: 'rgb(var(--ink)/0.08)', color: KIT.T2 }}>{name.slice(0, 1).toUpperCase()}</span>}
      <span className="min-w-0">
        <span className="block truncate" style={{ color: KIT.T1, fontSize: 13, fontWeight: 560 }}>
          {name}
          {mine && <span className="ml-1.5 rounded-full px-1.5 py-0.5 align-middle" style={{ background: 'rgba(232,25,44,0.12)', color: 'var(--acc-ff5c63)', fontSize: 10, fontWeight: 650 }}>{t('evl.party.you')}</span>}
        </span>
        <span className="block" style={{ color: KIT.T3, fontSize: 11 }}>{t(`evl.party.role.${role}`)}</span>
      </span>
    </span>
  );
}
