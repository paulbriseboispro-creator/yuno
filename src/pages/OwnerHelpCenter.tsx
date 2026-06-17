import { useState, useMemo, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { ownerHelpCategories, OwnerHelpArticle, OwnerHelpCategory, OwnerHelpSection, glossaryTerms } from '@/data/ownerHelpContent';
import {
  ArrowLeft, Search, ChevronRight, Image, BookOpen, Lightbulb, AlertTriangle,
  ListOrdered, Sparkles, HelpCircle, X, ZoomIn, Zap, ExternalLink,
  Rocket, Settings, Moon, KeyRound, Users, Smartphone, Shield,
  Map, LayoutDashboard, FileText, CheckCircle, Building2, CreditCard,
  UserPlus, Wine, CalendarDays, Ticket, GlassWater, ClipboardList,
  Star, BarChart3, ClipboardCheck, Music, Sun, Wrench, TrendingUp,
  UserCog, Lock, DoorOpen, Shirt, RefreshCw, Megaphone, Headphones,
  Hash, ShieldCheck, Undo2, QrCode, Wallet, Package, Globe, Bell,
  Receipt, Settings2, MessageCircle,
  Calendar, Crown, Gift, Handshake, Heart, LayoutGrid, Mail, Martini,
  MessageSquare, Music2, Radio, ShoppingCart, Store, UserCheck, Wand,
  type LucideIcon
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Icon name → Lucide component mapping
const ICON_MAP: Record<string, LucideIcon> = {
  Rocket, Settings, Moon, KeyRound, Users, Smartphone, Shield,
  Lightbulb, BookOpen, Map, LayoutDashboard, FileText, CheckCircle,
  Building2, CreditCard, UserPlus, Wine, CalendarDays, Ticket,
  GlassWater, ClipboardList, Star, BarChart3, ClipboardCheck, Music,
  Sun, Wrench, TrendingUp, UserCog, Lock, DoorOpen, Shirt,
  RefreshCw, Megaphone, Headphones, Search, Hash, ShieldCheck,
  Undo2, AlertTriangle, QrCode, Zap, Wallet, Package, Globe, Bell,
  Receipt, Settings2, Sparkles, MessageCircle,
  Calendar, Crown, Gift, Handshake, Heart, LayoutGrid, Mail, Martini,
  MessageSquare, Music2, Radio, ShoppingCart, Store, UserCheck, Wand,
};

function renderIcon(name: string, className?: string) {
  const IconComponent = ICON_MAP[name];
  if (!IconComponent) return null;
  return <IconComponent className={className} />;
}

// Category color map
const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; iconBg: string }> = {
  'getting-started': { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', text: 'text-emerald-400', iconBg: 'bg-emerald-500/15' },
  // Mirror groups (match the owner dashboard sidebar)
  'overview': { bg: 'bg-blue-500/8', border: 'border-blue-500/20', text: 'text-blue-400', iconBg: 'bg-blue-500/15' },
  'events': { bg: 'bg-red-500/8', border: 'border-red-500/20', text: 'text-red-400', iconBg: 'bg-red-500/15' },
  'marketing-crm': { bg: 'bg-indigo-500/8', border: 'border-indigo-500/20', text: 'text-indigo-400', iconBg: 'bg-indigo-500/15' },
  'operations': { bg: 'bg-orange-500/8', border: 'border-orange-500/20', text: 'text-orange-400', iconBg: 'bg-orange-500/15' },
  'settings': { bg: 'bg-cyan-500/8', border: 'border-cyan-500/20', text: 'text-cyan-400', iconBg: 'bg-cyan-500/15' },
  // Bonus / reference groups
  'plans-billing': { bg: 'bg-orange-500/8', border: 'border-orange-500/20', text: 'text-orange-400', iconBg: 'bg-orange-500/15' },
  'owner-setup': { bg: 'bg-blue-500/8', border: 'border-blue-500/20', text: 'text-blue-400', iconBg: 'bg-blue-500/15' },
  'daily-operations': { bg: 'bg-purple-500/8', border: 'border-purple-500/20', text: 'text-purple-400', iconBg: 'bg-purple-500/15' },
  'growth-marketing': { bg: 'bg-indigo-500/8', border: 'border-indigo-500/20', text: 'text-indigo-400', iconBg: 'bg-indigo-500/15' },
  'manager-role': { bg: 'bg-amber-500/8', border: 'border-amber-500/20', text: 'text-amber-400', iconBg: 'bg-amber-500/15' },
  'staff-guides': { bg: 'bg-cyan-500/8', border: 'border-cyan-500/20', text: 'text-cyan-400', iconBg: 'bg-cyan-500/15' },
  'client-guide': { bg: 'bg-pink-500/8', border: 'border-pink-500/20', text: 'text-pink-400', iconBg: 'bg-pink-500/15' },
  'security': { bg: 'bg-red-500/8', border: 'border-red-500/20', text: 'text-red-400', iconBg: 'bg-red-500/15' },
};

const DEFAULT_COLOR = { bg: 'bg-muted/30', border: 'border-border', text: 'text-muted-foreground', iconBg: 'bg-muted/50' };

function getCategoryColor(id: string) {
  return CATEGORY_COLORS[id] || DEFAULT_COLOR;
}

// Callout component
function Callout({ type, children }: { type: 'tip' | 'warning' | 'example' | 'steps'; children: React.ReactNode }) {
  const config = {
    tip: { icon: <Lightbulb className="w-4 h-4" />, label: 'Conseil', bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400' },
    warning: { icon: <AlertTriangle className="w-4 h-4" />, label: 'Attention', bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-400' },
    example: { icon: <Sparkles className="w-4 h-4" />, label: 'Exemple', bg: 'bg-blue-500/10 border-blue-500/30', text: 'text-blue-400' },
    steps: { icon: <ListOrdered className="w-4 h-4" />, label: 'Étapes', bg: 'bg-purple-500/10 border-purple-500/30', text: 'text-purple-400' },
  };
  const c = config[type];
  return (
    <div className={cn('rounded-lg border p-3 mt-2', c.bg)}>
      <div className={cn('flex items-center gap-2 mb-1 font-medium text-xs uppercase tracking-wider', c.text)}>
        {c.icon} {c.label}
      </div>
      <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">{children}</div>
    </div>
  );
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase() ? <mark key={i} className="bg-primary/30 text-foreground rounded px-0.5">{p}</mark> : p
  );
}

// Render text with glossary tooltips
function GlossaryText({ text, t }: { text: string; t: (key: string) => string }) {
  const terms = Object.keys(glossaryTerms).sort((a, b) => b.length - a.length);
  if (terms.length === 0) return <>{text}</>;
  
  const regex = new RegExp(`\\b(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  const parts = text.split(regex);
  
  return (
    <TooltipProvider delayDuration={200}>
      {parts.map((part, i) => {
        const matchKey = terms.find(term => term.toLowerCase() === part.toLowerCase());
        if (matchKey) {
          const defKey = glossaryTerms[matchKey];
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span className="border-b border-dotted border-primary/50 text-foreground cursor-help">{part}</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs">
                <p>{t(defKey)}</p>
              </TooltipContent>
            </Tooltip>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </TooltipProvider>
  );
}

export default function OwnerHelpCenter() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { basePath } = useDashboardMode();
  const [search, setSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<OwnerHelpArticle | null>(null);
  const [zoomedImg, setZoomedImg] = useState<string | null>(null);

  const quickStartArticles = useMemo(() => {
    return ownerHelpCategories.flatMap(c => c.articles).filter(a => a.quickStart);
  }, []);

  const selectedCategory = useMemo(() => {
    if (!selectedCategoryId) return null;
    return ownerHelpCategories.find(c => c.id === selectedCategoryId) || null;
  }, [selectedCategoryId]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;

    const scored: { article: OwnerHelpArticle; category: OwnerHelpCategory; snippet: string; score: number }[] = [];

    for (const cat of ownerHelpCategories) {
      for (const article of cat.articles) {
        let score = 0;
        const title = t(article.titleKey).toLowerCase();
        const desc = t(article.descKey).toLowerCase();
        const keywords = article.keywords || [];

        for (const token of tokens) {
          if (title.includes(token)) score += 10;
          if (desc.includes(token)) score += 4;
          if (keywords.some(k => k.toLowerCase().includes(token))) score += 8;
          for (const s of article.sections) {
            if (t(s.headingKey).toLowerCase().includes(token)) score += 5;
            if (t(s.bodyKey).toLowerCase().includes(token)) score += 2;
          }
        }

        if (score > 0) {
          const sectionMatch = article.sections.find(s =>
            tokens.some(tk => t(s.bodyKey).toLowerCase().includes(tk))
          );
          const snippet = sectionMatch
            ? t(sectionMatch.bodyKey).substring(0, 120) + '...'
            : t(article.descKey);
          scored.push({ article, category: cat, snippet, score });
        }
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }, [search, t]);

  const selectArticle = (article: OwnerHelpArticle, categoryId?: string) => {
    setSelectedArticle(article);
    if (categoryId) setSelectedCategoryId(categoryId);
  };

  const goBack = () => {
    if (selectedArticle) {
      setSelectedArticle(null);
    } else if (selectedCategoryId) {
      setSelectedCategoryId(null);
    } else {
      navigate(`${basePath}/dashboard`);
    }
  };

  const currentCategory = selectedArticle
    ? ownerHelpCategories.find(c => c.articles.some(a => a.id === selectedArticle.id))
    : null;

  // ─── ARTICLE DETAIL VIEW ───
  if (selectedArticle) {
    return (
      <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {zoomedImg && (
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-zoom-out" onClick={() => setZoomedImg(null)}>
            <button onClick={() => setZoomedImg(null)} className="absolute top-4 right-4 text-white/80 hover:text-white z-10">
              <X className="w-6 h-6" />
            </button>
            <img src={zoomedImg} alt="" className="max-w-[95vw] max-h-[95vh] object-contain" style={{ imageRendering: 'auto' }} />
          </div>
        )}

        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
              {currentCategory && t(currentCategory.labelKey)}
            </div>
            <h1 className="text-sm font-bold truncate">{t(selectedArticle.titleKey)}</h1>
          </div>
        </div>

        <div className="max-w-4xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
              {renderIcon(selectedArticle.icon, 'w-5 h-5 text-foreground/70')}
            </div>
            <div>
              <h2 className="text-xl font-bold mb-1">{t(selectedArticle.titleKey)}</h2>
              <p className="text-sm text-muted-foreground">{t(selectedArticle.descKey)}</p>
            </div>
          </div>

          {selectedArticle.sections.map((section, i) => (
            <div key={i} className="space-y-2">
              <h3 className="text-base font-semibold text-foreground">{t(section.headingKey)}</h3>
              {section.type ? (
                <Callout type={section.type}>
                  <GlossaryText text={t(section.bodyKey)} t={t} />
                </Callout>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                  <GlossaryText text={t(section.bodyKey)} t={t} />
                </p>
              )}
              {section.screenshotUrl ? (
                <div className="mt-3 space-y-1">
                  <div
                    className="w-full rounded-lg border border-border overflow-hidden cursor-zoom-in group relative"
                    onClick={() => setZoomedImg(section.screenshotUrl!)}
                  >
                    <img src={section.screenshotUrl} alt={t(section.headingKey)} className="w-full h-auto" loading="lazy" style={{ imageRendering: 'auto' }} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <ZoomIn className="w-8 h-8 text-white drop-shadow-lg" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 text-center">{t('ohelp.clickToZoom')}</p>
                </div>
              ) : section.screenshotPlaceholder && (
                <div className="w-full h-40 rounded-lg border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-2 mt-3">
                  <Image className="w-8 h-8 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/50">{t('ohelp.screenshotPlaceholder')}</span>
                </div>
              )}
            </div>
          ))}

          {/* Action link */}
          {selectedArticle.actionLink && (
            <button
              onClick={() => navigate(`${basePath}${selectedArticle.actionLink!.path}`)}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              {t(selectedArticle.actionLink.labelKey)}
            </button>
          )}

          {/* Related articles */}
          {selectedArticle.relatedArticleIds && selectedArticle.relatedArticleIds.length > 0 && (() => {
            const allArticles = ownerHelpCategories.flatMap(c => c.articles);
            const related = selectedArticle.relatedArticleIds!
              .map(id => allArticles.find(a => a.id === id))
              .filter(Boolean) as OwnerHelpArticle[];
            if (related.length === 0) return null;
            return (
              <div className="space-y-3 mt-4">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" />
                  {t('ohelp.relatedArticles')}
                </h3>
                <div className="grid gap-2">
                  {related.map(article => (
                    <button
                      key={article.id}
                      onClick={() => setSelectedArticle(article)}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-all text-left"
                    >
                      <div className="w-8 h-8 rounded-md bg-muted/50 flex items-center justify-center flex-shrink-0">
                        {renderIcon(article.icon, 'w-4 h-4 text-muted-foreground')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t(article.titleKey)}</p>
                        <p className="text-xs text-muted-foreground truncate">{t(article.descKey)}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="rounded-lg border border-border bg-muted/20 p-4 text-center space-y-3 mt-8">
            <HelpCircle className="w-6 h-6 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">{t('ohelp.stillStuck')}</p>
            <p className="text-xs text-muted-foreground">{t('ohelp.stillStuckDesc')}</p>
            <button
              onClick={() => navigate(`${basePath}/support`)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {t('ohelp.contactSupport')}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── CATEGORY DETAIL VIEW ───
  if (selectedCategory && !search.trim()) {
    const colors = getCategoryColor(selectedCategory.id);
    return (
      <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
          <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={cn('w-7 h-7 rounded-md flex items-center justify-center', colors.iconBg)}>
            {renderIcon(selectedCategory.icon, cn('w-4 h-4', colors.text))}
          </div>
          <h1 className="text-sm font-bold">{t(selectedCategory.labelKey)}</h1>
          <span className="text-xs text-muted-foreground ml-auto">{selectedCategory.articles.length} guides</span>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="max-w-4xl mx-auto p-4 sm:p-6 pb-24 space-y-2"
        >
          {selectedCategory.articles.map((article) => (
            <button
              key={article.id}
              onClick={() => selectArticle(article, selectedCategory.id)}
              className={cn(
                'w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left hover:scale-[1.01]',
                colors.bg, colors.border
              )}
            >
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', colors.iconBg)}>
                {renderIcon(article.icon, cn('w-5 h-5', colors.text))}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{t(article.titleKey)}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t(article.descKey)}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </button>
          ))}
        </motion.div>
      </div>
    );
  }

  // ─── MAIN HELP CENTER VIEW ───
  return (
    <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <button onClick={() => navigate(`${basePath}/dashboard`)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <BookOpen className="w-5 h-5 text-primary" />
        <h1 className="text-sm font-bold">{t('ohelp.title')}</h1>
      </div>

      {/* Tabs: Mode d'emploi | Contacter le support */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4">
        <div className="flex gap-2">
          <button
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all border',
              'bg-primary/10 border-primary/30 text-foreground'
            )}
          >
            <BookOpen className="w-4 h-4" />
            {t('ohelp.tabGuide')}
          </button>
          <button
            onClick={() => navigate(`${basePath}/support`)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all border',
              'bg-transparent border-border text-muted-foreground hover:bg-muted/50'
            )}
          >
            <MessageCircle className="w-4 h-4" />
            {t('ohelp.tabSupport')}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('ohelp.searchPlaceholder')}
            className="pl-10"
          />
        </div>

        {/* Search results */}
        {searchResults && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{searchResults.length} {t('ohelp.resultsFound')}</p>
            {searchResults.map(r => (
              <button
                key={r.article.id}
                onClick={() => selectArticle(r.article, r.category.id)}
                className="w-full flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-all text-left"
              >
                <div className="w-8 h-8 rounded-md bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {renderIcon(r.article.icon, 'w-4 h-4 text-muted-foreground')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{highlightText(t(r.article.titleKey), search)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{highlightText(r.snippet, search)}</p>
                  <span className="text-[10px] text-muted-foreground/60 mt-1 block">{t(r.category.labelKey)}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
              </button>
            ))}
            {searchResults.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{t('ohelp.noResults')}</p>
              </div>
            )}
          </div>
        )}

        {/* Quick Start */}
        {!searchResults && quickStartArticles.length > 0 && (
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              {t('ohelp.quickStart')}
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
              {quickStartArticles.map(article => (
                <button
                  key={article.id}
                  onClick={() => selectArticle(article)}
                  className="flex-shrink-0 w-[160px] snap-start flex flex-col items-start gap-2 p-3 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-all text-left"
                >
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                    {renderIcon(article.icon, 'w-4 h-4 text-primary')}
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="text-xs font-semibold line-clamp-2">{t(article.titleKey)}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{t(article.descKey)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category Grid */}
        {!searchResults && (
          <div>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t('ohelp.allCategories')}</h2>
            <div className="grid grid-cols-2 gap-3">
              {ownerHelpCategories.map(category => {
                const colors = getCategoryColor(category.id);
                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategoryId(category.id)}
                    className={cn(
                      'flex flex-col items-start gap-3 p-4 rounded-xl border transition-all text-left hover:scale-[1.02] active:scale-[0.98]',
                      colors.bg, colors.border
                    )}
                  >
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', colors.iconBg)}>
                      {renderIcon(category.icon, cn('w-5 h-5', colors.text))}
                    </div>
                    <div className="min-w-0 w-full">
                      <p className="text-sm font-semibold leading-tight">{t(category.labelKey)}</p>
                      <p className={cn('text-xs mt-0.5', colors.text)}>{category.articles.length} guides</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Still stuck */}
        {!searchResults && (
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-center space-y-3">
            <HelpCircle className="w-6 h-6 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">{t('ohelp.stillStuck')}</p>
            <p className="text-xs text-muted-foreground">{t('ohelp.stillStuckDesc')}</p>
            <button
              onClick={() => navigate(`${basePath}/support`)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {t('ohelp.contactSupport')}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
