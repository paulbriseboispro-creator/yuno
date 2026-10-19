/**
 * La carte « Premiers pas » de l'Accueil : intégrée à la page (jamais une
 * fenêtre au chargement), la progression, la prochaine étape dépliée avec son
 * bouton, les étapes faites avec leur résultat réel ; à droite la prochaine
 * soirée et « On le fait ensemble ? ». Une fois les cinq étapes faites : le
 * compte est prêt, et le vrai résultat (un acheteur venu d'un e-mail Yuno).
 */
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { ArrowLink, CtaButton, IconButton } from '@/crm/ui/kit';
import { EASE, reveal } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import type { GuideValue } from './GuideProvider';
import { mono, ProgressBar, StepList } from './guideUi';

const accent = { background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } as const;

function NightAside({ g }: { g: GuideValue }) {
  const { t, dLong } = useCrmT();
  const night = g.data.next_night;
  const holder = g.data.holder.is_me;
  const when = !night ? '' : night.days_to <= 0 ? t('yc.fs.night.when.today')
    : night.days_to === 1 ? t('yc.fs.night.when.tomorrow') : t('yc.fs.night.when.days', { n: night.days_to });
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 22, borderRadius: 22, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', alignSelf: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={mono}>{t('yc.fs.night.kick')}</span>
        {night ? (
          <>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21, letterSpacing: '-.025em', lineHeight: 1.15, textWrap: 'balance' }}>{night.title}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--sand-600)' }}>
              <Icon name="calendar" size={15} stroke={2.2} color="var(--sand-400)" />
              <span style={{ textTransform: 'capitalize' }}>{dLong(night.start_at)}</span>
              <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: night.days_to <= 3 ? 'var(--red-50)' : '#fff', color: night.days_to <= 3 ? 'var(--red-700)' : 'var(--sand-600)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', boxShadow: night.days_to <= 3 ? 'none' : 'inset 0 0 0 1px var(--sand-200)' }}>{when}</span>
            </span>
          </>
        ) : (
          <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.fs.night.none')}</span>
        )}
      </div>
      {holder && (
        <>
          <span style={{ height: 1, background: 'var(--sand-200)' }} />
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <YunitFace mood="content" size={40} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.fs.human.t')}</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.fs.human.d')}</span>
              <ArrowLink to={CRM_ROUTES.accountSection('support')} size={14}>{t('yc.fs.human.cta')}</ArrowLink>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function Finished({ g, intro }: { g: GuideValue; intro: boolean }) {
  const { t, tp, n } = useCrmT();
  const buyers = g.data.outcome?.buyers ?? 0;
  return (
    <section
      aria-label={t('yc.fs.name')}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 28px', padding: 'clamp(22px,2.6vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', ...reveal(intro, 160) }}
    >
      <span style={{ animation: `yc-ce-face 700ms ${EASE} both` }}><YunitFace mood="ravi" size={72} /></span>
      <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...mono, color: 'var(--green-700)' }}>{t('yc.fs.done.kick')}</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,2.6vw,30px)', letterSpacing: '-.03em', lineHeight: 1.1 }}>
          {t('yc.fs.done.t.a')}<span style={accent}>{t('yc.fs.done.t.accent')}</span>{t('yc.fs.done.t.b')}
        </h2>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 640, textWrap: 'pretty' }}>{t('yc.fs.done.s')}</p>
        <span style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14.5, fontWeight: 500, color: buyers > 0 ? 'var(--green-700)' : 'var(--sand-600)' }}>
          <span style={{ width: 30, height: 30, borderRadius: 99, display: 'grid', placeItems: 'center', background: buyers > 0 ? 'var(--green-50)' : 'var(--sand-50)', color: buyers > 0 ? 'var(--green-700)' : 'var(--sand-500)' }}>
            <Icon name="ticket" size={15} stroke={2.2} />
          </span>
          {buyers > 0 ? tp('yc.fs.outcome', buyers, { n: n(buyers) }) : t('yc.fs.outcome.wait')}
        </span>
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <ArrowLink to={CRM_ROUTES.review}>{t('yc.fs.review')}</ArrowLink>
        <CtaButton icon="check" onClick={() => g.act('finish')}>{t('yc.fs.finish')}</CtaButton>
      </div>
    </section>
  );
}

export function GuideCard({ g, intro }: { g: GuideValue; intro: boolean }) {
  const { t } = useCrmT();
  // La carte vit dans la colonne de l'Accueil (menu à gauche) : deux colonnes dès 1 100 px de fenêtre.
  const narrow = useNarrow(1100);
  if (g.complete) return <Finished g={g} intro={intro} />;
  const { done, total } = g.progress;
  return (
    <Hv
      as="section"
      aria-label={t('yc.fs.name')}
      style={{ position: 'relative', display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0,1fr) 320px', gap: narrow ? 20 : 28, padding: 'clamp(22px,2.6vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', ...reveal(intro, 160) }}
      hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-sm)' }}
    >
      <IconButton name="x" label={t('yc.fs.dismiss')} onClick={() => g.act('dismiss')} style={{ position: 'absolute', top: 14, right: 14 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 32 }}>
          <span style={mono}>{t('yc.fs.name')} · {t('yc.fs.progress', { done, total })}</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,2.6vw,30px)', letterSpacing: '-.03em', lineHeight: 1.1 }}>
            {t('yc.fs.title.a')}<span style={accent}>{t('yc.fs.title.accent')}</span>{t('yc.fs.title.b')}
          </h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 620, textWrap: 'pretty' }}>{t('yc.fs.sub')}</p>
        </div>
        <ProgressBar done={done} total={total} />
        <StepList g={g} />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px', paddingTop: 2 }}>
          <Hv as="button" type="button" onClick={() => g.act('snooze')} style={{ border: 0, background: 'none', padding: '6px 0', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-500)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
            {t('yc.fs.snooze')}
          </Hv>
          <Hv as="button" type="button" onClick={() => g.act('dismiss')} style={{ border: 0, background: 'none', padding: '6px 0', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-500)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
            {t('yc.fs.dismiss')}
          </Hv>
        </div>
      </div>
      <NightAside g={g} />
    </Hv>
  );
}
