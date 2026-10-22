/**
 * Accueil de l'écran Imports de Yuno Tickets (copie de
 * src/crm/pages/imports/ImportsHome.tsx) : ce que les ventes Yuno apportent
 * à la base (à la place de la synchro Shotgun : ici, chaque vente entre seule),
 * l'import de fichier (dépôt, modèle), « Zéro doublon » avec son testeur, et
 * « Derniers ajouts » (fichiers, annulation).
 */
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Skel } from '@/tickets/analytics/kit';
import { LoadError } from '@/tickets/analytics/LoadError';
import { useTixToast } from '@/tickets/clients/toast';
import { EASE, SPRING, reveal } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixScope, useTixCaps } from '@/tickets/clients/scope';
import { useTixClientRoutes } from '@/tickets/clients/routes';
import { downloadText } from '@/crm/lib/csv';
import { TEMPLATE_CSV, isExampleAddress, normEmail, normTel } from '@/crm/lib/fileImport';
import { isValidEmail } from '@/lib/emailImport';
import { checkAgainstBase, commitImport, undoImport, useInvalidateBase } from '@/tickets/clients/data/imports';
import type { ImportsOverview, ImportRow } from '@/tickets/clients/data/imports';
import type { BaseMatch } from '@/crm/lib/fileImport';
import { NIGHT_BG, useZeroRules } from './zeroRules';
import yunoIcon from '@/crm/assets/yuno-app-icon.webp';

export function NightPanelRules({ rules, small }: { rules: { b: string; t: string }[]; small?: boolean }) {
  return (
    <>
      {rules.map((r) => (
        <div key={r.b} style={{ display: 'flex', gap: 14 }}>
          <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px var(--ya-border-night)', display: 'grid', placeItems: 'center', color: '#7CE0A2' }}><Icon name="check" size={14} stroke={2.6} /></span>
          <span style={{ fontSize: small ? 14.5 : 15, lineHeight: 1.5, color: 'var(--ya-text-on-night-2)', textWrap: 'pretty' }}><b style={{ fontWeight: 600, color: '#fff' }}>{r.b}</b> {r.t}</span>
        </div>
      ))}
    </>
  );
}

export function ImportsHome({
  data, error, onRetry, retrying, intro, onFile, onOpenWizard, sampleEmail,
}: {
  data: ImportsOverview | undefined;
  /** Échec de tix_imports_overview : l'erreur et « Réessayer » sous l'en-tête. */
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  intro: boolean;
  onFile: (f: File) => void;
  onOpenWizard: () => void;
  /** Une adresse réelle de la base, proposée au testeur. */
  sampleEmail: string | null;
}) {
  const TIX_ROUTES = useTixClientRoutes();
  const T = useTixT();
  const { t, tp, n, time, locale } = T;
  const toast = useTixToast();
  const { rpc: args } = useTixScope();
  const refresh = useInvalidateBase();
  const [drag, setDrag] = useState(false);
  const [hov, setHov] = useState(false);
  const [confirm, setConfirm] = useState<ImportRow | null>(null);
  const [undoing, setUndoing] = useState(false);
  const rules = useZeroRules();

  const sales = data?.sales ?? null;
  const live = (sales?.people ?? 0) > 0;
  const lastSale = sales?.last_at ? fdWhenShort(sales.last_at, t, time, locale) : null;

  const canWrite = useTixCaps().write;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  };

  const fdWhen = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (Date.now() - d.getTime() < 120_000) return t('ya.imp.justNow');
    if (d.toDateString() === today.toDateString()) return `${t('ya.imp.today')}, ${time(d)}`;
    if (d.toDateString() === y.toDateString()) return `${t('ya.imp.yesterday')}, ${time(d)}`;
    return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time(d)}`;
  };
  const doUndo = async () => {
    if (!confirm) return;
    setUndoing(true);
    try {
      await undoImport(args, confirm.id);
      toast(t('ya.imp.cf.done', { n: n(confirm.new) }));
      setConfirm(null);
      refresh();
    } catch {
      toast(t('ya.imp.cf.failed'));
    } finally {
      setUndoing(false);
    }
  };

  const hist = data ? [...data.imports] : [];

  // L'en-tête reste quand la lecture échoue : la page dit où l'on est, puis l'erreur.
  const head = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', ...reveal(intro, 100) }}>{t('ya.imp.eyebrow')}</span>
      <h1 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...reveal(intro, 170) }}>
        {t('ya.imp.title1')}<span style={{ background: 'var(--ya-gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('ya.imp.titleAccent')}</span>{t('ya.imp.title2')}
      </h1>
      <p style={{ margin: 0, maxWidth: 680, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--ya-sand-600)', textWrap: 'pretty', ...reveal(intro, 240) }}>{t('ya.imp.sub')}</p>
    </div>
  );

  // Sans la vue d'ensemble, la synchro passerait pour « non connectée » et
  // l'historique resterait en squelettes : on dit l'échec (délai compris).
  if (error && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {head}
        <LoadError error={error} onRetry={onRetry} retrying={retrying} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {head}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,470px),1fr))', gap: 20, alignItems: 'stretch' }}>
        {/* Les ventes Yuno : la base se remplit seule, à chaque vente. */}
        <Hv
          as="section"
          style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)', ...reveal(intro, 320) }}
          hover={{ boxShadow: 'inset 0 0 0 1px var(--ya-sand-300),var(--ya-shadow-md)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.imp.auto')}</span>
            {data ? (
              <span style={{ height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, background: live ? 'var(--ya-green-50)' : 'var(--ya-sand-100)', color: live ? 'var(--ya-green-700)' : 'var(--ya-sand-600)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: live ? 'ya-pulse 1.8s ease-in-out infinite' : 'none' }} />{t(live ? 'ya.imp.sales.pill.on' : 'ya.imp.sales.pill.wait')}
              </span>
            ) : <Skel w={90} h={26} r={99} />}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 112, padding: '0 4px', borderRadius: 20, background: 'repeating-linear-gradient(135deg,var(--ya-sand-50) 0 10px,var(--ya-card) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
            <div style={{ flex: 'none', marginLeft: 22, width: 68, height: 68, borderRadius: 18, background: 'var(--ya-gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: 'var(--ya-shadow-cta)', zIndex: 1 }}>
              <Icon name="ticket" size={30} stroke={2} />
            </div>
            <div style={{ position: 'relative', flex: 1, minWidth: 40, height: 32 }}>
              <span style={{ position: 'absolute', left: 0, right: 0, top: 15, height: 2, borderRadius: 2, backgroundImage: `repeating-linear-gradient(90deg,${live ? 'var(--ya-sand-300)' : 'var(--ya-sand-200)'} 0 7px,transparent 7px 14px)` }} />
              {live && ['LM', 'KB', 'CR'].map((x, i) => (
                <span key={x} style={{ position: 'absolute', top: 2, left: 0, width: 28, height: 28, borderRadius: 99, background: 'var(--ya-card)', boxShadow: '0 0 0 1px var(--ya-sand-200),var(--ya-shadow-xs)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, color: 'var(--ya-ink)', opacity: 0, animation: 'ya-flow 3.2s linear infinite', animationDelay: `${i * 1.07}s` }}>{x}</span>
              ))}
            </div>
            <LogoTile src={yunoIcon} alt="Yuno" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{t('ya.imp.sales.title')}</h2>
            <span style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--ya-sand-600)', textWrap: 'pretty' }}>
              {!data ? <Skel w={300} h={16} />
                : live ? tp('ya.imp.sales.line', sales?.people ?? 0, { n: n(sales?.people ?? 0), m: n(sales?.month ?? 0), when: lastSale ?? '—' })
                  : t('ya.imp.sales.lineNone')}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14.5, lineHeight: 1.4, color: 'var(--ya-sand-700)' }}>
                <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 99, background: 'var(--ya-green-50)', color: 'var(--ya-green-700)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={12} stroke={3} /></span>{t(`ya.imp.sales.p${i}`)}
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', paddingTop: 20, borderTop: '1px solid var(--ya-sand-100)' }}>
            <Hv as={Link} to={TIX_ROUTES.clients} style={{ height: 46, padding: '0 20px 0 16px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', color: 'var(--ya-ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: 'var(--ya-shadow-xs)', whiteSpace: 'nowrap', textDecoration: 'none', transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }} hover={{ translate: '0 -2px', boxShadow: 'var(--ya-shadow-md)', borderColor: 'var(--ya-sand-300)', color: 'var(--ya-ink)', textDecoration: 'none' }} active={{ translate: '0 0' }}>
              <Icon name="users" size={17} stroke={2.2} />{t('ya.imp.sales.see')}
            </Hv>
          </div>
        </Hv>

        {/* Import de fichier */}
        <section
          onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
          onDrop={canWrite ? onDrop : (e) => { e.preventDefault(); setDrag(false); }}
          onMouseEnter={() => setHov(true)}
          onMouseLeave={() => setHov(false)}
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 22, padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, background: drag ? 'var(--ya-red-50)' : 'var(--ya-card)', boxShadow: drag ? 'inset 0 0 0 2px var(--ya-red-400),var(--ya-shadow-md)' : hov ? 'inset 0 0 0 1px var(--ya-sand-300),var(--ya-shadow-md)' : 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)', ...reveal(intro, 400, 'background 240ms') }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.imp.manual')}</span>
            <span style={{ height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--ya-font-mono)', fontSize: 12, background: 'var(--ya-sand-100)', color: 'var(--ya-sand-700)' }}>.csv · .xlsx</span>
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 112, padding: '0 4px', borderRadius: 20, background: drag ? 'var(--ya-red-50)' : 'repeating-linear-gradient(135deg,var(--ya-sand-50) 0 10px,var(--ya-card) 10px 20px)', boxShadow: `inset 0 0 0 1.5px ${drag ? 'var(--ya-red-300)' : 'var(--ya-sand-100)'}`, transition: 'background 240ms,box-shadow 240ms' }}>
            <div style={{ flex: 'none', marginLeft: 22, width: 112, height: 80, borderRadius: 14, background: 'var(--ya-card)', boxShadow: '0 0 0 1px var(--ya-sand-200),var(--ya-shadow-md)', transform: drag ? 'translateY(-8px) rotate(0deg) scale(1.06)' : hov ? 'translateY(-4px) rotate(-1deg)' : 'rotate(-4deg)', transition: `transform 420ms ${SPRING}`, display: 'flex', flexDirection: 'column', gap: 7, padding: 12, zIndex: 1 }}>
              {[['var(--ya-ink)', 'var(--ya-ink)', 'var(--ya-ink)', 8], ['var(--ya-sand-200)', 'var(--ya-sand-200)', 'var(--ya-sand-200)', 7], ['var(--ya-sand-200)', 'var(--ya-sand-100)', 'var(--ya-sand-200)', 7], ['var(--ya-sand-100)', 'var(--ya-sand-200)', 'var(--ya-sand-100)', 7]].map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 5 }}>
                  <span style={{ flex: 2, height: r[3] as number, borderRadius: 4, background: r[0] as string }} />
                  <span style={{ flex: 1.4, height: r[3] as number, borderRadius: 4, background: r[1] as string }} />
                  <span style={{ flex: 1.6, height: r[3] as number, borderRadius: 4, background: r[2] as string }} />
                </div>
              ))}
            </div>
            <div style={{ position: 'relative', flex: 1, minWidth: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: hov || drag ? 'var(--ya-red-500)' : 'var(--ya-sand-300)', transition: 'color 200ms' }}>
              {[0, 0.25, 0.5].map((dl) => <Icon key={dl} name="chevronRight" size={18} stroke={2.6} style={{ animation: 'ya-pulse 1.6s ease-in-out infinite', animationDelay: `${dl}s` }} />)}
            </div>
            <LogoTile src={yunoIcon} alt="Yuno" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{t('ya.imp.file.title')}</h2>
            <span style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--ya-sand-600)', textWrap: 'pretty' }}>{t('ya.imp.file.sub')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14.5, lineHeight: 1.4, color: 'var(--ya-sand-700)' }}>
                <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 99, background: 'var(--ya-sand-100)', color: 'var(--ya-sand-700)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600 }}>{i}</span>{t(`ya.imp.file.s${i}`)}
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', paddingTop: 20, borderTop: '1px solid var(--ya-sand-100)' }}>
            {canWrite ? (
            <Hv as="button" type="button" onClick={onOpenWizard} style={{ height: 46, padding: '0 5px 0 22px', border: 0, borderRadius: 99, background: 'var(--ya-gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--ya-shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }} hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.97)' }}>
              {t('ya.imp.file.pick')}<span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--ya-red-500)', display: 'grid', placeItems: 'center' }}><Icon name="upload" size={16} stroke={2.4} /></span>
            </Hv>
            ) : <span style={{ fontSize: 14, color: 'var(--ya-sand-600)' }}>{t('ya.common.readOnly')}</span>}
            <Hv as="button" type="button" onClick={() => { downloadText('modele-import-yuno.csv', TEMPLATE_CSV); toast(t('ya.imp.templateDone')); }} style={{ height: 46, padding: '0 14px', border: 0, background: 'none', borderRadius: 99, fontSize: 15, fontWeight: 600, color: 'var(--ya-sand-600)', display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} hover={{ color: 'var(--ya-ink)', background: 'var(--ya-sand-50)' }}>
              <Icon name="download" size={16} stroke={2.2} />{t('ya.imp.file.template')}
            </Hv>
          </div>
          {drag && (
            <div style={{ position: 'absolute', inset: 10, borderRadius: 20, border: '2px dashed var(--ya-red-400)', background: 'rgb(var(--page) / .94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none', animation: `ya-pop 200ms ${EASE} both` }}>
              <span style={{ width: 56, height: 56, borderRadius: 99, background: 'var(--ya-gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: 'var(--ya-shadow-cta)', animation: 'ya-float 1.2s ease-in-out infinite' }}><Icon d="M12 19V5M5 12l7-7 7 7" size={24} stroke={2.4} /></span>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', color: 'var(--ya-red-700)' }}>{t('ya.imp.file.drop')}</span>
            </div>
          )}
        </section>
      </div>

      {/* Zéro doublon */}
      <section style={{ position: 'relative', overflow: 'hidden', isolation: 'isolate', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: '28px 40px', padding: 'clamp(24px,3vw,40px)', borderRadius: 28, color: 'var(--ya-text-on-night)', background: NIGHT_BG, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)', ...reveal(intro, 480) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-text-on-night-2)' }}>{t('ya.imp.zero')}</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(26px,2.8vw,34px)', letterSpacing: '-.035em', lineHeight: 1.08, color: '#fff', textWrap: 'balance' }}>{t('ya.imp.zeroTitle')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 2 }}><NightPanelRules rules={rules} /></div>
        </div>
        <Tester sampleEmail={sampleEmail} onAdded={refresh} />
      </section>

      {/* Derniers ajouts */}
      <section style={{ display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', ...reveal(intro, 560) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('ya.imp.hist')}</h2>
          <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.imp.histSub')}</span>
        </div>
        {!data && [0, 1, 2].map((i) => <div key={i} style={{ padding: '16px 0', borderTop: '1px solid var(--ya-sand-100)' }}><Skel h={44} r={12} /></div>)}
        {hist.map((h) => {
          const undone = h.status === 'undone';
          return (
            <HistRow
              key={h.id}
              icon={<Icon name={h.kind === 'manual' ? 'user' : 'file'} size={20} stroke={2} />}
              title={h.kind === 'manual' ? t('ya.imp.manualTitle') : h.title || '—'}
              when={fdWhen(h.created_at)}
              add={undone ? null : t('ya.imp.histNew', { n: n(h.new) })}
              dup={undone ? null : t('ya.imp.histDup', { n: n(h.existing + h.dup) })}
              undone={undone}
              action={!undone && canWrite ? (
                <Hv as="button" type="button" onClick={() => setConfirm(h)} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', fontSize: 14, fontWeight: 600, color: 'var(--ya-sand-700)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ borderColor: 'var(--ya-red-200)', background: 'var(--ya-red-50)', color: 'var(--ya-red-600)' }}>
                  <Icon d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" size={14} stroke={2.2} />{t('ya.imp.histUndo')}
                </Hv>
              ) : null}
            />
          );
        })}
        {data?.legacy.map((l) => (
          <HistRow key={l.id} icon={<Icon name="file" size={20} stroke={2} />} title={l.title || '—'} when={`${fdWhen(l.created_at)} · ${t('ya.imp.histLegacy', { n: n(l.rows) })}`} add={null} dup={null} action={null} />
        ))}
        {data && !hist.length && !data.legacy.length && (
          <div style={{ padding: '18px 0 4px', borderTop: '1px solid var(--ya-sand-100)', fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.imp.histEmpty')}</div>
        )}
      </section>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} width={460} label={t('ya.imp.cf.title')}>
        {confirm && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '26px 28px 8px' }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('ya.imp.cf.title')}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--ya-sand-600)' }}>{t('ya.imp.cf.body', { n: n(confirm.new), title: confirm.kind === 'manual' ? t('ya.imp.manualTitle') : confirm.title ?? '', m: n(confirm.existing) })}</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 28px 22px' }}>
              <Hv as="button" type="button" onClick={() => setConfirm(null)} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', fontSize: 14.5, fontWeight: 600, color: 'var(--ya-ink)', cursor: 'pointer' }} hover={{ background: 'var(--ya-paper)' }}>{t('ya.imp.cf.keep')}</Hv>
              <Hv as="button" type="button" onClick={() => void doUndo()} disabled={undoing} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--ya-red-600)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: undoing ? 'wait' : 'pointer', opacity: undoing ? 0.7 : 1 }} hover={{ background: 'var(--ya-red-700)' }}>{t('ya.imp.cf.go')}</Hv>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/** « Aujourd'hui, 21:40 », « 18 oct., 23:10 » : la dernière vente. */
function fdWhenShort(iso: string, t: (k: string) => string, time: (d: Date | string) => string, locale: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `${t('ya.imp.today')}, ${time(d)}`;
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time(d)}`;
}

function LogoTile({ src, alt, left }: { src: string; alt: string; left?: boolean }) {
  return (
    <div style={{ flex: 'none', [left ? 'marginLeft' : 'marginRight']: 22, width: 68, height: 68, borderRadius: 18, background: 'var(--ya-card)', display: 'grid', placeItems: 'center', boxShadow: '0 0 0 1px rgb(var(--ink) / .08),var(--ya-shadow-sm)', zIndex: 1 }}>
      <img src={src} alt={alt} style={{ width: 52, height: 52, borderRadius: 13, display: 'block' }} />
    </div>
  );
}

function HistRow({ icon, title, when, add, dup, undone, action }: { icon: React.ReactNode; title: string; when: string; add: string | null; dup: string | null; undone?: boolean; action: React.ReactNode }) {
  const { t } = useTixT();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '16px 0', borderTop: '1px solid var(--ya-sand-100)', opacity: undone ? 0.55 : 1, transition: 'opacity 240ms' }}>
      <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 12, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', display: 'grid', placeItems: 'center', color: 'var(--ya-sand-700)' }}>{icon}</span>
      <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: undone ? 'line-through' : 'none' }}>{title}</span>
        <span style={{ fontSize: 13.5, color: 'var(--ya-sand-500)' }}>{when}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {add && <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: 'var(--ya-green-50)', color: 'var(--ya-green-700)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{add}</span>}
        {dup && <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: 'var(--ya-sand-100)', color: 'var(--ya-sand-700)', fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>{dup}</span>}
        {undone && <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: 'var(--ya-sand-100)', color: 'var(--ya-sand-600)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('ya.imp.histUndone')}</span>}
      </div>
      <div style={{ flex: 'none', minWidth: 92, display: 'flex', justifyContent: 'flex-end' }}>{action}</div>
    </div>
  );
}

/** « Testez-le » : un e-mail ou un téléphone, déjà dans la base ou non. */
function Tester({ sampleEmail, onAdded }: { sampleEmail: string | null; onAdded: () => void }) {
  const T = useTixT();
  const { t, n, locale } = T;
  const toast = useTixToast();
  const { rpc: args } = useTixScope();
  const vId = args.p_venue_id;
  const oId = args.p_organizer_user_id;
  const [v, setV] = useState('');
  const [res, setRes] = useState<{ q: string; kind: 'exist' | 'new' | 'bad'; m?: BaseMatch; email?: string | null; phone?: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const q = v.trim();
  const parsed = useMemo(() => {
    if (!q) return null;
    if (q.includes('@')) { const e = normEmail(q); return isValidEmail(e) ? { email: e, phone: null } : 'bad'; }
    const p = normTel(q);
    return p ? { email: null, phone: p } : 'bad';
  }, [q]);

  useEffect(() => {
    if (!parsed) { setRes(null); return; }
    if (parsed === 'bad') { setRes({ q, kind: 'bad' }); return; }
    let live = true;
    const h = setTimeout(async () => {
      try {
        const r = await checkAgainstBase({ p_venue_id: vId, p_organizer_user_id: oId }, parsed.email ? [parsed.email] : [], parsed.phone ? [parsed.phone] : []);
        const m = parsed.email ? r.byEmail.get(parsed.email) : parsed.phone ? r.byPhone.get(parsed.phone) : undefined;
        if (live) setRes({ q, kind: m ? 'exist' : 'new', m, email: parsed.email, phone: parsed.phone });
      } catch { if (live) setRes(null); }
    }, 300);
    return () => { live = false; clearTimeout(h); };
  }, [parsed, q, vId, oId]);

  // Adresse d'exemple (la puce « nouveau.contact@exemple.fr ») : elle montre le
  // contrôle, jamais un ajout à la vraie base (audit du 18/10, UI-05).
  const sample = !!res?.email && isExampleAddress(res.email);
  const add = async () => {
    if (!res || res.kind !== 'new' || adding || sample) return;
    setAdding(true);
    try {
      const row: Record<string, string> = {};
      if (res.email) row.email = res.email;
      if (res.phone) row.phone = res.phone;
      await commitImport(args, { rows: [row], consent: 'no', mode: 'keep', title: t('ya.imp.manualTitle'), kind: 'manual', stats: { new: 1, existing: 0, dup: 0, bad: 0 } });
      toast(t('ya.imp.testAdded'));
      setRes({ ...res, kind: 'exist', m: { first_name: null, last_name: null, nights: 0, since: new Date().toISOString(), email: res.email } });
      onAdded();
    } catch {
      toast(t('ya.imp.cf.failed'));
    } finally {
      setAdding(false);
    }
  };

  const chips = [sampleEmail, 'nouveau.contact@exemple.fr'].filter((x): x is string => !!x);
  const ring = res?.kind === 'exist' ? '0 0 0 3px rgba(229,154,11,.5)' : res?.kind === 'new' ? '0 0 0 3px rgba(23,163,74,.45)' : 'none';
  const name = res?.m ? [res.m.first_name, res.m.last_name].filter(Boolean).join(' ') || res.m.email || q : q;
  const since = res?.m?.since && res.m.nights > 0
    ? t('ya.imp.testSince', { date: new Date(res.m.since).toLocaleDateString(locale, { month: 'long', year: 'numeric' }), n: n(res.m.nights) })
    : t('ya.imp.testSinceNone');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 22, borderRadius: 22, background: 'rgba(255,255,255,.06)', boxShadow: 'inset 0 0 0 1px var(--ya-border-night)', alignSelf: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ya-card)' }}>{t('ya.imp.test')}</span>
        <span style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--ya-text-on-night-2)' }}>{t('ya.imp.testSub')}</span>
      </div>
      <label style={{ position: 'relative', display: 'block' }}>
        <Icon name="search" size={18} stroke={2.2} color="var(--ya-sand-400)" style={{ position: 'absolute', left: 16, top: 17 }} />
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('ya.imp.test')}
          placeholder={t('ya.imp.testPh')}
          style={{ width: '100%', height: 52, padding: '0 16px 0 46px', borderRadius: 14, border: '1px solid transparent', boxShadow: ring, background: 'var(--ya-card)', fontSize: 16, color: 'var(--ya-ink)', outline: 0, transition: 'box-shadow 160ms' }}
        />
      </label>
      {!res && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--ya-text-on-night-2)' }}>{t('ya.imp.testTry')}</span>
          {chips.map((c) => (
            <Hv key={c} as="button" type="button" onClick={() => setV(c)} style={{ height: 32, padding: '0 12px', borderRadius: 99, border: 0, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px var(--ya-border-night)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: `background 160ms,translate 200ms ${EASE}` }} hover={{ background: 'rgba(255,255,255,.18)', translate: '0 -1px' }}>{c}</Hv>
          ))}
        </div>
      )}
      {res?.kind === 'exist' && (
        <div style={{ display: 'flex', gap: 14, padding: 16, borderRadius: 16, background: 'var(--ya-amber-50)', color: 'var(--ya-ink)', animation: `ya-pop 260ms ${EASE} both` }}>
          <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: 'var(--ya-card)', color: 'var(--ya-amber-700)', display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px rgba(229,154,11,.4)' }}><Icon name="copy" size={16} stroke={2.4} /></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ya-amber-700)' }}>{t('ya.imp.testExist')}</span>
            <span style={{ fontSize: 14.5, lineHeight: 1.4, overflowWrap: 'anywhere' }}><b style={{ fontWeight: 600 }}>{name}</b> · {since}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--ya-sand-600)' }}>{t('ya.imp.testExistS')}</span>
          </div>
        </div>
      )}
      {res?.kind === 'new' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, background: 'var(--ya-green-50)', color: 'var(--ya-ink)', animation: `ya-pop 260ms ${EASE} both` }}>
          <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: 'var(--ya-green-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={15} stroke={3} /></span>
          <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ya-green-700)' }}>{t('ya.imp.testNew')}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--ya-sand-600)' }}>{t('ya.imp.testNewS')}</span>
          </div>
          {sample ? (
            <span style={{ flex: '1 1 100%', fontSize: 13.5, lineHeight: 1.4, color: 'var(--ya-sand-600)' }}>{t('ya.imp.testSample')}</span>
          ) : (
            <Hv as="button" type="button" onClick={() => void add()} disabled={adding} style={{ flex: 'none', height: 40, padding: '0 18px', border: 0, borderRadius: 99, background: 'var(--ya-ink)', color: 'var(--ya-on-ink)', fontSize: 14.5, fontWeight: 600, cursor: adding ? 'wait' : 'pointer', transition: `transform 200ms ${SPRING}` }} hover={{ background: 'var(--ya-sand-700)' }} active={{ transform: 'scale(.96)' }}>
              {t('ya.imp.testAdd')}
            </Hv>
          )}
        </div>
      )}
      {res?.kind === 'bad' && (
        <div style={{ display: 'flex', gap: 14, padding: 16, borderRadius: 16, background: 'var(--ya-sand-50)', color: 'var(--ya-ink)', animation: `ya-pop 260ms ${EASE} both` }}>
          <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: 'var(--ya-card)', color: 'var(--ya-sand-500)', display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)' }}><Icon d="M12 8v4M12 16h.01" size={15} stroke={2.4} /></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{t('ya.imp.testBad')}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--ya-sand-600)' }}>{t('ya.imp.testBadS')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
