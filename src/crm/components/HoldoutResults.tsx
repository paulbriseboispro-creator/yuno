/**
 * « Ce que vos envois ont vraiment rapporté » : pour chaque envoi qui a gardé
 * une part non contactée (migration 20261013120000), les acheteurs des deux
 * groupes et ce qu'on peut en conclure. Sous 10 personnes par groupe ou sans
 * différence nette (|z| < 2), l'écran le dit : jamais un gain inventé.
 * Se tait quand il n'y a rien à montrer.
 */
import { useCrmT } from '@/crm/i18n';
import { useHoldoutOverview } from '@/crm/data/holdout';
import { holdoutVerdict, type HoldoutSend } from '@/crm/lib/holdout';

type T = ReturnType<typeof useCrmT>;

export function HoldoutResults({ eventId, recipes }: { eventId?: string; recipes?: boolean }) {
  const T = useCrmT();
  const q = useHoldoutOverview();
  const sends = (q.data?.sends ?? []).filter((s) => (recipes ? s.channel === 'recipe' : s.channel !== 'recipe' && (!eventId || s.event_id === eventId)));
  if (!sends.length) return null;
  const { t } = T;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15.5, fontWeight: 600 }}>{t('yc.hold.res.t')}</span>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.hold.res.s')}</span>
      </div>
      {sends.map((s) => <Row key={`${s.channel}:${s.id}`} s={s} T={T} />)}
    </section>
  );
}

function Row({ s, T }: { s: HoldoutSend; T: T }) {
  const { t, tp, n, dShort } = T;
  const v = holdoutVerdict(s);
  const name = s.channel === 'recipe' ? t(`yc.au.r.${s.id}.name`) : (s.label ?? '');
  const tone = v === 'gain' ? 'var(--green-700)' : v === 'loss' ? 'var(--amber-700)' : 'var(--sand-600)';
  const group = (b: number, total: number, who: string) => tp('yc.hold.res.buyers', b, { b: n(b), n: n(total), who: t(who) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 10, borderTop: '1px solid var(--sand-100)' }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 10px', fontSize: 14.5, fontWeight: 600 }}>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{name}</span>
        <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 500, color: 'var(--sand-500)' }}>
          {s.channel === 'recipe' ? dShort(s.sent_at) : `${t(`yc.hold.res.ch.${s.channel}`)} · ${dShort(s.sent_at)}`}
        </span>
      </span>
      <span style={{ fontSize: 13.5, color: 'var(--sand-700)', fontVariantNumeric: 'tabular-nums' }}>
        {group(s.contacted.buyers, s.contacted.n, 'yc.hold.res.contacted')} · {group(s.control.buyers, s.control.n, 'yc.hold.res.control')}
      </span>
      <span style={{ fontSize: 13.5, color: tone, fontWeight: v === 'gain' || v === 'loss' ? 600 : 500 }}>
        {t(`yc.hold.res.v.${v}`, { x: n(Math.round(s.extra ?? 0)) })}
      </span>
    </div>
  );
}
