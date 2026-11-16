/**
 * Rubrique « Clients » : qui achète sur Yuno ? (`/admin/clients/*`)
 * Vue d'ensemble, liste, fiche d'une personne UNIQUE, soirées à modérer,
 * annuaire. Chemins RELATIFS.
 */
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { personHref } from './personKey';

const OverviewPage = lazyWithRetry(() => import('./OverviewPage'));
const ListPage = lazyWithRetry(() => import('./ListPage'));
const PersonPage = lazyWithRetry(() => import('./PersonPage'));
const EventsPage = lazyWithRetry(() => import('./EventsPage'));
const DirectoryPage = lazyWithRetry(() => import('./DirectoryPage'));

/** Ancienne adresse de la fiche (`/admin/clients/people/:id`, lot 0) : la fiche unique. */
function LegacyPerson() {
  const { id } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`${personHref(id ?? '')}${search}${hash}`} replace />;
}

export default function ClientsRoutes() {
  return (
    <Routes>
      <Route index element={<OverviewPage />} />
      <Route path="list" element={<ListPage />} />
      <Route path="events" element={<EventsPage />} />
      <Route path="directory" element={<DirectoryPage />} />
      <Route path="people" element={<Navigate to="/admin/clients/directory" replace />} />
      <Route path="people/:id" element={<LegacyPerson />} />
      <Route path=":id" element={<PersonPage />} />
      <Route path="*" element={<Navigate to="/admin/clients" replace />} />
    </Routes>
  );
}
