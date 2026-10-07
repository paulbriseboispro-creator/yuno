/**
 * Automatisations (`/crm/automations`) — « Que font vos automatisations sans
 * vous ? ». Les six recettes d'un compte CRM (annonce, dernier appel, merci,
 * on vous a manqué, l'habitué qui décroche, reconquête), un e-mail chacune,
 * montées par le moteur existant. L'écran dit ce qu'elles ont fait vendre
 * (achats sous 7 jours après un clic), les allume ou les coupe, règle délai
 * et objet, ouvre leur e-mail dans le Studio, montre les derniers envois et
 * ce que les Yunits tiennent.
 */
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useCrmShell } from '@/crm/data/shell';
import { createAutomationTemplate, useAutomations, useSaveAutomation, useSaveAutomationSms, type AutoPeriod, type AutoRecipe } from '@/crm/data/automations';
import { CRM_AUTO_KINDS, autoState, type CrmAutoKind } from '@/crm/lib/automations';
import { useStaged } from '@/crm/pages/journey/jrLib';
import { AU_IC, startModal, type ModalState } from './autoFmt';
import { AutoSales, AutoKpis } from './AutoSales';
import { AutoCards } from './AutoCards';
import { AutoIntro, AutoLive, AutoRecos, AutoSoon } from './AutoLive';
import { AutoTodo } from './AutoTodo';
import { AutoModal } from './AutoModal';

export default function AutomationsPage() {
  const T = useCrmT();
  const { t } = T;
  const caps = useCrmCaps();
  const { space } = useCrmScope();
  const toast = useCrmToast();
  const navigate = useNavigate();
  const shell = useCrmShell();
  const [period, setPeriod] = useState<AutoPeriod>('30d');
  const q = useAutomations(period);
  const save = useSaveAutomation();
  const saveSms = useSaveAutomationSms();
  const [open, setOpen] = useState<CrmAutoKind | null>(null);
  const [hl, setHl] = useState<CrmAutoKind | null>(null);
  const [busy, setBusy] = useState<CrmAutoKind | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const smsDefault = t('yc.au.fr.smsDefault');

  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  // Les compteurs ne se rejouent qu'à l'arrivée d'une NOUVELLE période, pas
  // à chaque rafraîchissement du fil (toutes les minutes).
  const animKey = `${period}|${d ? 'ok' : 'wait'}`;
  const c = useStaged(animKey, !loading, 1400, 500, 800, 0);
  const g = useStaged(animKey, !loading, 1200, 650, 900, 0);

  const rates = { email: Number(shell.data?.wallet.rates?.email ?? 1), sms: Number(shell.data?.wallet.rates?.sms ?? 35) };
  const balance = Number(shell.data?.wallet.balance ?? 0);

  useEffect(() => {
    if (!hl) return;
    const id = setTimeout(() => setHl(null), 1800);
    return () => clearTimeout(id);
  }, [hl]);

  const scrollTo = useCallback((k: CrmAutoKind) => {
    setTimeout(() => {
      const el = document.getElementById(`auto-${k}`);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: 'smooth' });
    }, 80);
  }, []);

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e ?? '');
    toast(t(msg.includes('crm_automation_limit') ? 'yc.au.t.limit' : 'yc.au.t.err'));
  }, [toast, t]);

  /** Le modèle de la recette, créé s'il manque (sans modèle, rien ne part). */
  const ensureTemplate = useCallback(async (r: AutoRecipe | undefined, kind: CrmAutoKind) => {
    if (r?.template_id) return r.template_id;
    return createAutomationTemplate({
      kind, venueId: space.venueId, organizerUserId: space.venueId ? null : space.organizerUserId,
      venueName: space.name, lang: T.lang, t,
    });
  }, [space.venueId, space.organizerUserId, space.name, T.lang, t]);

  const toggle = useCallback(async (r: AutoRecipe) => {
    if (busy) return;
    setBusy(r.kind);
    try {
      if (r.enabled) {
        await save.mutateAsync({ kind: r.kind, enabled: false });
        toast(t('yc.au.t.off', { name: t(`yc.au.r.${r.kind}.name`) }));
      } else {
        const tpl = await ensureTemplate(r, r.kind);
        await save.mutateAsync({ kind: r.kind, enabled: true, templateId: tpl });
        toast(t('yc.au.t.on', { name: t(`yc.au.r.${r.kind}.name`) }));
      }
      setHl(r.kind);
    } catch (e) { fail(e); } finally { setBusy(null); }
  }, [busy, save, toast, t, ensureTemplate, fail]);

  const submit = useCallback(async (m: ModalState) => {
    if (busy || !d) return;
    const r = d.recipes.find((x) => x.kind === m.kind);
    const wasOn = !!r?.enabled;
    const activate = m.mode !== 'edit' && !wasOn;
    setBusy(m.kind);
    try {
      const tpl = await ensureTemplate(r, m.kind);
      await save.mutateAsync({ kind: m.kind, delayHours: m.delay, subject: m.subject.trim(), templateId: tpl, ...(activate ? { enabled: true } : {}) });
      // « 1re soirée » : l'étape SMS qui suit l'e-mail (texte vide = étape coupée).
      if (m.kind === 'first_return' && m.sms) {
        const body = m.sms.body.trim();
        await saveSms.mutateAsync({ kind: m.kind, enabled: m.sms.on && body.length > 0, body, delayDays: m.sms.delay });
      }
      toast(t(activate ? 'yc.au.t.on' : 'yc.au.t.saved', { name: t(`yc.au.r.${m.kind}.name`) }));
      setModal(null);
      setOpen(m.kind);
      setHl(m.kind);
      scrollTo(m.kind);
    } catch (e) { fail(e); } finally { setBusy(null); }
  }, [busy, d, save, saveSms, toast, t, ensureTemplate, fail, scrollTo]);

  const editMail = (r: AutoRecipe) => {
    if (r.template_id) navigate(`${CRM_ROUTES.emailStudio(r.template_id)}?template=${r.kind}`);
  };

  const hasAny = !!d && d.recipes.some((r) => autoState(r) !== 'none');
  const hasData = !!d && d.recipes.some((r) => r.all.contacted > 0);
  const recos = d ? d.recipes.filter((r) => autoState(r) === 'none') : [];
  const firstFree: CrmAutoKind = CRM_AUTO_KINDS.find((k) => {
    const r = d?.recipes.find((x) => x.kind === k);
    return !r || autoState(r) !== 'on';
  }) ?? 'new_event';

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', animation: `yc-in-blur 700ms ${EASE} 100ms both` }}>{t('yc.au.kick')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', animation: `yc-in-blur 800ms ${EASE} 170ms both` }}>
            {t('yc.au.title.a')}<span className="yc-accent-word">{t('yc.au.title.accent')}</span>{t('yc.au.title.b')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 680, animation: `yc-in-blur 800ms ${EASE} 240ms both` }}>{t(hasAny || hasData ? 'yc.au.sub' : 'yc.au.subEmpty')}</p>
        </div>
        {caps.write && d && (
          <div style={{ animation: `yc-in-blur 800ms ${EASE} 300ms both` }}>
            <Hv
              as="button"
              type="button"
              onClick={() => setModal(startModal(d, 'new', firstFree, 1, smsDefault))}
              style={{ height: 46, padding: '0 6px 0 20px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'transform 200ms cubic-bezier(.34,1.56,.64,1),filter 160ms' }}
              hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
              active={{ transform: 'scale(.97)' }}
            >
              {t('yc.au.new')}
              <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon d={AU_IC.plus} size={16} stroke={2.4} /></span>
            </Hv>
          </div>
        )}
      </div>

      {q.isError && !d && (
        <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
      )}

      {!d && !q.isError && <AutoSkeleton />}

      {d && (
        <>
          {!hasAny && !hasData && <AutoIntro T={T} />}
          <AutoTodo
            d={d} T={T} money={caps.money} balance={balance} rate={rates.email} canWrite={caps.write} canBilling={caps.billing}
            onRecharge={() => navigate(CRM_ROUTES.yunits)}
            onResume={(k) => { const r = d.recipes.find((x) => x.kind === k); if (r) void toggle(r); }}
            onPropose={(k) => setModal(startModal(d, 'reco', k, 3, smsDefault))}
          />
          {hasData && (
            <>
              <AutoSales d={d} T={T} money={caps.money} g={g} period={period} onPeriod={setPeriod} onRank={(k) => { setOpen(k); scrollTo(k); }} />
              <AutoKpis d={d} T={T} c={c} rates={rates} />
            </>
          )}
          {hasAny && (
            <AutoCards
              d={d} T={T} money={caps.money} c={c} g={g} canWrite={caps.write} open={open} onOpen={setOpen} hl={hl} busy={busy} rates={rates}
              onToggle={(r) => void toggle(r)}
              onEdit={(r) => setModal(startModal(d, 'edit', r.kind, 2, smsDefault))}
              onEditMail={editMail}
            />
          )}
          {hasData && <AutoLive d={d} T={T} c={c} balance={balance} rates={rates} canBilling={caps.billing} />}
          <AutoRecos
            T={T} recos={recos} empty={!hasAny && !hasData} canWrite={caps.write} rate={rates.email}
            onPick={(k) => { if (caps.write) setModal(startModal(d, 'reco', k, 3, smsDefault)); }}
            onBlank={() => setModal(startModal(d, 'new', recos[0]?.kind ?? firstFree, 1, smsDefault))}
          />
          <AutoSoon T={T} />
        </>
      )}

      {modal && d && (
        <AutoModal m={modal} setM={setModal} d={d} T={T} balance={balance} rate={rates.email} smsRate={rates.sms} busy={!!busy} onClose={() => setModal(null)} onSave={(m) => void submit(m)} />
      )}
    </main>
  );
}

function AutoSkeleton() {
  const sk = (h: number | string, w: number | string = '100%', r = 8) => <div className="yc-skel" style={{ height: h, width: w, borderRadius: r }} />;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)' }}>{sk(22, 90, 99)}{sk(18, '80%')}{sk(14, '95%')}{sk(40, 140, 99)}</div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
        {sk(26, 280)}{sk(96, 'min(360px,70%)', 16)}{sk(230, '100%', 16)}
      </div>
    </>
  );
}
