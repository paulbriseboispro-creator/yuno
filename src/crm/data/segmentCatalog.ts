/**
 * Données de la fenêtre « Choisissez vos segments » : le catalogue compté sur
 * la base de l'espace (crm_segment_catalog, une seule lecture) et la création
 * de plusieurs segments d'un coup (crm_segments_create_many).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import { CATALOG_ITEMS } from '@/crm/lib/segments';
import type { ClientFilterDef } from './clients';

export interface CatalogItem {
  key: string;
  def: ClientFilterDef;
  /** Modèles calculés : seuil (€), ville affichée, pays (ISO 2). */
  params: { threshold?: number; area?: string; home?: string; code?: string };
  n: number;
  reachable: number;
}

export interface SegmentCatalog {
  total: number;
  reachable: number;
  payers: number;
  coverage: { age: number; gender: number; area: number; country: number };
  /** Le pays le plus fréquent de la base (ISO 2), null sous 10 pays connus. */
  home: string | null;
  /** Une soirée de la billetterie connectée n'a pas encore commencé. */
  has_next_event: boolean;
  /** Au moins une personne a reçu un e-mail de l'espace en 12 mois. */
  has_messages: boolean;
  items: CatalogItem[];
  /** Modèles déjà créés dans l'espace (`crm_segments.template`). */
  existing: string[];
}

export function useSegmentCatalog(enabled: boolean) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'segment-catalog'],
    queryFn: () => rpc<SegmentCatalog>('crm_segment_catalog', { ...args, p_items: CATALOG_ITEMS }),
    enabled,
    staleTime: 60_000,
  });
}

export interface NewSegmentItem { template: string; name: string; description: string; definition: ClientFilterDef }

export function useCreateSegments() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: NewSegmentItem[]) =>
      rpc<{ created: { template: string; id: string }[]; skipped: { template: string; why: 'exists' | 'invalid' }[] }>(
        'crm_segments_create_many', { ...args, p_items: items },
      ),
    onSuccess: () => {
      for (const k of ['segments', 'segments-brief', 'segment-catalog']) void qc.invalidateQueries({ queryKey: ['crm', qk, k] });
    },
  });
}
