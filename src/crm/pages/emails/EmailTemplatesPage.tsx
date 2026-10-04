/**
 * E-mails › Modèles (maquette « Email Modeles ») : « Quel e-mail voulez-vous
 * écrire ? ». Huit points de départ rendus par le vrai moteur d'e-mail, déjà
 * remplis avec la prochaine soirée du compte (affiche, date, tarifs, line-up),
 * l'aperçu agrandi ordinateur / mobile, puis « Utiliser ce modèle » qui crée
 * le brouillon et ouvre l'éditeur. En bas, les campagnes qui ont le mieux
 * vendu, à dupliquer.
 *
 * Adresse : `?g=` objectif, `?m=` modèle ouvert, `?event=` soirée annoncée,
 * `?start=` (liens de l'accueil) ouvre un modèle, `?from=audience` rappelle
 * l'audience gardée par « Écrire à… ».
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useEmailCampaigns, useInvalidateEmails } from '@/crm/data/emails';
import { peekPendingAudience, takePendingAudience, type PendingAudience } from '@/crm/data/clients';
import { duplicateCampaigns } from '@/crm/data/emailActions';
import {
  CRM_TEMPLATES, CRM_TEMPLATE_GOALS, crmTemplate, templateFromStart, venueAt,
  type CrmTemplateGoal, type CrmTemplateKind,
} from '@/crm/lib/emailTemplates';
import { useStudioLiveData } from '@/components/email-studio/hooks';
import { renderEmailHtml, type EmailBlock, type LiveData } from '@/lib/email';
import type { TemplateContent } from '@/lib/email/templates';
import { EmailsShell } from './EmailsShell';
import { useTemplateDraft } from './templateDraft';
import { ScaledFrame } from './ScaledFrame';

const PUBLIC_BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

/** Achats pour 1 000 e-mails envoyés. */
function perK(purchases: number, sent: number): number | null {
  return sent > 0 ? (purchases / sent) * 1000 : null;
}

export default function EmailTemplatesPage() {
  const { t, tp, n, n1, dShort, dLong } = useCrmT();
  const { space } = useCrmScope();
  const nav = useNavigate();
  const toast = useCrmToast();
  const invalidate = useInvalidateEmails();
  const [params, setParams] = useSearchParams();
  const goal = (params.get('g') as CrmTemplateGoal | null) ?? null;
  const opened = (params.get('m') as CrmTemplateKind | null) ?? null;
  const [pending, setPending] = useState<PendingAudience | null>(() => (params.get('from') === 'audience' ? peekPendingAudience() : null));
  const [busy, setBusy] = useState<string | null>(null);
  const canWrite = space.role === 'owner';

  const patch = (p: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) { if (v === null) next.delete(k); else next.set(k, v); }
    setParams(next, { replace });
  };

  // ?start=welcome (accueil) → le modèle s'ouvre directement.
  useEffect(() => {
    const k = templateFromStart(params.get('start'));
    if (!k) return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('start');
      next.set('m', k);
      return next;
    }, { replace: true });
  }, [params, setParams]);

  const camps = useEmailCampaigns();
  const list = camps.data?.campaigns;
  const drafts = (list ?? []).filter((c) => c.status === 'draft').length;

  // Soirées utilisées par les modèles : celle annoncée (adresse ou audience
  // gardée), sinon la prochaine ; la suivante pour la lettre du mois ; la
  // dernière passée pour « Merci pour hier soir ».
  const draft = useTemplateDraft(params.get('event') ?? pending?.eventId ?? null);
  const { night, second, last, contents } = draft;

  // Données live des deux soirées (tarifs, jauge, lien suivi de billetterie) :
  // les vignettes montrent l'e-mail qui partira, pas une carte d'exemple.
  const liveBlocks = useMemo(() => [night, second].filter(Boolean).map((x) => ({ id: x!.id, type: 'event', eventId: x!.id }) as unknown as EmailBlock), [night, second]);
  const live = useStudioLiveData(liveBlocks, null);

  const render = useMemo(() => (content: TemplateContent, liveData: LiveData) => renderEmailHtml(content.blocks, content.theme, {
    venueName: space.name, city: space.city, logoUrl: space.logoUrl,
    emailType: 'promotional', subject: content.subject, preheader: content.preheader,
    recipient: { email: 'camille@exemple.fr', firstName: 'Camille', lastEventTitle: last?.title ?? null },
    socialLinks: {}, baseUrl: PUBLIC_BASE_URL, ignoreConds: true, live: liveData,
  }), [space.name, space.city, space.logoUrl, last]);

  const html = useMemo(() => {
    const out: Partial<Record<CrmTemplateKind, string>> = {};
    for (const m of CRM_TEMPLATES) if (m.kind !== 'vide') out[m.kind] = render(contents[m.kind], live);
    return out;
  }, [contents, live, render]);

  // Ce que chaque type d'e-mail a donné chez ce compte (achats / 1 000 e-mails).
  const perf = useMemo(() => {
    const acc: Record<string, { p: number; n: number }> = {};
    for (const c of list ?? []) {
      if (c.status !== 'sent' || !c.template_kind || !c.stats?.n) continue;
      const a = (acc[c.template_kind] ??= { p: 0, n: 0 });
      a.p += c.stats.purchases; a.n += c.stats.n;
    }
    return acc;
  }, [list]);

  const mine = useMemo(() => (list ?? [])
    .filter((c) => c.status === 'sent' && c.sent_at && (c.stats?.n ?? 0) > 0)
    .map((c) => ({ c, rate: perK(c.stats!.purchases, c.stats!.n) ?? 0 }))
    .filter((x) => x.rate > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3), [list]);

  const shown = CRM_TEMPLATES.filter((m) => !goal || m.goal === goal);
  const goals: { k: CrmTemplateGoal | null; l: string; n: number }[] = [
    { k: null, l: t('yc.em.tp.goal.all'), n: CRM_TEMPLATES.length },
    ...CRM_TEMPLATE_GOALS.map((g) => ({ k: g, l: t(`yc.em.tp.goal.${g}`), n: CRM_TEMPLATES.filter((m) => m.goal === g).length })),
  ];

  const use = async (kind: CrmTemplateKind) => {
    if (busy) return;
    if (!canWrite) { toast(t('yc.em.tp.ownerOnly')); return; }
    setBusy(kind);
    try {
      const keep = pending ? takePendingAudience() ?? pending : null;
      const id = await draft.create(kind, keep);
      invalidate();
      nav(CRM_ROUTES.emailStudio(id));
    } catch {
      toast(t('yc.em.tp.err'));
      setBusy(null);
    }
  };

  const duplicate = async (id: string) => {
    if (busy) return;
    if (!canWrite) { toast(t('yc.em.tp.ownerOnly')); return; }
    setBusy(id);
    try {
      const [copy] = await duplicateCampaigns([id], t('yc.em.tp.copy'));
      invalidate();
      nav(CRM_ROUTES.emailStudio(copy));
    } catch {
      toast(t('yc.em.tp.err'));
      setBusy(null);
    }
  };

  const title = <>{t('yc.em.tp.h.a')}<span className="yc-accent-word">{t('yc.em.tp.h.b')}</span>{t('yc.em.tp.h.c')}</>;
  const sel = opened ? crmTemplate(opened) : undefined;

  return (
    <EmailsShell tab="templates" title={title} sub={t('yc.em.tp.sub')} drafts={drafts} kicker={t('yc.em.tp.kick')} hideNew>
      {pending && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: -8, animation: `yc-rise 700ms ${EASE} 340ms both` }}>
          <span style={{ height: 36, padding: '0 6px 0 14px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Icon name="users" size={15} stroke={2.2} />
            <span>{t('yc.em.tp.for')} · {tp('yc.em.tp.forN', pending.count, { label: pending.label, n: n(pending.count) })}</span>
            <Hv as="button" type="button" onClick={() => { takePendingAudience(); setPending(null); patch({ from: null }, true); }} style={{ height: 26, padding: '0 10px', border: 0, borderRadius: 99, background: '#fff', color: 'var(--red-700)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--red-100)' }}>
              {t('yc.em.tp.forDrop')}
            </Hv>
          </span>
          {night && (pending.eventId || params.get('event')) && (
            <span style={{ height: 36, padding: '0 14px', borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.em.tp.forNight', { title: night.title })}</span>
          )}
        </div>
      )}

      <div role="group" aria-label={t('yc.em.tp.goals')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, animation: `yc-rise 800ms ${EASE} 360ms both` }}>
        {goals.map((g) => {
          const on = goal === g.k;
          return (
            <Hv
              key={g.k ?? 'all'}
              as="button"
              type="button"
              onClick={() => patch({ g: g.k }, true)}
              aria-pressed={on}
              style={{ height: 40, padding: '0 18px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--sand-700)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: `background 160ms,color 160ms,border-color 160ms,transform 200ms ${SPRING}` }}
              hover={{ transform: 'translateY(-1px)' }}
            >
              {g.l}<span style={{ fontSize: 12.5, opacity: 0.65 }}>{g.n}</span>
            </Hv>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,270px),1fr))', gap: 18 }}>
        {shown.map((m, i) => (
          <TemplateCard
            key={m.kind}
            kind={m.kind}
            html={html[m.kind] ?? ''}
            ready={draft.ready}
            delay={i * 60 + 420}
            onOpen={() => (m.kind === 'vide' ? void use('vide') : patch({ m: m.kind }))}
            busy={busy === m.kind}
          />
        ))}
      </div>
      {!shown.length && <div style={{ padding: 40, textAlign: 'center', color: 'var(--sand-500)', fontSize: 15 }}>{t('yc.em.tp.none')}</div>}

      {(camps.isLoading || mine.length > 0) && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-rise 800ms ${EASE} 600ms both` }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.em.tp.mine.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.em.tp.mine.s')}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 12 }}>
            {camps.isLoading
              ? [0, 1, 2].map((k) => <Skel key={k} h={72} r={18} />)
              : mine.map(({ c, rate }) => (
                <Hv
                  key={c.id}
                  as="button"
                  type="button"
                  onClick={() => void duplicate(c.id)}
                  disabled={busy === c.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', border: 0, borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', color: 'var(--ink)', textAlign: 'left', font: 'inherit', cursor: 'pointer', transition: `translate 220ms ${EASE},box-shadow 220ms` }}
                  hover={{ translate: '0 -3px', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}
                >
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <b style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || c.subject || t('yc.em.untitled')}</b>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.em.tp.mine.meta', { rate: n1(rate), date: dShort(c.sent_at!) })}</span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{busy === c.id ? '…' : t('yc.em.tp.mine.dup')}</span>
                </Hv>
              ))}
          </div>
        </section>
      )}

      {sel && (
        <PreviewModal
          kind={sel.kind}
          html={html[sel.kind] ?? ''}
          perf={perf[sel.kind] ? perK(perf[sel.kind].p, perf[sel.kind].n) : null}
          nightLine={crmTemplate(sel.kind)?.night || sel.kind === 'mois'
            ? (night ? t('yc.em.tp.m.night', { title: night.title, date: dLong(night.start_at) }) : t('yc.em.tp.m.noNight'))
            : null}
          busy={busy === sel.kind}
          onClose={() => patch({ m: null }, true)}
          onUse={() => void use(sel.kind)}
        />
      )}
    </EmailsShell>
  );
}

function TemplateCard({ kind, html, ready, delay, onOpen, busy }: { kind: CrmTemplateKind; html: string; ready: boolean; delay: number; onOpen: () => void; busy: boolean }) {
  const { t } = useCrmT();
  const meta = crmTemplate(kind)!;
  const blank = kind === 'vide';
  const name = useTemplateName(kind);
  return (
    <Hv
      as="button"
      type="button"
      onClick={onOpen}
      className="yc-focus-ring"
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: 0, border: '1px solid var(--sand-200)', borderRadius: 24, overflow: 'hidden', background: '#fff', textAlign: 'left', font: 'inherit', color: 'var(--ink)', cursor: 'pointer', animation: `yc-row 600ms ${EASE} ${delay}ms both`, transition: `translate 260ms ${EASE},box-shadow 260ms,border-color 200ms` }}
      hover={{ translate: '0 -6px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
    >
      <div style={{ position: 'relative', width: '100%', height: 250, overflow: 'hidden', background: 'var(--sand-100)' }}>
        {blank ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)' }}>
            <span style={{ width: 64, height: 64, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-sm)', display: 'grid', placeItems: 'center', color: 'var(--ink)' }}><Icon name="plus" size={26} stroke={2.2} /></span>
          </div>
        ) : ready && html ? (
          <iframe title={name} srcDoc={thumbHtml(html)} tabIndex={-1} sandbox="" style={{ position: 'absolute', top: 0, left: '50%', width: 640, height: 900, border: 0, transform: 'translateX(-50%) scale(.42)', transformOrigin: 'top center', pointerEvents: 'none', background: '#fff' }} />
        ) : (
          <Skel h="100%" r={0} />
        )}
        <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 70, background: 'linear-gradient(transparent,rgba(255,255,255,.95))' }} />
        <span style={{ position: 'absolute', top: 12, left: 12, height: 24, padding: '0 11px', borderRadius: 99, background: 'rgba(255,255,255,.92)', boxShadow: '0 0 0 1px var(--sand-200)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t(`yc.em.tp.goal.${meta.goal}`)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 20px 20px' }}>
        <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.025em', lineHeight: 1.08 }}>{name}</b>
        <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.em.tp.${kind}.desc`)}</span>
        <span style={{ marginTop: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--red-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {busy ? t('yc.em.tp.m.creating') : t(blank ? 'yc.em.tp.start' : 'yc.em.tp.open')}
          <Icon name="arrowRight" size={14} stroke={2.4} />
        </span>
      </div>
    </Hv>
  );
}

/** Nom du modèle, avec le club pour « Le mois au Bunker ». */
function useTemplateName(kind: CrmTemplateKind): string {
  const { t, lang } = useCrmT();
  const { space } = useCrmScope();
  return useMemo(() => t(`yc.em.tp.${kind}.name`, { at: venueAt(space.name, lang), venue: space.name }), [kind, space.name, lang, t]);
}

/**
 * Vignette : l'affiche pleine largeur est recadrée (vignette seulement, l'e-mail
 * envoyé la garde entière) pour que l'en-tête, l'image et le titre se lisent
 * d'un coup d'œil, comme dans la maquette.
 */
function thumbHtml(html: string): string {
  return html.replace('</head>', '<style>img.yn-img[width="600"]{height:300px!important;object-fit:cover;object-position:50% 30%}</style></head>');
}

/** Aperçu « Ordinateur » : l'e-mail à 640 px, réduit pour tenir dans le volet. */
function PreviewModal({
  kind, html, perf, nightLine, busy, onClose, onUse,
}: {
  kind: CrmTemplateKind; html: string; perf: number | null; nightLine: string | null; busy: boolean; onClose: () => void; onUse: () => void;
}) {
  const { t, n1 } = useCrmT();
  // Sur un téléphone, l'aperçu s'ouvre sur la version mobile.
  const [dev, setDev] = useState<'desk' | 'mob'>(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 'mob' : 'desk'));
  const meta = crmTemplate(kind)!;
  const name = useTemplateName(kind);
  return (
    <Modal open onClose={onClose} width={1000} label={t('yc.em.tp.m.label')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: 'min(680px, calc(100vh - 32px))' }}>
        <div style={{ flex: '1.2 1 380px', minWidth: 0, minHeight: 300, display: 'flex', flexDirection: 'column', background: 'var(--sand-100)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
            <div role="group" aria-label={t('yc.em.tp.m.device')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: '#fff', borderRadius: 99 }}>
              {(['desk', 'mob'] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDev(d)} aria-pressed={dev === d} style={{ height: 34, padding: '0 15px', border: 0, borderRadius: 99, background: dev === d ? 'var(--ink)' : 'transparent', fontSize: 13.5, fontWeight: 600, color: dev === d ? '#fff' : 'var(--sand-600)', cursor: 'pointer', transition: 'background 160ms,color 160ms' }}>
                  {t(`yc.em.tp.m.${d}`)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', padding: '0 14px 14px' }}>
            <div style={{ width: dev === 'mob' ? 375 : 640, maxWidth: '100%', height: '100%', minHeight: 420, borderRadius: 14, overflow: 'hidden', background: '#fff', boxShadow: 'var(--shadow-sm)', transition: `width 300ms ${EASE}` }}>
              <ScaledFrame html={html} title={t('yc.em.tp.m.label')} mobile={dev === 'mob'} />
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ height: 24, padding: '0 11px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t(`yc.em.tp.goal.${meta.goal}`)}</span>
            <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.em.tp.m.close')} style={{ width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
              <Icon name="x" size={16} stroke={2.4} />
            </Hv>
          </div>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', lineHeight: 1.05 }}>{name}</h2>
            <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.em.tp.${kind}.desc`)}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t('yc.em.tp.m.has')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {meta.pieces.map((p, i) => (
                <span key={`${p}-${i}`} style={{ height: 28, padding: '0 12px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center' }}>{t(`yc.em.tp.p.${p}`)}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 16, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.em.tp.m.for')}</span>
            <b style={{ fontSize: 15 }}>{t(`yc.em.tp.${kind}.aud`)}</b>
          </div>
          {perf !== null && perf > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 16, background: 'var(--green-50)' }}>
              <span style={{ fontSize: 13, color: 'var(--green-700)' }}>{t('yc.em.tp.m.perf')}</span>
              <b style={{ fontSize: 15, color: 'var(--green-700)' }}>{t('yc.em.tp.m.perfV', { rate: n1(perf) })}</b>
            </div>
          )}
          {nightLine && <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{nightLine}</div>}
          <Hv
            as="button"
            type="button"
            onClick={onUse}
            disabled={busy}
            style={{ marginTop: 'auto', height: 50, padding: '0 6px 0 22px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: busy ? 'progress' : 'pointer', transition: `transform 200ms ${SPRING},filter 160ms` }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
            active={{ transform: 'scale(.98)' }}
          >
            {busy ? t('yc.em.tp.m.creating') : t('yc.em.tp.m.use')}
            <span style={{ width: 38, height: 38, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={17} stroke={2.4} /></span>
          </Hv>
        </div>
      </div>
    </Modal>
  );
}
