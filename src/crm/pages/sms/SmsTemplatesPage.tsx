/**
 * SMS · Modèles (maquette « SMS Modeles.dc.html ») : `/crm/sms/templates`.
 *
 * Huit messages courts, déjà écrits, rangés par objectif (`?g=`). Chaque
 * carte montre le téléphone, la longueur et, si le modèle a déjà servi, le
 * taux de clic de vos SMS partis de lui. « Utiliser » ouvre le composeur
 * (`?t=<modèle>`, et `&event=` quand on vient d'une soirée).
 */
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { useNights } from '@/crm/data/nights';
import { useSmsCampaigns, useSmsSettings } from '@/crm/data/sms';
import { rate } from '@/crm/lib/emails';
import { countSms, defaultSender, SAMPLE_LINK, SMS_GOALS, SMS_TEMPLATES, smsFinalText, type SmsGoal } from '@/crm/lib/sms';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SmsShell } from './SmsShell';
import { SmsPhone, SmsPhoneCrop } from './SmsPhone';

const ARROW = 'M5 12h14M13 6l6 6-6 6';

export default function SmsTemplatesPage() {
  const { t, tp, n, pct, lang } = useCrmT();
  const caps = useCrmCaps();
  const { space } = useCrmScope();
  const [sp, setSp] = useSearchParams();
  const goal = (SMS_GOALS as string[]).includes(sp.get('g') ?? '') ? (sp.get('g') as SmsGoal) : null;
  const eventId = sp.get('event');
  const camps = useSmsCampaigns();
  const settings = useSmsSettings();
  const nights = useNights();
  const night = useMemo(() => {
    const list = nights.data?.nights ?? [];
    return list.find((x) => x.id === eventId) ?? list.filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null;
  }, [nights.data, eventId]);
  const sender = settings.data?.sender_name || defaultSender(space.name);
  const drafts = (camps.data?.campaigns ?? []).filter((c) => c.status === 'draft').length;

  // Vos envois partis de chaque modèle : clics sur SMS remis.
  const usage = useMemo(() => {
    const m = new Map<string, { n: number; d: number; c: number }>();
    for (const c of camps.data?.campaigns ?? []) {
      if (!c.tpl || !c.stats) continue;
      const x = m.get(c.tpl) ?? { n: 0, d: 0, c: 0 };
      x.n += 1; x.d += c.stats.delivered; x.c += c.stats.clicked;
      m.set(c.tpl, x);
    }
    return m;
  }, [camps.data]);

  const list = SMS_TEMPLATES.filter((x) => !goal || x.goal === goal);
  const title = <>{t('yc.sm.tp.h.a')}<span className="yc-accent-word">{t('yc.sm.tp.h.b')}</span>{t('yc.sm.tp.h.c')}</>;

  return (
    <SmsShell tab="templates" title={title} sub={t('yc.sm.tp.sub')} drafts={drafts} hideNew>
      <div role="group" aria-label={t('yc.sm.tp.goals')} className="yc-noscroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', animation: `yc-rise 800ms ${EASE} 400ms both` }}>
        {[null, ...SMS_GOALS].map((g) => {
          const on = goal === g;
          return (
            <Hv
              key={g ?? 'all'} as="button" type="button" aria-pressed={on}
              onClick={() => setSp((prev) => { const x = new URLSearchParams(prev); if (g) x.set('g', g); else x.delete('g'); return x; }, { replace: true })}
              style={{ flex: 'none', height: 40, padding: '0 18px', borderRadius: 99, border: on ? 0 : '1px solid var(--sand-200)', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              hover={{ background: on ? 'var(--ink)' : 'var(--paper)' }}
            >
              {g ? t(`yc.sm.goal.${g}`) : t('yc.sm.tp.all')}
            </Hv>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 18 }}>
        {list.map((x, i) => {
          const body = t(`yc.sm.tpl.${x.id}.body`);
          const text = smsFinalText(body, { sender, lang, vals: { 'prénom': t('yc.sm.sample.name'), nom_club: space.name, 'soirée': night?.title ?? t('yc.sm.sample.night'), lien: SAMPLE_LINK } });
          const k = countSms(text);
          const u = usage.get(x.id);
          const to = `${CRM_ROUTES.smsCompose('new')}?t=${x.id}${night && eventId ? `&event=${night.id}` : ''}`;
          return (
            <article key={x.id} style={{ display: 'flex', flexDirection: 'column', borderRadius: 24, overflow: 'hidden', background: '#fff', border: '1px solid var(--sand-200)', animation: `yc-pop 600ms ${EASE} ${440 + i * 60}ms both`, transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}>
              <div style={{ position: 'relative' }}>
                <SmsPhoneCrop h={236}>
                  <SmsPhone text={text} sender={sender} size="sm" today={t('yc.sm.ph.today')} placeholder={t('yc.sm.ph.empty')} multi={k.parts > 1 ? t('yc.sm.ph.multi', { n: k.parts }) : undefined} />
                </SmsPhoneCrop>
                <span style={{ position: 'absolute', top: 14, left: 14, height: 26, padding: '0 10px', borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-xs)', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t(`yc.sm.goal.${x.goal}`)}</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 20px 18px' }}>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em' }}>{t(`yc.sm.tpl.${x.id}.name`)}</b>
                <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.sm.tpl.${x.id}.desc`)}</span>
                <span style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 4 }}>{tp('yc.sm.tp.len', k.length, { n: n(k.length) })} · {tp('yc.sm.tp.parts', k.parts, { n: k.parts })}</span>
                <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid var(--sand-100)' }}>
                  <span style={{ fontSize: 13.5, color: u ? 'var(--ink)' : 'var(--sand-500)' }}>
                    {u ? tp('yc.sm.tp.used', u.n, { p: pct((rate(u.c, u.d) ?? 0) * 100), n: n(u.n) }) : t('yc.sm.tp.unused')}
                  </span>
                  {caps.write && (
                    <Hv as={Link} to={to} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 600, color: 'var(--red-600)', textDecoration: 'none', whiteSpace: 'nowrap' }} hover={{ color: 'var(--red-700)', textDecoration: 'none' }}>
                      {t('yc.sm.tp.use')}<Icon d={ARROW} size={15} stroke={2.4} />
                    </Hv>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </SmsShell>
  );
}
