import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { useLanguage, useLocaleSection } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { ownerHelpCategories, type OwnerHelpArticle, type OwnerHelpCategory } from '@/data/ownerHelpContent';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OrgPageHeader } from '@/components/org-ui';
import { HelpHome } from '@/components/help/HelpHome';
import { HelpCategoryView } from '@/components/help/HelpCategoryView';
import { HelpArticleView } from '@/components/help/HelpArticleView';
import { BORDER, C_FAINT, CONTACT_COLOR, RED, T1, T2, useRecentArticles } from '@/components/help/helpUi';

/**
 * Centre d'aide des dashboards pro (club, organisateur, agence, manager).
 *
 * Trois vues, adressées par l'URL pour que chaque écran soit partageable et
 * que le bouton « retour » du navigateur fonctionne :
 * - accueil      : /help                       (recherche, thèmes, populaires, assistant, support)
 * - thème        : /help?category=<id>
 * - article      : /help?article=<id>[&s=<n>]  (`s` = section visée par la recherche)
 *
 * L'en-tête suit l'app hôte : le club et le manager ont l'`OwnerHeader`
 * collant de toutes leurs pages ; l'organisateur et l'agence ont déjà la
 * barre de leur layout, la page ne pose qu'un `OrgPageHeader` en ligne —
 * jamais deux barres empilées.
 */
export default function OwnerHelpCenter({ categories = ownerHelpCategories }: { categories?: OwnerHelpCategory[] } = {}) {
  const { t, language } = useLanguage();
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

  const view: 'article' | 'category' | 'home' = located ? 'article' : category ? 'category' : 'home';
  const backTo = view === 'article'
    ? `${basePath}/help?category=${located!.category.id}`
    : view === 'category'
      ? `${basePath}/help`
      : `${basePath}/dashboard`;
  const ownerLike = mode === 'owner' || mode === 'manager';

  const contactButton = (
    <button
      type="button"
      onClick={goContact}
      className="inline-flex items-center gap-2 flex-none cursor-pointer transition-all duration-150 hover:bg-white/[0.07]"
      style={{ height: 36, padding: '0 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: C_FAINT, color: T1, fontSize: 13, fontWeight: 600 }}
    >
      <MessageSquare className="w-4 h-4" style={{ color: CONTACT_COLOR }} aria-hidden="true" />
      <span className="hidden sm:inline">{t('ohelp.tabSupport')}</span>
    </button>
  );

  const content = !helpReady ? (
    <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true">
      <div className="h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
    </div>
  ) : view === 'article' ? (
    <HelpArticleView
      t={t}
      article={located!.article}
      category={located!.category}
      categories={categories}
      scope={mode}
      language={language}
      basePath={basePath}
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
      scope={mode}
      language={language}
      basePath={basePath}
    />
  );

  return (
    <div
      className="min-h-[100dvh]"
      style={{ background: ownerLike ? 'var(--sf-000000)' : undefined, paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Ambiance : vignette + halo rouge en tête d'accueil + trame de points */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: view === 'home'
            ? 'radial-gradient(60% 40% at 50% -5%, rgba(232,25,44,0.16) 0%, transparent 70%), radial-gradient(120% 60% at 50% -10%, rgb(var(--ink)/.03), transparent 55%)'
            : 'radial-gradient(120% 60% at 50% -10%, rgb(var(--ink)/.025), transparent 55%)',
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: 'radial-gradient(rgb(var(--ink)/0.045) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(70% 50% at 50% 0%, #000 0%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(70% 50% at 50% 0%, #000 0%, transparent 100%)',
          opacity: view === 'home' ? 1 : 0.5,
        }}
      />

      {/* En-tête : celui de l'app hôte, jamais une seconde barre */}
      {ownerLike ? (
        <OwnerHeader title={t('ohelp.title')} backTo={backTo} rightContent={contactButton} />
      ) : (
        <div className="relative z-10 mx-auto max-w-[1180px] px-4 sm:px-6 pt-1">
          <OrgPageHeader
            title={t('ohelp.title')}
            subtitle={view === 'home' ? undefined : (view === 'article' ? t(located!.category.labelKey) : t('ohelp.ui.breadcrumbRoot'))}
            actions={
              <div className="flex items-center gap-2">
                {view !== 'home' && (
                  <button
                    type="button"
                    onClick={() => navigate(backTo)}
                    aria-label={t('ohelp.ui.breadcrumbRoot')}
                    className="flex items-center justify-center cursor-pointer transition-colors hover:bg-white/[0.07]"
                    style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${BORDER}`, background: C_FAINT, color: T2 }}
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                {contactButton}
              </div>
            }
          />
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-[1180px] px-4 sm:px-6">{content}</div>
    </div>
  );
}
