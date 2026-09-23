import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, ExternalLink, Lightbulb, ListOrdered,
  Sparkles, ThumbsDown, ThumbsUp, X, XCircle, ZoomIn,
} from 'lucide-react';
import type { OwnerHelpArticle, OwnerHelpCategory, OwnerHelpSection } from '@/data/ownerHelpContent';
import { glossaryTerms } from '@/data/ownerHelpContent';
import { parseHelpBody, type HelpBlock, type HelpInline, type HelpListItem } from '@/lib/helpText';
import { transitions, useReducedMotion } from '@/lib/motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AskAiButton } from './HelpAskAi';
import { HelpAiChat, type HelpAiChatHandle } from './HelpAiChat';
import { HelpSupportCards } from './HelpSupportCards';
import {
  AMBER, ArticleRow, BORDER, C_FAINT, F_BORDER, HCard, IconTile, INNER_BG, Kicker, NEG, Pill, POS, RED, SectionHead,
  T1, T2, T3, TILE_BG, articleReadMinutes, categoryColor, fmt,
} from './helpUi';

type T = (k: string) => string;

// ─── Glossaire (info-bulle sur les termes définis) ───────────────────────────
const GLOSSARY_KEYS = Object.keys(glossaryTerms).sort((a, b) => b.length - a.length);
const GLOSSARY_RE = GLOSSARY_KEYS.length
  ? new RegExp(`\\b(${GLOSSARY_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
  : null;

function GlossaryText({ text, t }: { text: string; t: T }) {
  if (!GLOSSARY_RE) return <>{text}</>;
  const parts = text.split(GLOSSARY_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const key = GLOSSARY_KEYS.find((k) => k.toLowerCase() === part.toLowerCase());
        if (!key) return <span key={i}>{part}</span>;
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <span className="cursor-help" style={{ borderBottom: '1px dotted rgba(232,25,44,0.6)', color: T1 }}>{part}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs">
              <p>{t(glossaryTerms[key])}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}

// ─── Rendu des blocs ──────────────────────────────────────────────────────────
function PathChips({ steps }: { steps: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-baseline" style={{ verticalAlign: 'baseline' }}>
      {steps.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span
            className="whitespace-nowrap"
            style={{ padding: '1px 7px', borderRadius: 6, background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: '0.88em', fontWeight: 500, lineHeight: 1.5 }}
          >
            {s}
          </span>
          {i < steps.length - 1 && <ChevronRight style={{ width: 12, height: 12, color: T3 }} aria-hidden="true" />}
        </span>
      ))}
    </span>
  );
}

function Inlines({ inlines, t }: { inlines: HelpInline[]; t: T }) {
  return (
    <>
      {inlines.map((inl, i) => {
        switch (inl.kind) {
          case 'strong': return <strong key={i} style={{ color: T1, fontWeight: 600 }}>{inl.text}</strong>;
          case 'label': return <span key={i} style={{ color: T1, fontWeight: 560 }}>{inl.text}</span>;
          case 'path': return <PathChips key={i} steps={inl.steps} />;
          default: return <GlossaryText key={i} text={inl.text} t={t} />;
        }
      })}
    </>
  );
}

function StepList({ items, t }: { items: HelpListItem[]; t: T }) {
  return (
    <ol className="relative space-y-0 my-1" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((it, i) => (
        <li key={i} className="relative flex gap-3.5" style={{ paddingBottom: i < items.length - 1 ? 14 : 0 }}>
          {i < items.length - 1 && (
            <span className="absolute" style={{ left: 13, top: 28, bottom: 0, width: 1, background: F_BORDER }} aria-hidden="true" />
          )}
          <span
            className="flex-none flex items-center justify-center tabular-nums"
            style={{ width: 27, height: 27, borderRadius: 999, background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.35)', color: RED, fontSize: 12, fontWeight: 700, marginTop: 1 }}
          >
            {i + 1}
          </span>
          <span className="flex-1 min-w-0" style={{ color: T2, fontSize: 14.5, lineHeight: 1.65, paddingTop: 3 }}>
            <Inlines inlines={it.inlines} t={t} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function BulletList({ items, t }: { items: HelpListItem[]; t: T }) {
  return (
    <ul className="space-y-2 my-1" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex-none flex items-center justify-center" style={{ width: 18, height: 23 }} aria-hidden="true">
            {it.tone === 'ok' ? (
              <CheckCircle2 style={{ width: 15, height: 15, color: POS }} />
            ) : it.tone === 'no' ? (
              <XCircle style={{ width: 15, height: 15, color: NEG }} />
            ) : (
              <span style={{ width: 5, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.4)' }} />
            )}
          </span>
          <span className="flex-1 min-w-0" style={{ color: T2, fontSize: 14.5, lineHeight: 1.65 }}>
            <Inlines inlines={it.inlines} t={t} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Blocks({ blocks, t }: { blocks: HelpBlock[]; t: T }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.kind === 'ol') return <StepList key={i} items={b.items} t={t} />;
        if (b.kind === 'ul') return <BulletList key={i} items={b.items} t={t} />;
        return (
          <p key={i} style={{ color: T2, fontSize: 14.5, lineHeight: 1.7, margin: 0 }}>
            <Inlines inlines={b.inlines} t={t} />
          </p>
        );
      })}
    </div>
  );
}

// ─── Encadrés (conseil, attention, exemple, pas à pas) ───────────────────────
const CALLOUT: Record<NonNullable<OwnerHelpSection['type']>, { color: string; icon: ReactNode; labelKey: string }> = {
  tip: { color: POS, icon: <Lightbulb style={{ width: 14, height: 14 }} />, labelKey: 'owner.help.calloutTip' },
  warning: { color: AMBER, icon: <AlertTriangle style={{ width: 14, height: 14 }} />, labelKey: 'owner.help.calloutWarning' },
  example: { color: 'rgba(255,255,255,0.7)', icon: <Sparkles style={{ width: 14, height: 14 }} />, labelKey: 'owner.help.calloutExample' },
  steps: { color: RED, icon: <ListOrdered style={{ width: 14, height: 14 }} />, labelKey: 'owner.help.calloutSteps' },
};

function hexToRgba(color: string, a: number): string {
  if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${a})`);
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function Callout({ type, t, children }: { type: NonNullable<OwnerHelpSection['type']>; t: T; children: ReactNode }) {
  const c = CALLOUT[type];
  return (
    <div
      className="relative overflow-hidden"
      style={{ borderRadius: 14, border: `1px solid ${hexToRgba(c.color, 0.22)}`, background: `linear-gradient(90deg, ${hexToRgba(c.color, 0.07)} 0%, rgba(255,255,255,0.02) 40%)`, padding: '14px 16px 14px 18px' }}
    >
      <span className="absolute left-0 top-0 bottom-0" style={{ width: 3, background: c.color, opacity: 0.85 }} aria-hidden="true" />
      <div className="flex items-center gap-1.5 mb-2" style={{ color: c.color }}>
        {c.icon}
        <Kicker style={{ color: c.color }}>{t(c.labelKey)}</Kicker>
      </div>
      {children}
    </div>
  );
}

// ─── Capture d'écran ─────────────────────────────────────────────────────────
function Screenshot({ src, alt, hint, onZoom, hero }: { src: string; alt: string; hint: string; onZoom: () => void; hero?: boolean }) {
  return (
    <figure className="m-0" style={{ marginTop: hero ? 0 : 14 }}>
      <button
        type="button"
        onClick={onZoom}
        aria-label={hint}
        className="group relative block w-full overflow-hidden cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-[#E8192C]/60"
        style={{ borderRadius: hero ? 16 : 12, border: `1px solid ${BORDER}`, background: '#050506', boxShadow: '0 18px 40px -28px rgba(0,0,0,.9)' }}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block w-full h-auto"
          style={hero ? { maxHeight: 420, objectFit: 'cover', objectPosition: 'top' } : undefined}
        />
        <span
          className="absolute inset-0 flex items-end justify-end p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          style={{ background: 'linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.45) 100%)' }}
        >
          <span className="inline-flex items-center gap-1.5" style={{ padding: '6px 10px', borderRadius: 9, background: 'rgba(10,10,12,0.85)', border: `1px solid ${BORDER}`, color: T1, fontSize: 12 }}>
            <ZoomIn style={{ width: 13, height: 13 }} aria-hidden="true" />
            {hint}
          </span>
        </span>
      </button>
    </figure>
  );
}

// ─── Sommaire (desktop, collant, suivi du défilement) ────────────────────────
function Toc({ t, headings, active, onGo }: { t: T; headings: string[]; active: number; onGo: (i: number) => void }) {
  return (
    <nav aria-label={t('ohelp.ui.onThisPage')} className="hidden lg:block sticky" style={{ top: 84 }}>
      <div style={{ padding: '16px 14px 16px 16px', borderRadius: 16, background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <Kicker>{t('ohelp.ui.onThisPage')}</Kicker>
        <ul className="mt-3 space-y-0.5" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {headings.map((h, i) => {
            const on = i === active;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onGo(i)}
                  className="relative w-full text-left cursor-pointer transition-colors duration-150 hover:text-white"
                  style={{ padding: '6px 0 6px 14px', color: on ? T1 : T3, fontSize: 12.5, fontWeight: on ? 600 : 500, lineHeight: 1.35 }}
                >
                  <span className="absolute left-0 top-1.5 bottom-1.5 rounded-full transition-all duration-150" style={{ width: 2, background: on ? RED : 'transparent', boxShadow: on ? '0 0 8px rgba(232,25,44,0.6)' : undefined }} aria-hidden="true" />
                  {h}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

// ─── Article ──────────────────────────────────────────────────────────────────
export function HelpArticleView({
  t, article, category, categories, initialSection, onOpenArticle, onOpenCategory, onHome, onContact, onOpenPath, scope, language, basePath,
}: {
  t: T;
  article: OwnerHelpArticle;
  category: OwnerHelpCategory | null;
  categories: OwnerHelpCategory[];
  scope: string;
  language: string;
  basePath: string;
  initialSection?: number;
  onOpenArticle: (article: OwnerHelpArticle) => void;
  onOpenCategory: (id: string) => void;
  onHome: () => void;
  onContact: () => void;
  onOpenPath: (path: string) => void;
}) {
  const reduced = useReducedMotion();
  const [zoom, setZoom] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const chatRef = useRef<HelpAiChatHandle>(null);
  const [vote, setVote] = useState<'yes' | 'no' | null>(null);
  const color = categoryColor(category?.id);

  const headings = useMemo(() => article.sections.map((s) => t(s.headingKey)), [article, t]);
  const parsed = useMemo(() => article.sections.map((s) => parseHelpBody(t(s.bodyKey))), [article, t]);
  const minutes = articleReadMinutes(article, t);

  // Capture « héros » : la première des deux premières sections, comme une
  // page produit. Elle n'est pas répétée dans sa section.
  const heroIdx = article.sections.findIndex((s, i) => i < 2 && Boolean(s.screenshotUrl));
  const hero = heroIdx >= 0 ? article.sections[heroIdx].screenshotUrl! : null;

  const allArticles = useMemo(() => categories.flatMap((c) => c.articles), [categories]);
  const related = useMemo(
    () => (article.relatedArticleIds ?? []).map((id) => allArticles.find((a) => a.id === id)).filter((a): a is OwnerHelpArticle => Boolean(a)),
    [article, allArticles],
  );
  const siblings = category?.articles ?? [];
  const pos = siblings.findIndex((a) => a.id === article.id);
  const prev = pos > 0 ? siblings[pos - 1] : null;
  const next = pos >= 0 && pos < siblings.length - 1 ? siblings[pos + 1] : null;

  // Avis « utile ? » : mémoire locale par article.
  useEffect(() => {
    try { setVote((localStorage.getItem(`yuno.help.helpful.${article.id}`) as 'yes' | 'no' | null) ?? null); } catch { setVote(null); }
  }, [article.id]);
  const cast = (v: 'yes' | 'no') => {
    setVote(v);
    try { localStorage.setItem(`yuno.help.helpful.${article.id}`, v); } catch { /* navigation privée */ }
  };

  const goTo = (i: number, smooth = true) => {
    const el = sectionRefs.current[i];
    if (!el) return;
    el.scrollIntoView({ behavior: smooth && !reduced ? 'smooth' : 'auto', block: 'start' });
    setActive(i);
  };

  // Arrivée sur une section précise (résultat de recherche).
  useEffect(() => {
    if (initialSection === undefined || initialSection < 0) return;
    const id = window.setTimeout(() => goTo(initialSection, false), 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id, initialSection]);

  // Suivi du défilement pour le sommaire.
  useEffect(() => {
    const els = sectionRefs.current.filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const idx = els.indexOf(visible[0].target as HTMLElement);
          if (idx >= 0) setActive(idx);
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [article.id]);

  // Échap ferme la visionneuse.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const relatedColor = (a: OwnerHelpArticle) => categoryColor(categories.find((c) => c.articles.some((x) => x.id === a.id))?.id);
  const chips = [1, 2, 3].map((n) => ({ label: t(`ohelp.ui.aiSuggestArticle${n}`), prompt: t(`ohelp.ui.aiSuggestArticle${n}`) }));

  return (
    <TooltipProvider delayDuration={200}>
      {/* Visionneuse */}
      <AnimatePresence>
        {zoom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitions.pop}
            className="fixed inset-0 z-[60] flex items-center justify-center cursor-zoom-out p-4"
            style={{ background: 'rgba(0,0,0,0.92)' }}
            onClick={() => setZoom(null)}
          >
            <button
              type="button"
              onClick={() => setZoom(null)}
              aria-label={t('ohelp.ui.lightboxClose')}
              className="absolute top-4 right-4 flex items-center justify-center cursor-pointer transition-colors hover:bg-white/10"
              style={{ width: 40, height: 40, borderRadius: 12, border: `1px solid ${BORDER}`, background: 'rgba(10,10,12,0.8)', color: T1, marginTop: 'env(safe-area-inset-top, 0px)' }}
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
            <img src={zoom} alt="" className="max-w-[96vw] max-h-[92vh] object-contain" style={{ borderRadius: 12, border: `1px solid ${BORDER}` }} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        key={article.id}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ ...transitions.reveal, duration: 0.3 }}
        className="pt-4 sm:pt-8 lg:grid lg:gap-8 lg:items-start"
        style={{ gridTemplateColumns: 'minmax(0,1fr) 236px' }}
      >
        <article className="min-w-0">
          {/* Fil d'Ariane */}
          <nav aria-label="breadcrumb" className="flex items-center gap-1.5 flex-wrap" style={{ color: T3, fontSize: 12.5 }}>
            <button type="button" onClick={onHome} className="cursor-pointer transition-colors hover:text-white">{t('ohelp.ui.breadcrumbRoot')}</button>
            {category && (
              <>
                <span aria-hidden="true">/</span>
                <button type="button" onClick={() => onOpenCategory(category.id)} className="cursor-pointer transition-colors hover:text-white">{t(category.labelKey)}</button>
              </>
            )}
            <span aria-hidden="true">/</span>
            <span className="truncate" style={{ color: T2, maxWidth: 260 }}>{t(article.titleKey)}</span>
          </nav>

          {/* Titre */}
          <header className="mt-4">
            <div className="flex items-start gap-4">
              <IconTile name={article.icon} size={48} accent color={color} className="hidden sm:flex" />
              <div className="min-w-0 flex-1">
                <h1 style={{ color: T1, fontSize: 'clamp(24px,3.4vw,34px)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.12, margin: 0 }}>
                  {t(article.titleKey)}
                </h1>
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  {category && <Pill color={color}>{t(category.labelKey)}</Pill>}
                  <Pill>{fmt(t('ohelp.ui.readTime'), { n: minutes })}</Pill>
                  <Pill>{fmt(t('ohelp.ui.sectionsCount'), { n: article.sections.length })}</Pill>
                </div>
              </div>
            </div>
            <p style={{ color: T2, fontSize: 15.5, lineHeight: 1.6, marginTop: 16, maxWidth: 720 }}>{t(article.descKey)}</p>
          </header>

          {hero && (
            <div className="mt-6">
              <Screenshot hero src={hero} alt={t(article.titleKey)} hint={t('ohelp.ui.zoomImage')} onZoom={() => setZoom(hero)} />
            </div>
          )}

          {/* Sommaire mobile */}
          {headings.length > 1 && (
            <div className="lg:hidden mt-6" style={{ padding: '14px 16px', borderRadius: 14, background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <Kicker>{t('ohelp.ui.inThisArticle')}</Kicker>
              <ol className="mt-2.5 space-y-1.5" style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                {headings.map((h, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => goTo(i)} className="flex items-center gap-2.5 text-left cursor-pointer transition-colors hover:text-white" style={{ color: T2, fontSize: 13.5 }}>
                      <span className="tabular-nums flex-none" style={{ color: T3, fontSize: 11.5, width: 18 }}>{String(i + 1).padStart(2, '0')}</span>
                      {h}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Sections */}
          <div className="mt-8 space-y-9">
            {article.sections.map((section, i) => {
              const content = <Blocks blocks={parsed[i]} t={t} />;
              return (
                <section
                  key={i}
                  id={`section-${i}`}
                  ref={(el) => { sectionRefs.current[i] = el; }}
                  style={{ scrollMarginTop: 84 }}
                >
                  <h2 style={{ color: T1, fontSize: 19, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.25, margin: '0 0 12px' }}>
                    {t(section.headingKey)}
                  </h2>
                  {section.type ? <Callout type={section.type} t={t}>{content}</Callout> : content}
                  {section.screenshotUrl && i !== heroIdx && (
                    <Screenshot src={section.screenshotUrl} alt={t(section.headingKey)} hint={t('ohelp.ui.zoomImage')} onZoom={() => setZoom(section.screenshotUrl!)} />
                  )}
                </section>
              );
            })}
          </div>

          {/* Ouvrir la page concernée */}
          {article.actionLink && (
            <div className="mt-8">
              <button
                type="button"
                onClick={() => onOpenPath(article.actionLink!.path)}
                className="inline-flex items-center gap-2 cursor-pointer transition-all duration-150 hover:brightness-110 active:scale-[0.99]"
                style={{ height: 42, padding: '0 18px', borderRadius: 12, background: RED, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: '0 0 18px -6px rgba(232,25,44,0.6)' }}
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                {t(article.actionLink.labelKey)}
              </button>
            </div>
          )}

          {/* Cet article vous a aidé ? */}
          <div className="mt-10 flex items-center justify-between gap-3 flex-wrap" style={{ padding: '14px 16px', borderRadius: 14, background: TILE_BG, border: `1px solid ${BORDER}` }}>
            <span style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
              {vote === 'yes' ? t('ohelp.ui.helpfulThanks') : vote === 'no' ? t('ohelp.ui.helpfulSorry') : t('ohelp.ui.helpfulQ')}
            </span>
            {vote === 'no' ? (
              <div className="flex items-center gap-2 flex-wrap">
                <AskAiButton label={t('ohelp.ui.feedbackAskAi')} onClick={() => chatRef.current?.focus()} />
                <button
                  type="button"
                  onClick={onContact}
                  className="inline-flex items-center gap-2 cursor-pointer transition-colors duration-150 hover:bg-white/[0.07]"
                  style={{ height: 36, padding: '0 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: C_FAINT, color: T1, fontSize: 13, fontWeight: 600 }}
                >
                  {t('ohelp.ui.contactTitle')}
                </button>
              </div>
            ) : vote === null ? (
              <div className="flex items-center gap-2">
                {(['yes', 'no'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => cast(v)}
                    className="inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 hover:bg-white/[0.07] hover:border-white/20"
                    style={{ height: 34, padding: '0 13px', borderRadius: 10, border: `1px solid ${BORDER}`, background: C_FAINT, color: T1, fontSize: 13, fontWeight: 600 }}
                  >
                    {v === 'yes' ? <ThumbsUp style={{ width: 14, height: 14 }} aria-hidden="true" /> : <ThumbsDown style={{ width: 14, height: 14 }} aria-hidden="true" />}
                    {v === 'yes' ? t('ohelp.ui.helpfulYes') : t('ohelp.ui.helpfulNo')}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Articles liés */}
          {related.length > 0 && (
            <div className="mt-8">
              <SectionHead title={t('ohelp.relatedArticles')} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {related.map((a) => (
                  <ArticleRow key={a.id} compact icon={a.icon} color={relatedColor(a)} title={t(a.titleKey)} desc={t(a.descKey)} onClick={() => onOpenArticle(a)} />
                ))}
              </div>
            </div>
          )}

          {/* Précédent / suivant dans le thème */}
          {(prev || next) && (
            <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {prev ? (
                <button type="button" onClick={() => onOpenArticle(prev)} className="group flex items-center gap-3 text-left cursor-pointer transition-all duration-150 hover:bg-white/[0.05]" style={{ padding: '12px 14px', borderRadius: 14, border: `1px solid ${BORDER}`, background: INNER_BG }}>
                  <ArrowLeft className="w-4 h-4 flex-none transition-transform group-hover:-translate-x-0.5" style={{ color: T3 }} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{t('ohelp.ui.prevArticle')}</span>
                    <span className="block truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>{t(prev.titleKey)}</span>
                  </span>
                </button>
              ) : <span className="hidden sm:block" />}
              {next && (
                <button type="button" onClick={() => onOpenArticle(next)} className="group flex items-center justify-end gap-3 text-right cursor-pointer transition-all duration-150 hover:bg-white/[0.05]" style={{ padding: '12px 14px', borderRadius: 14, border: `1px solid ${BORDER}`, background: INNER_BG }}>
                  <span className="min-w-0">
                    <span className="block" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{t('ohelp.ui.nextArticle')}</span>
                    <span className="block truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>{t(next.titleKey)}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 flex-none transition-transform group-hover:translate-x-0.5" style={{ color: T3 }} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Une question sur cet article ? */}
          <div className="mt-8">
            <HCard glow style={{ padding: 20 }}>
              <SectionHead title={t('ohelp.ui.stillNeedHelp')} sub={t('ohelp.ui.stillNeedHelpSub')} />
              <div className="space-y-3">
                <HelpAiChat
                  ref={chatRef}
                  t={t}
                  scope={scope}
                  language={language}
                  categories={categories}
                  basePath={basePath}
                  currentArticle={article}
                  chips={chips}
                />
                <HelpSupportCards t={t} onContact={onContact} />
              </div>
            </HCard>
          </div>
        </article>

        <Toc t={t} headings={headings} active={active} onGo={goTo} />
      </motion.div>
    </TooltipProvider>
  );
}
