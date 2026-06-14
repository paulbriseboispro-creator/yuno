import { useSubscriptionPlan } from './useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';

/**
 * Returns whether the current venue is in "Collab demo" mode.
 *
 * Collab clubs see the full Pro feature set (analytics, hype, CRM, factures,
 * remboursements, DJs, organisations…) but are NOT allowed to:
 *   - create/edit core operational entities (events, tickets, tables, menu,
 *     staff, promoters, DJs, scarcity, story builder, upsells) — `isReadOnly`
 *   - export data in bulk (CSV/PDF) — `canExport`
 *
 * The partner organizer manages creation for the collab night.
 * Sections that remain editable: venue identity (logo, photos, address,
 * description) and the club's own profile.
 */
export function useCollabReadOnly() {
  const { plan, loading } = useSubscriptionPlan();
  const isCollab = isCollabPlan(plan);
  return {
    isReadOnly: isCollab,
    canExport: !isCollab,
    loading,
  };
}
