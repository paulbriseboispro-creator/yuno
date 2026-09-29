import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Handshake, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { RED, T1, T2, T3 } from '@/components/org-ui';
import {
  collabEventHref, collabHubHref, readCollabTrail, sideOfPath, trailAppliesTo,
  type CollabSide, type CollabTrail,
} from '@/lib/collabTrail';
import { useCollabToolLabel } from './useCollabToolLabel';

const STORAGE_KEY = 'yuno:collab-trail';

/**
 * Fil d'Ariane de la collaboration : « Collaborations › Soirée › <page> ».
 * Partagé par les pages filles de la soirée (Ventes, Qui fait vendre) et par la
 * barre des outils ouverts dans un autre onglet.
 */
export function CollabBreadcrumb({ side, eventId, title, current, className = '' }: {
  side: CollabSide; eventId: string; title: string; current: string; className?: string;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  return (
    <nav aria-label={t('Fil d’Ariane', 'Breadcrumb', 'Ruta')} className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`} style={{ fontSize: 13 }}>
      <Link to={collabHubHref(side)} className="inline-flex items-center gap-1.5 transition-colors hover:opacity-80" style={{ color: T2, textDecoration: 'none' }}>
        <Handshake className="h-3.5 w-3.5" style={{ color: RED }} />
        {t('Collaborations', 'Collaborations', 'Colaboraciones')}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
      <Link to={collabEventHref(side, eventId)} className="max-w-[40vw] truncate transition-colors hover:opacity-80" style={{ color: T2, textDecoration: 'none', fontWeight: 560 }}>
        {title || t('La soirée', 'The event', 'El evento')}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
      <span className="truncate" style={{ color: T1, fontWeight: 620 }} aria-current="page">{current}</span>
    </nav>
  );
}

function loadStored(): CollabTrail | null {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

/**
 * Bandeau en tête d'un outil ouvert depuis la page de collaboration (monté dans
 * `OwnerLayout` et `OrgAppLayout`). Il lit l'adresse UNE fois, garde le fil pour
 * CET onglet (sessionStorage, donc l'onglet d'origine n'est jamais touché) et ne
 * s'affiche que tant qu'on reste dans l'outil. Fermable.
 */
export function CollabTrailBar() {
  const { pathname, search } = useLocation();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const toolLabel = useCollabToolLabel();
  const [trail, setTrail] = useState<CollabTrail | null>(() => loadStored());

  useEffect(() => {
    const fromUrl = readCollabTrail(pathname, search);
    if (!fromUrl) return;
    setTrail(fromUrl);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromUrl)); } catch { /* navigation privée */ }
  }, [pathname, search]);

  if (!trail || !trailAppliesTo(trail, pathname)) return null;
  const side = sideOfPath(pathname);
  const dismiss = () => {
    setTrail(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* rien */ }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6"
      style={{ background: 'linear-gradient(90deg,rgba(232,25,44,0.12),rgba(232,25,44,0.04))', borderBottom: '1px solid rgba(232,25,44,0.22)' }}>
      <Link to={collabEventHref(side, trail.eventId)}
        className="inline-flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all duration-150 hover:opacity-90"
        style={{ background: RED, color: '#fff', fontSize: 12.5, fontWeight: 650, textDecoration: 'none' }}>
        <ArrowLeft className="h-3.5 w-3.5" /> {t('Retour à la collaboration', 'Back to the collaboration', 'Volver a la colaboración')}
      </Link>
      <CollabBreadcrumb side={side} eventId={trail.eventId} title={trail.title} current={toolLabel(trail.tool)} className="flex-1" />
      <button type="button" onClick={dismiss} aria-label={t('Masquer', 'Hide', 'Ocultar')}
        className="flex-none cursor-pointer rounded-md p-1 transition-colors hover:bg-[rgb(var(--ink)/0.06)]" style={{ color: T3 }}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
