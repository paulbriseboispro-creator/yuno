/**
 * Admin CRM › Vente › Comptes cibles (« Qui n'a pas encore été approché ? ») :
 * les clubs et organisateurs SANS espace CRM des villes où Yuno CRM a déjà un
 * compte, lus en base (crm_admin_targets). « Ajouter au pipeline » crée un
 * prospect (seul endroit où un contact est écrit) ; rien n'est envoyé.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminScope } from '@/components/admin/AdminScope';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { rpc } from '@/crm/lib/rpc';
import { Segmented, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { useAdminGesture } from '../data';
import { EmptyNote, RowLine, Section, card, twoCols } from '../ui';

interface Targets {
  at: string;
  cities: { city: string; clients: number; total: number; approached: number; pipe: number }[];
  targets: { key: string; name: string; city: string; kind: 'club' | 'organizer' | 'association'; has_email: boolean; has_phone: boolean; stage: string | null }[];
}

export function useAdminTargets() {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'targets', includeDemo], staleTime: 30_000, queryFn: () => rpc<Targets>('crm_admin_targets', { p_include_demo: includeDemo }) });
}

export default function TargetsTab() {
  const { t, n } = useCrmT();
  const toast = useCrmToast();
  const q = useAdminTargets();
  const add = useAdminGesture<{ p_key: string }>('crm_admin_target_add');
  const [city, setCity] = useState<string | null>(null);
  const [tf, setTf] = useState<'free' | 'all'>('free');
  const list = useMemo(() => (q.data?.targets ?? []).filter((x) => (!city || x.city.toLowerCase() === city.toLowerCase()) && (tf === 'all' || !x.stage)), [q.data, city, tf]);
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data) return <Skel h={420} r={28} />;
  const d = q.data;
  if (d.cities.length === 0) return <Section title={t('adm.crm.tg.title')} sub={t('adm.crm.tg.sub')}><EmptyNote>{t('adm.crm.tg.noCity')}</EmptyNote></Section>;
  return (
    <div style={twoCols}>
      <Section title={t('adm.crm.tg.cities')} sub={t('adm.crm.tg.citiesSub')} pad={24} gap={4}>
        {d.cities.map((c, i) => {
          const on = city === c.city;
          const tot = Math.max(1, c.total);
          return (
            <Hv key={c.city} as="button" type="button" onClick={() => setCity(on ? null : c.city)}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 12px', margin: '0 -12px', border: 0, borderTop: i ? '1px solid var(--sand-100)' : 0, borderRadius: 12, background: on ? 'var(--red-50)' : 'transparent', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
              hover={{ background: on ? 'var(--red-50)' : 'var(--sand-50)' }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14.5 }}>
                <b>{c.city}</b>
                <span style={{ color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>{t('adm.crm.tg.ratio', { a: c.approached, n: c.total })}</span>
              </span>
              <span style={{ display: 'flex', height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                <i style={{ width: `${(c.approached / tot) * 100}%`, background: 'var(--gradient-brand)' }} />
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('adm.crm.tg.cityLine', { clients: c.clients, pipe: c.pipe })}</span>
            </Hv>
          );
        })}
      </Section>
      <section style={{ ...card, borderRadius: 28, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{city ? t('adm.crm.tg.in', { city }) : t('adm.crm.tg.allCities')}</h2>
          <Segmented<'free' | 'all'> value={tf} onChange={setTf} options={[{ value: 'free', label: t('adm.crm.tg.free') }, { value: 'all', label: t('adm.crm.tg.all') }]} />
        </div>
        {list.length === 0 && <EmptyNote>{t('adm.crm.tg.none')}</EmptyNote>}
        {list.slice(0, 200).map((x, i) => (
          <RowLine key={x.key} first={i === 0}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</b>
              <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{[x.city, t(`adm.crm.type.${x.kind}`), x.has_email || x.has_phone ? t('adm.crm.tg.reachable') : t('adm.crm.tg.noContact')].join(' · ')}</span>
            </span>
            {x.stage ? (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sand-600)' }}>{t(`adm.crm.tg.stage.${x.stage}`)}</span>
            ) : (
              <Hv as="button" type="button" disabled={add.isPending}
                onClick={() => add.mutate({ p_key: x.key }, {
                  onSuccess: () => { toast(t('adm.crm.tg.added', { name: x.name })); void q.refetch(); },
                  onError: (e) => toast(t((e as { code?: string }).code === '23505' ? 'adm.crm.tg.dup' : 'adm.crm.ac.err.x')),
                })}
                style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
                hover={{ background: 'var(--sand-50)' }}>{t('adm.crm.tg.add')}</Hv>
            )}
          </RowLine>
        ))}
        {list.length > 200 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.tg.more', { n: n(list.length - 200) })}</span>}
      </section>
    </div>
  );
}
