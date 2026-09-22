import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { useLanguage, useLocaleSection } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { ownerHelpCategories, type OwnerHelpArticle, type OwnerHelpCategory } from '@/data/ownerHelpContent';
import { HelpHome } from '@/components/help/HelpHome';
import { HelpCategoryView } from '@/components/help/HelpCategoryView';
import { HelpArticleView } from '@/components/help/HelpArticleView';
import { BORDER, C_FAINT, RED, T1, T2, T3, useRecentArticles } from '@/components/help/helpUi';

/**
 * Centre d'aide des dashboards pro (club, organisateur, agence, manager).
 *
 * Trois vues, adressées par l'URL pour que chaque écran soit partageable et
 * que le bouton « retour » du navigateur fonctionne :
 * - accueil      : /help                       (recherche, thèmes, populaires, support)
 * - thème        : /help?category=<id>
 * - article      : /help?article=<id>[&s=<n>]  (`s` = section visée par la recherche)
 *
 * Le contenu vient de `categories` (club par défaut ; organisateur et agence
 * passent le leur), les textes des clés `ohelp.*` chargées à la demande
 * (useLocaleSection). L'assistant IA apparaît partout où un assistant est
 * monté sur la page (src/lib/helpAssistant.ts) ; sinon, support humain.
 */
export default function OwnerHelpCenter({ categories = ownerHelpCategories }: { categories?: OwnerHelpCategory[] } = {}) {
  const { t } = useLanguage();
  const helpReady = useLocaleSection('help');
  const navigate = useNavigate();
  const { basePath, mode } = useDashboardMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [recentIds, pushRecent] = useRecentArticles(mode);

  const articleId = searchParams.get('article');
  const categoryId = searchParams.get('category');
  const sectionParam = searchParams.get('s');
  const initialSection = sectionParam !== null && /^\d+$/.test(sectionParam) ? Number(sectionParam) : undefined;

  const located = useMemo(() => {
    if (!articleId) return null;
    for (const c of categories) {
      const a = c.articles.find((x) => x.id === articleId);
      if (a) return { article: a, category: c };
    }
    return null;
  }, [articleId, categories]);

  const category = useMemo(() => {
    if (located) return located.category;
    if (!categoryId) return null;
    return categories.find((c) => c.id === categoryId) ?? null;
  }, [located, categoryId, categories]);

  // Un id inconnu (article renommé, autre dashboard) : on nettoie l'adresse et
  // on montre l'accueil plutôt qu'une page vide.
  useEffect(() => {
    if ((articleId && !located) || (categoryId && !category && !located)) {
      setSearchParams(new URLSearchParams(), { replace: true });
    }
  }, [articleId, located, categoryId, category, setSearchParams]);

  useEffect(() => {
    if (located) pushRecent(located.article.id);
  }, [located, pushRecent]);

  // Chaque changement de vue repart du haut (sauf quand une section est visée).
  useEffect(() => {
    if (initialSection === undefined) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [articleId, categoryId, initialSection]);

  const openArticle = useCallback((article: OwnerHelpArticle, sectionIndex?: number) => {
    const next = new URLSearchParams();
    next.set('article', article.id);
    if (sectionIndex !== undefined && sectionIndex >= 0) next.set('s', String(sectionIndex));
    setSearchParams(next);
  }, [setSearchParams]);

  const openCategory = useCallback((id: string) => {
    const next = new URLSearchParams();
    next.set('category', id);
    setSearchParams(next);
  }, [setSearchParams]);

  const goHome = useCallback(() => {
    setQuery('');
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const goContact = useCallback(() => navigate(`${basePath}/support`), [navigate, basePath]);

  // Lien d'action d'un article : chemin relatif au dashboard courant, ou
  // absolu avec le préfixe « ~ » (ex. le guide agence vers /affiliate/…).
  const openPath = useCallback((p: string) => navigate(p.startsWith('~') ? p.slice(1) : `${basePath}${p}`), [navigate, basePath]);

  const goBack = () => {
    if (located) {
      if (located.category) openCategory(located.category.id);
      else goHome();
    } else if (category) {
      goHome();
    } else {
      navigate(`${basePath}/dashboard`);
    }
  };

  const view: 'article' | 'category' | 'home' = located ? 'article' : category ? 'category' : 'home';
  const barTitle = view === 'article' ? t(located!.article.titleKey) : view === 'category' ? t(category!.labelKey) : t('ohelp.title');

  return (
    <div
      className="min-h-[100dvh] pb-24"
      style={{ background: '#000', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Ambiance : vignette blanche + halo rouge en tête d'accueil + trame de points */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: view === 'home'
            ? 'radial-gradient(60% 40% at 50% -5%, rgba(232,25,44,0.16) 0%, transparent 70%), radial-gradient(120% 60% at 50% -10%, rgba(255,255,255,.03), transparent 55%)'
            : 'radial-gradient(120% 60% at 50% -10%, rgba(255,255,255,.025), transparent 55%)',
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(70% 50% at 50% 0%, #000 0%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(70% 50% at 50% 0%, #000 0%, transparent 100%)',
          opacity: view === 'home' ? 1 : 0.5,
        }}
      />

      {/* Barre haute */}
      <div
        className="sticky top-0 z-30 backdrop-blur"
        style={{ background: 'rgba(0,0,0,0.78)', borderBottom: `1px solid ${BORDER}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto max-w-[1180px] px-4 sm:px-6 flex items-center gap-3" style={{ height: 56 }}>
          <button
            type="button"
            onClick={goBack}
            aria-label={view === 'home' ? t('ohelp.ui.backToDashboard') : t('ohelp.ui.breadcrumbRoot')}
            className="flex items-center justify-center flex-none cursor-pointer transition-colors hover:bg-white/[0.07]"
            style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${BORDER}`, background: C_FAINT, color: T2 }}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate" style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('sidebar.helpSupport')}
            </div>
            <div className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}>{barTitle}</div>
          </div>
          <button
            type="button"
            onClick={goContact}
            className="inline-flex items-center gap-2 flex-none cursor-pointer transition-all duration-150 hover:bg-white/[0.07] hover:border-white/20"
            style={{ height: 36, padding: '0 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: C_FAINT, color: T1, fontSize: 13, fontWeight: 600 }}
          >
            <MessageSquare className="w-4 h-4" style={{ color: RED }} aria-hidden="true" />
            <span className="hidden sm:inline">{t('ohelp.tabSupport')}</span>
          </button>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[1180px] px-4 sm:px-6">
        {!helpReady ? (
          <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true">
            <div className="h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : view === 'article' ? (
          <HelpArticleView
            t={t}
            article={located!.article}
            category={located!.category}
            categories={categories}
            initialSection={initialSection}
            onOpenArticle={openArticle}
            onOpenCategory={openCategory}
            onHome={goHome}
            onContact={goContact}
            onOpenPath={openPath}
          />
        ) : view === 'category' ? (
          <HelpCategoryView t={t} category={category!} categories={categories} onOpenArticle={openArticle} onOpenCategory={openCategory} />
        ) : (
          <HelpHome
            t={t}
            categories={categories}
            query={query}
            onQueryChange={setQuery}
            onOpenArticle={openArticle}
            onOpenCategory={openCategory}
            onContact={goContact}
            recentIds={recentIds}
          />
        )}
      </div>
    </div>
  );
}
