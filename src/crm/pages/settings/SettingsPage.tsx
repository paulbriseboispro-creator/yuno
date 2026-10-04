/**
 * Réglages (`/crm/settings`) — « Comment voulez-vous que Yuno travaille ? »
 *
 * Cinq sections, chacune avec son aperçu : l'établissement (nom, ville, type,
 * logo, aperçu d'e-mail), la page Yuno (à venir), les règles qui classent les
 * clients (habitué, à réactiver, fin de nuit — avec les effectifs RÉELS de
 * chaque valeur, crm_rules_preview), les données (export, conservation,
 * suppression) et les réglages des canaux. Rien ne part avant « Enregistrer » ;
 * la barre du bas compte les modifications, le rail les montre par section.
 *
 * Portes serveur (migration 20261004235500) : règles = éditeur et plus,
 * identité et conservation = titulaire ou admin, suppression = titulaire.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Skel } from '@/crm/ui/kit';
import { EASE, SPRING, prefersReducedMotion } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CrmRpcError, rpc } from '@/crm/lib/rpc';
import { downloadCsv } from '@/crm/lib/csv';
import { imageMinSide, squareImage } from '@/crm/lib/image';
import { useNights } from '@/crm/data/nights';
import { useEmailSettings } from '@/crm/data/emails';
import { useFeatureWaitlist } from '@/crm/data/soon';
import { useCrmSettings, useRequestDeletion, useRulesPreview, useSaveSettings, type SettingsPatch } from '@/crm/data/settings';
import { dirtyKeys, SEC_KEYS, toForm, type SettingsForm } from './form';
import { SEC_ICON, type SecId } from './settingsUi';
import { SectionData, SectionElsewhere, SectionIdentity, SectionPage, SectionRules, type ExportState, type NextNightLite } from './sections';

const SECS: SecId[] = ['a', 'b', 'c', 'd', 'e'];

export default function SettingsPage() {
  const q = useCrmSettings();
  if (!q.data) {
    return (
      <main style={{ flex: 1, width: '100%', maxWidth: 1240, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,40px) clamp(16px,3vw,40px) 140px', display: 'flex', flexDirection: 'column', gap: 30 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skel w={180} h={14} />
          <Skel w="min(560px,90%)" h={38} r={10} />
          <Skel w="min(460px,80%)" h={18} />
        </div>
        <div style={{ display: 'flex', gap: 40 }}>
          <div className="yc-hide-sm" style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>{SECS.map((s) => <Skel key={s} h={44} r={14} />)}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}><Skel h={420} r={28} /><Skel h={380} r={28} /></div>
        </div>
      </main>
    );
  }
  return <SettingsView />;
}

function SettingsView() {
  const { t, tp, n, dLong } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { rpc: args, qk } = useCrmScope();
  const caps = useCrmCaps();
  const narrow = useNarrow(980);
  const sq = useCrmSettings();
  // Les droits viennent du serveur ; le rôle connu de l'écran ne peut que les restreindre.
  const s = useMemo(() => {
    const d = sq.data!;
    return { ...d, can: { edit: d.can.edit && caps.write, identity: d.can.identity && caps.write, retention: d.can.retention && caps.write, delete: d.can.delete && caps.write } };
  }, [sq.data, caps.write]);
  const preview = useRulesPreview();
  const nights = useNights();
  const emailSettings = useEmailSettings();
  const wl = useFeatureWaitlist();
  const saveM = useSaveSettings();
  const delM = useRequestDeletion();

  const base = useMemo(() => toForm(s), [s]);
  const [f, setF] = useState<SettingsForm>(base);
  const set = useCallback(<K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setF((x) => ({ ...x, [k]: v })), []);
  const keys = dirtyKeys(f, base);
  const dirty = keys.length > 0;
  const nameOk = f.name.trim().length >= 2;
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exp, setExp] = useState<ExportState>('idle');
  const [delOpen, setDelOpen] = useState(false);
  const [delTxt, setDelTxt] = useState('');
  const [retConfirm, setRetConfirm] = useState<number | null>(null);
  const canSave = dirty && nameOk && !saving && !uploading;
  const canEdit = s.can.edit;

  // ── Apparition des sections et section courante (rail) ──
  const [rev, setRev] = useState<Partial<Record<SecId, number>>>({});
  const [cur, setCur] = useState<SecId>('a');
  const start = useRef(performance.now());
  useEffect(() => {
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      setRev({ a: 0, b: 0, c: 0, d: 0, e: 0 });
      return;
    }
    const io = new IntersectionObserver((es) => {
      const baseDelay = performance.now() - start.current < 1500 ? 380 : 0;
      let i = 0;
      const add: Partial<Record<SecId, number>> = {};
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const id = e.target.getAttribute('data-sec') as SecId;
        add[id] = baseDelay + (i++) * 120;
        io.unobserve(e.target);
      }
      if (i) setRev((r) => ({ ...add, ...r }));
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    document.querySelectorAll('[data-sec]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    let raf = 0;
    const spy = () => {
      let c: SecId = 'a';
      for (const id of SECS) {
        const el = document.getElementById(`sec-${id}`);
        if (el && el.getBoundingClientRect().top <= 170) c = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 6) c = 'e';
      setCur(c);
    };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(spy); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);
  const go = (id: SecId) => {
    const el = document.getElementById(`sec-${id}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    setCur(id);
  };

  // Quitter la page avec des modifications : le navigateur prévient.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = t('yc.set.leave'); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, t]);

  // ── Données d'aperçu ──
  const next: NextNightLite | null = useMemo(() => {
    const up = (nights.data?.nights ?? []).filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    return up ? { title: up.title, at: up.start_at } : null;
  }, [nights.data]);
  const senderName = emailSettings.data?.sender_name ?? null;

  // ── Actions ──
  const onLogo = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      if ((await imageMinSide(file)) < 256) { toast(t('yc.set.a.logoSmall')); return; }
      const blob = await squareImage(file, 512, 'image/png');
      const path = `${user.id}/crm-logo-${Date.now()}.png`;
      const { error } = await supabase.storage.from('profile-photos').upload(path, blob, { contentType: 'image/png', upsert: false });
      if (error) throw error;
      set('logo', supabase.storage.from('profile-photos').getPublicUrl(path).data.publicUrl);
    } catch {
      toast(t('yc.set.a.logoErr'));
    } finally {
      setUploading(false);
    }
  };

  const save = async (confirmed = false) => {
    if (!dirty || saving) return;
    if (!nameOk) { toast(t('yc.set.err.name')); go('a'); return; }
    const idChanged = keys.some((k) => k === 'name' || k === 'city' || k === 'logo');
    const patch: SettingsPatch = {};
    if (keys.includes('type')) patch.business_type = f.type;
    if (keys.includes('nHab')) patch.regular_min_nights = f.nHab;
    if (keys.includes('perHab')) patch.regular_window_months = f.perHab;
    if (keys.includes('mois')) patch.lapse_months = f.mois;
    if (keys.includes('jour')) patch.night_end_hour = f.jour;
    if (keys.includes('conserv')) patch.retention_months = f.conserv;
    if (!confirmed && keys.includes('conserv') && f.conserv !== null) {
      const k = preview.data?.erase[String(f.conserv)] ?? 0;
      if (k > 0) { setRetConfirm(k); return; }
    }
    setSaving(true);
    try {
      const d = await saveM.mutateAsync({
        identity: idChanged ? { name: f.name.trim(), city: f.city.trim() || null, logo_url: f.logo } : null,
        settings: Object.keys(patch).length ? patch : null,
      });
      if (d) setF(toForm(d));
      toast(t('yc.set.saved'));
    } catch (e) {
      const m = e instanceof CrmRpcError ? e.message : '';
      const cool = /rename_cooldown:(\S+)/.exec(m);
      toast(cool ? t('yc.set.err.rename', { date: dLong(cool[1]) })
        : m.includes('support_session') ? t('yc.set.err.support')
          : m.includes('forbidden') ? t('yc.set.err.forbidden')
            : m.includes('invalid_name') ? t('yc.set.err.name')
              : t('yc.set.err.failed'));
      // Une moitié a pu passer (l'identité avant les règles) : on relit.
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'settings'] });
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => setF(base);

  const doExport = async () => {
    if (exp === 'busy') return;
    setExp('busy');
    try {
      const r = await rpc<{ columns: string[]; rows: unknown[][] }>('crm_clients_export', { ...args, p_def: {}, p_emails: null });
      downloadCsv(`yuno-clients-${new Date().toISOString().slice(0, 10)}.csv`, r.columns, r.rows);
      toast(tp('yc.set.exp.toast', r.rows.length, { n: n(r.rows.length) }));
      setExp('done');
      setTimeout(() => setExp('idle'), 4000);
    } catch (e) {
      const m = e instanceof CrmRpcError ? e.message : '';
      toast(t(m.includes('support') ? 'yc.cli.list.exportSupport' : m.includes('export_forbidden') ? 'yc.cli.list.exportForbidden' : 'yc.cli.list.exportFailed'));
      setExp('idle');
    }
  };

  const savedName = s.identity?.name ?? '';
  const delOk = delTxt.trim().toLowerCase() === savedName.trim().toLowerCase() && savedName.trim() !== '';
  const confirmDel = async () => {
    if (!delOk || delM.isPending) return;
    try {
      await delM.mutateAsync(delTxt.trim());
      setDelOpen(false);
      setDelTxt('');
      toast(t('yc.set.del.done'));
    } catch (e) {
      const m = e instanceof CrmRpcError ? e.message : '';
      toast(m.includes('confirm_mismatch') ? t('yc.set.del.bad') : m.includes('support_session') ? t('yc.set.err.support') : m.includes('forbidden') ? t('yc.set.err.forbidden') : t('yc.set.err.failed'));
    }
  };

  const notified = wl.features.includes('signup_pages');
  const notify = () => {
    void wl.set({ feature: 'signup_pages', on: !notified }).then(() => { if (!notified) toast(t('yc.soon.notifiedToast')); }).catch(() => toast(t('yc.set.err.failed')));
  };

  // ── Rail ──
  const secDirty = (id: SecId) => SEC_KEYS[id].some((k) => keys.includes(k));
  const curIdx = Math.max(0, SECS.indexOf(cur));
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = railRef.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!narrow || !box || !el) return;
    box.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: 'smooth' });
  }, [narrow, cur]);

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1240, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,40px) clamp(16px,3vw,40px) 140px', display: 'flex', flexDirection: 'column', gap: 30 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 420px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', animation: `yc-in-blur 700ms ${EASE} 100ms both`, overflowWrap: 'anywhere' }}>{t('yc.set.kick', { name: f.name.trim() || savedName })}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', textWrap: 'balance', animation: `yc-in-blur 800ms ${EASE} 170ms both` }}>
            {t('yc.set.title.a')}<span className="yc-accent-wipe">{t('yc.set.title.w')}</span>{t('yc.set.title.b')}
          </h1>
          <p style={{ margin: 0, maxWidth: 620, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', animation: `yc-in-blur 800ms ${EASE} 240ms both` }}>{t('yc.set.sub')}</p>
        </div>
        <span style={{ flex: 'none', height: 36, padding: '0 16px 0 12px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 13.5, fontWeight: 600, background: dirty ? 'var(--amber-50)' : 'var(--green-50)', color: dirty ? 'var(--amber-700)' : 'var(--green-700)', transition: 'background 240ms,color 240ms', animation: `yc-in-blur 800ms ${EASE} 320ms both` }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'currentColor', animation: dirty ? 'none' : 'yc-ping 2s ease-out infinite' }} />
          {dirty ? tp('yc.set.chip.n', keys.length, { n: keys.length }) : t('yc.set.chip.saved')}
        </span>
      </header>

      {!canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontSize: 14, color: 'var(--sand-600)', marginTop: -10 }}>
          <Icon name="eye" size={17} stroke={2.2} />{t('yc.set.readOnly')}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '24px 40px' }}>
        {/* Rail */}
        <nav
          aria-label={t('yc.set.rail')}
          style={{
            flex: narrow ? '1 1 100%' : '0 0 220px', maxWidth: narrow ? '100%' : 220, minWidth: 0, width: narrow ? '100%' : 'auto',
            position: 'sticky', top: narrow ? 64 : 96, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 12,
            ...(narrow ? { background: 'rgba(252,250,249,.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', padding: '8px 0', margin: 0 } : {}),
          }}
        >
          {!narrow && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', padding: '0 14px', animation: `yc-in-blur 700ms ${EASE} 260ms both` }}>{t('yc.set.rail')}</span>}
          <div ref={railRef} className={narrow ? 'yc-noscroll' : undefined} style={{ position: 'relative', display: 'flex', flexDirection: narrow ? 'row' : 'column', gap: 2, overflowX: narrow ? 'auto' : 'visible' }}>
            {!narrow && <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 48, borderRadius: 14, background: 'var(--red-50)', transform: `translateY(${curIdx * 50}px)`, transition: `transform 460ms ${EASE}`, pointerEvents: 'none' }} />}
            {SECS.map((id, i) => {
              const on = cur === id;
              return (
                <Hv
                  key={id}
                  as="button"
                  type="button"
                  onClick={() => go(id)}
                  aria-current={on ? 'true' : 'false'}
                  style={{ position: 'relative', flex: 'none', height: 48, padding: '0 14px', border: 0, borderRadius: 14, background: narrow && on ? 'var(--red-50)' : 'transparent', display: 'flex', alignItems: 'center', gap: 12, color: on ? 'var(--red-600)' : 'var(--sand-600)', fontSize: 14.5, fontWeight: on ? 600 : 500, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', animation: `yc-in-blur 700ms ${EASE} ${300 + i * 70}ms both`, transition: 'color 240ms,background 240ms' }}
                  hover={{ color: on ? 'var(--red-600)' : 'var(--ink)' }}
                  active={{ transform: 'scale(.98)' }}
                >
                  <Icon d={SEC_ICON[id]} size={19} stroke={2} />
                  <span style={{ flex: 1 }}>{t(`yc.set.r.${id}`)}</span>
                  {secDirty(id) && <span title={t('yc.set.r.dot')} style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)', animation: `yc-pop 300ms ${EASE} both` }} />}
                </Hv>
              );
            })}
          </div>
        </nav>

        {/* Contenu */}
        <div style={{ flex: '999 1 560px', minWidth: 0, maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <SectionIdentity delay={rev.a} f={f} set={set} s={s} canEdit={canEdit && s.can.identity} lockNote={canEdit && !s.can.identity} onLogo={(file) => { void onLogo(file); }} uploading={uploading} next={next} senderName={senderName} />
          <SectionPage delay={rev.b} f={f} next={next} notified={notified} onNotify={notify} notifyBusy={wl.pending || !wl.loaded} />
          <SectionRules delay={rev.c} f={f} set={set} preview={preview.data} canEdit={canEdit} />
          <SectionData delay={rev.d} f={f} set={set} s={s} preview={preview.data} exp={exp} onExport={() => { void doExport(); }} onDelete={() => { setDelTxt(''); setDelOpen(true); }} canExport={caps.read} />
          <SectionElsewhere delay={rev.e} />
        </div>
      </div>

      {/* Barre d'enregistrement */}
      {dirty && (
        <div role="region" aria-label={tp('yc.set.dirty', keys.length, { n: keys.length })} style={{ position: 'fixed', left: '50%', bottom: 24, zIndex: 80, transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '10px 18px', padding: '10px 10px 10px 22px', borderRadius: 99, background: 'var(--ink)', color: '#fff', boxShadow: '0 18px 40px -12px rgba(28,21,23,.55)', animation: `yc-bar-up 420ms ${EASE} both` }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, fontWeight: 500 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--tangerine-500)' }} />{tp('yc.set.dirty', keys.length, { n: keys.length })}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hv as="button" type="button" onClick={cancel} style={{ height: 42, padding: '0 18px', border: 0, borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', transition: 'background 160ms' }} hover={{ background: 'rgba(255,255,255,.2)' }} active={{ transform: 'scale(.97)' }}>{t('yc.set.cancel')}</Hv>
            <Hv
              as="button"
              type="button"
              onClick={() => { void save(); }}
              aria-disabled={!canSave}
              style={{ height: 42, padding: '0 22px', border: 0, borderRadius: 99, background: canSave || saving ? 'var(--gradient-brand)' : 'rgba(255,255,255,.16)', color: canSave || saving ? '#fff' : 'rgba(255,255,255,.5)', fontSize: 14.5, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 10, transition: `transform 200ms ${SPRING},filter 160ms` }}
              hover={canSave ? { filter: 'brightness(1.07)', transform: 'translateY(-1px)' } : {}}
              active={{ transform: 'scale(.97)' }}
            >
              {t(saving ? 'yc.set.saving' : 'yc.set.save')}
              {saving && <span style={{ width: 15, height: 15, borderRadius: 99, border: '2.5px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} />}
            </Hv>
          </span>
        </div>
      )}

      {/* Conservation : confirmation avant d'effacer */}
      <Modal open={retConfirm !== null} onClose={() => setRetConfirm(null)} width={480} blur label={retConfirm !== null ? tp('yc.set.ret.mt', retConfirm, { n: n(retConfirm) }) : undefined}>
        {retConfirm !== null && (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', display: 'grid', placeItems: 'center' }}><Icon name="clock" size={21} stroke={2} /></span>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1 }}>{tp('yc.set.ret.mt', retConfirm, { n: n(retConfirm) })}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.set.ret.mb', { y: (f.conserv ?? 0) / 12 })}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
              <Hv as="button" type="button" onClick={() => setRetConfirm(null)} style={{ height: 46, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>{t('yc.set.cancel')}</Hv>
              <Hv as="button" type="button" onClick={() => { setRetConfirm(null); void save(true); }} style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ filter: 'brightness(1.15)' }} active={{ transform: 'scale(.97)' }}>{t('yc.set.ret.go')}</Hv>
            </div>
          </div>
        )}
      </Modal>

      {/* Suppression de l'espace */}
      <Modal open={delOpen} onClose={() => { setDelOpen(false); setDelTxt(''); }} width={480} blur label={t('yc.set.del.mt', { name: savedName })}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--red-50)', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><Icon name="trash" size={21} stroke={2} /></span>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1, overflowWrap: 'anywhere' }}>{t('yc.set.del.mt', { name: savedName })}</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>
              {tp('yc.set.del.mb', preview.data?.total ?? 0, { n: n(preview.data?.total ?? 0) })} {t('yc.set.del.mn')}
            </p>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)', overflowWrap: 'anywhere' }}>{t('yc.set.del.mc', { name: savedName })}</span>
            <input value={delTxt} onChange={(e) => setDelTxt(e.target.value)} autoComplete="off" className="yc-field" style={{ height: 50, boxSizing: 'border-box', padding: '0 16px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 16, color: 'var(--ink)', outline: 'none', width: '100%' }} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => { setDelOpen(false); setDelTxt(''); }} style={{ height: 46, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>{t('yc.set.cancel')}</Hv>
            <Hv
              as="button"
              type="button"
              onClick={() => { void confirmDel(); }}
              aria-disabled={!delOk}
              style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 99, background: delOk ? 'var(--red-500)' : 'var(--sand-100)', color: delOk ? '#fff' : 'var(--sand-400)', fontSize: 15, fontWeight: 600, cursor: delOk ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 9, transition: 'background 200ms,color 200ms' }}
              active={delOk ? { transform: 'scale(.97)' } : {}}
            >
              {delM.isPending && <span style={{ width: 15, height: 15, borderRadius: 99, border: '2.5px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} />}
              {t('yc.set.del.go')}
            </Hv>
          </div>
        </div>
      </Modal>
    </main>
  );
}
