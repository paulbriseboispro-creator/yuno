/**
 * Pages d'inscription › « C'est en ligne ! » (`/crm/signup-pages/:id/published`)
 * — design « Pages inscription », vue PUBLIÉE, à l'identique : le lien de la
 * page et son QR (réels), « Récupérer mes liens et QR », « Voir la page »,
 * « Retour à la liste ». Une page programmée dit qu'elle s'ouvrira toute
 * seule ; un brouillon enregistré par un membre d'équipe attend le titulaire.
 * L'aperçu plein écran vit ici aussi (`SignupPreview`).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { Portal, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmToast } from '@/crm/ui/toast';
import { signupUrl, useSignupPages } from '@/crm/data/signupPages';
import type { SignupPageRow } from '@/crm/data/signupPages';
import InscriptionPhone from '@/crm/signup/InscriptionPhone';
import type { PhoneScene } from '@/crm/signup/InscriptionPhone';
import { SP_ROUTES, SpMain, copyText } from './SignupPagesPage';
import { D_ARROW, D_X, Seg, SpSvg, anim, monoLabel, pageCfg } from './signupUi';
import { QrSvg } from './SignupQr';

export default function SignupDonePage() {
  const { id = '' } = useParams();
  const T = useCrmT();
  const { t } = T;
  const { space } = useCrmScope();
  const nav = useNavigate();
  const toast = useCrmToast();
  const q = useSignupPages();
  const [pv, setPv] = useState(false);
  if (q.isError && !q.data) return <SpMain><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></SpMain>;
  if (!q.data) return <SpMain><Skel h={520} r={28} /></SpMain>;
  const p = q.data.pages.find((x) => x.id === id);
  if (!p) return <SpMain><b>{t('yc.sp.f.notFound')}</b></SpMain>;
  const kind = p.state === 'draft' ? 'Draft' : p.state === 'scheduled' ? 'Scheduled' : 'Published';
  const url = signupUrl(p.slug);
  const copy = () => { copyText(url); toast(t('yc.sp.copied')); };

  return (
    <SpMain>
      <section style={{ alignSelf: 'center', width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 24, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.08),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-md)', animation: anim('sp-pop', 500), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 20px' }}>
          <YunitFace mood="ravi" size={64} />
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: "'Geist Mono'", fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t(`yc.sp.d.k${kind}`)}</span>
            <h1 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{t(`yc.sp.d.t${kind}`)}</h1>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' } as React.CSSProperties}>{t(`yc.sp.d.x${kind}`)}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px 28px', alignItems: 'center', padding: 20, borderRadius: 20, background: 'var(--sand-50)' }}>
          <span style={{ flex: 'none', width: 132, height: 132, padding: 10, boxSizing: 'border-box', borderRadius: 16, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}><QrSvg url={url} size={112} /></span>
          <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.sp.d.link')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 14px', borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
              <span style={{ flex: 1, minWidth: 0, fontFamily: "'Geist Mono'", fontSize: 14, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{url.replace(/^https?:\/\//, '')}</span>
              <Hv as="button" type="button" onClick={copy} style={{ flex: 'none', height: 38, padding: '0 14px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ background: 'var(--sand-700)' }}>{t('yc.sp.d.copy')}</Hv>
            </div>
            <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.sp.d.places')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Hv as="button" type="button" onClick={() => nav(SP_ROUTES.page(p.id, 'share'))}
            style={{ height: 46, padding: '0 6px 0 22px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer' }}
            hover={{ filter: 'brightness(1.05)' }} active={{ transform: 'scale(.97)' }}>
            {t('yc.sp.d.share')}<span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><SpSvg d={D_ARROW} size={16} sw={2.4} /></span>
          </Hv>
          <Hv as="button" type="button" onClick={() => setPv(true)} style={{ height: 46, padding: '0 20px', borderRadius: 99, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>{t('yc.sp.d.view')}</Hv>
          <Hv as="button" type="button" onClick={() => nav(SP_ROUTES.list)} style={{ height: 46, padding: '0 16px', border: 0, background: 'none', fontSize: 15, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>{t('yc.sp.d.toList')}</Hv>
        </div>
      </section>
      {pv && <SignupPreview page={p} host={space.name} logo={space.logoUrl} onClose={() => setPv(false)} />}
    </SpMain>
  );
}

/** L'aperçu plein écran : la page, « C'est noté », le jour J, l'e-mail et le SMS. */
export function SignupPreview({ page, host, logo, title, onClose }: {
  page: SignupPageRow; host: string; logo?: string | null;
  /** Titre du panneau (ex. « Proposition de Claude ») ; sinon « Aperçu ». */
  title?: string;
  onClose: () => void;
}) {
  const T = useCrmT();
  const { t } = T;
  const toast = useCrmToast();
  const [tab, setTab] = useState<PhoneScene>('page');
  const tabs: { v: PhoneScene; l: string }[] = [
    { v: 'page', l: t('yc.sp.w.tab.page') }, { v: 'noted', l: t('yc.sp.w.tab.noted') },
    ...((page.kind === 'prevente' || page.kind === 'attente') ? [{ v: 'open' as PhoneScene, l: t('yc.sp.w.tab.open') }] : []),
    { v: 'email', l: t('yc.sp.w.chEmail') }, { v: 'sms', l: t('yc.sp.w.chSms') },
  ];
  const cfg = pageCfg(page, host, t, T.locale, { logo });
  const msg = page.relance?.open?.msg || undefined;
  return (
    <Portal>
      <div className="sp-root" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(28,21,23,.5)', display: 'grid', placeItems: 'center', padding: 16, boxSizing: 'border-box' }}>
        <div role="dialog" aria-label={t('yc.sp.pv.label')} onClick={(e) => e.stopPropagation()}
          style={{ maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '22px 20px 20px', borderRadius: 28, background: 'var(--sand-50)', boxShadow: 'var(--shadow-md)', animation: 'sp-pop 280ms cubic-bezier(.22,1,.36,1) both', fontFamily: 'Geist,system-ui,sans-serif' }}>
          <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={monoLabel}>{title ?? t('yc.sp.pv.title')}</span>
            <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.sp.pv.close')} style={{ width: 34, height: 34, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
              <SpSvg d={D_X} size={14} sw={2.4} />
            </Hv>
          </div>
          <Seg aria={t('yc.sp.pv.scene')} value={tab} onChange={setTab} wrap items={tabs} style={{ justifyContent: 'center' }} />
          <InscriptionPhone cfg={cfg} scene={tab} scale={0.9} msgText={tab === 'email' || tab === 'sms' ? msg : undefined} onToast={toast} />
        </div>
      </div>
    </Portal>
  );
}
