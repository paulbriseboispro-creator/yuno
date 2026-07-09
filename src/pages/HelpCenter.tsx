import { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { helpContent, HelpArticle, HelpCategory } from '@/data/helpContent';
import { ArrowLeft, Search, ChevronRight, ChevronDown, Image, BookOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { PublicPage } from '@/components/PublicPage';

interface Props {
  defaultTab?: 'client' | 'owner' | 'staff';
}

const TABS = [
  { key: 'client', labelKey: 'help.tabClient', icon: '👤' },
  { key: 'owner', labelKey: 'help.tabOwner', icon: '🏢' },
  { key: 'staff', labelKey: 'help.tabStaff', icon: '👥' },
] as const;

export default function HelpCenter({ defaultTab = 'client' }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(searchParams.get('tab') || defaultTab);
  const [search, setSearch] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const categories = helpContent[activeTab] || [];

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories.map(cat => ({
      ...cat,
      articles: cat.articles.filter(a =>
        t(a.titleKey).toLowerCase().includes(q) ||
        t(a.descKey).toLowerCase().includes(q) ||
        a.sections.some(s => t(s.bodyKey).toLowerCase().includes(q))
      ),
    })).filter(cat => cat.articles.length > 0);
  }, [categories, search, t]);

  const quickStartArticles = useMemo(() => {
    return categories.flatMap(c => c.articles).slice(0, 3);
  }, [categories]);

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSelectedArticle(null);
    setSearch('');
    setSearchParams({ tab });
  };

  // Article detail view
  if (selectedArticle) {
    return (
      <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <button onClick={() => setSelectedArticle(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-sm font-bold truncate">{t(selectedArticle.titleKey)}</h1>
        </div>

        <PublicPage variant="account">
        <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
          <div>
            <span className="text-3xl mb-3 block">{selectedArticle.icon}</span>
            <h2 className="text-xl font-bold mb-2">{t(selectedArticle.titleKey)}</h2>
            <p className="text-sm text-muted-foreground">{t(selectedArticle.descKey)}</p>
          </div>

          {selectedArticle.sections.map((section, i) => (
            <div key={i} className="space-y-2">
              <h3 className="text-base font-semibold text-foreground">{t(section.headingKey)}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{t(section.bodyKey)}</p>
              {section.screenshotPlaceholder && (
                <div className="w-full h-40 rounded-lg border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-2 mt-3">
                  <Image className="w-8 h-8 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/50">{t('help.screenshotPlaceholder')}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        </PublicPage>
      </div>
    );
  }

  // Main help center view
  return (
    <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <BookOpen className="w-5 h-5 text-primary" />
        <h1 className="text-sm font-bold">{t('help.title')}</h1>
      </div>

      <PublicPage variant="account">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('help.searchPlaceholder')}
            className="pl-10"
          />
        </div>

        {/* Role tabs */}
        <div className="flex gap-2">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={cn(
                'flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all border',
                activeTab === tab.key
                  ? 'bg-primary/10 border-primary/30 text-foreground'
                  : 'bg-transparent border-border text-muted-foreground hover:bg-muted/50'
              )}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Quick Start */}
        {!search && quickStartArticles.length > 0 && (
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t('help.quickStart')}</h2>
            <div className="grid gap-2">
              {quickStartArticles.map(article => (
                <button
                  key={article.id}
                  onClick={() => setSelectedArticle(article)}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-all text-left"
                >
                  <span className="text-xl">{article.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t(article.titleKey)}</p>
                    <p className="text-xs text-muted-foreground truncate">{t(article.descKey)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Categories + Articles */}
        <div className="space-y-3">
          {filteredCategories.map(category => {
            const isExpanded = expandedCategories.has(category.id) || !!search;
            return (
              <div key={category.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-all"
                >
                  <span className="text-sm font-semibold">{t(category.labelKey)}</span>
                  <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="border-t border-border">
                        {category.articles.map(article => (
                          <button
                            key={article.id}
                            onClick={() => setSelectedArticle(article)}
                            className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-all text-left border-t border-border first:border-t-0"
                          >
                            <span className="text-lg">{article.icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{t(article.titleKey)}</p>
                              <p className="text-xs text-muted-foreground truncate">{t(article.descKey)}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {filteredCategories.length === 0 && search && (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">{t('help.noResults')}</p>
            </div>
          )}
        </div>
      </div>
      </PublicPage>
    </div>
  );
}
