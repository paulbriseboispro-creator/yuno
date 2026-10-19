import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Yuno CRM ⇄ Billetterie : une soirée Shotgun est une soirée MIROIR dans
// `events` (`external_source = 'shotgun'`, inactive, privée, sans vente Yuno).
// Un compte à deux produits a donc, dans la MÊME portée (`organizer_user_id` /
// `venue_id`), ses vraies soirées Yuno et des centaines de miroirs (282 sur 285
// pour Amoris le 19/10). Toute lecture de la Billetterie qui liste ou compte les
// soirées d'une portée doit écrire `external_source IS NULL` (ou passer par
// `orgEventsOr` / `venueEventsOr` / `orgOwnEventsOr` / `venueOwnEventsOr` de
// `src/lib/coorg.ts`, ou filtrer `is_active`, qu'un miroir n'est jamais).
//
// Ce test lit les sources : il échoue quand une NOUVELLE lecture de `events`
// pose une portée sans l'un de ces filtres. Une exception se déclare dans
// `ALLOWED` avec sa raison — jamais en silence.

const ROOT = process.cwd();

/** Portée écrite à la main : `.eq('venue_id', …)`, `.in('organizer_user_id', …)` ou chaîne d'un `.or(…)`. */
const SCOPE =
  /\.(eq|in)\(\s*['"](venue_id|organizer_user_id|partner_venue_id|partner_organizer_id)['"]|\b(organizer_user_id|venue_id|partner_venue_id|partner_organizer_id)\.(eq|in)\./;
/** Ce qui écarte un miroir (ou le rend invisible). */
const SAFE = /external_source|is_active|includeExternal|\b(org|venue)(Own)?EventsOr\(|scopeEventsOr\(/;
const BY_ID = /\.(eq|in)\(\s*['"]id['"]/;
const WRITE = /\.(update|insert|delete|upsert)\(/;
const FROM_EVENTS = /\.from\(\s*(['"])events\1\s*\)/;

export interface EventRead { line: number; text: string }

/** Les lectures de `events` qui posent une portée sans écarter les miroirs. */
export function findUnfilteredEventReads(source: string): EventRead[] {
  const lines = source.split('\n');
  const found: EventRead[] = [];
  lines.forEach((ln, i) => {
    if (!FROM_EVENTS.test(ln)) return;
    const head = lines.slice(i, i + 7).join('\n');
    if (WRITE.test(lines.slice(i, i + 6).join('\n')) || BY_ID.test(head)) return;
    // La requête s'arrête à la prochaine `.from(` : chaque lecture ne voit que sa chaîne.
    const win = [ln];
    for (let j = i + 1; j < Math.min(lines.length, i + 24); j++) {
      if (/\.from\(/.test(lines[j])) break;
      win.push(lines[j]);
    }
    const chain = win.join('\n');
    if (SCOPE.test(chain) && !SAFE.test(chain)) found.push({ line: i + 1, text: ln.trim() });
  });
  return found;
}

/** Exceptions : le fichier lit `events` par portée SANS filtre, et c'est voulu. */
const ALLOWED: Record<string, string> = {
  'src/pages/EventDetails.tsx':
    'Les compteurs « Organisé par » (fetchStats) sont corrigés par la branche fix/event-page-simplify.',
  'src/hooks/useLiveNightData.ts':
    "Identifiants des soirées récentes du club pour filtrer le temps réel : un miroir n'a ni vente ni commande.",
  'src/hooks/useOwnerVipData.ts':
    "Filtre `tables_enabled = true` : un miroir est toujours à false (trigger force_external_event_private).",
  'src/components/owner/OwnerGuestListOrders.tsx':
    "Soirées du périmètre pour lire leurs parts de guest list : un miroir n'a aucune part.",
  'supabase/functions/send-push-campaign/index.ts':
    "Audience « tous les clients » = acheteurs des soirées de l'organisation : un miroir n'a aucun acheteur Yuno.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (['node_modules', '__tests__', 'dist', '.claude'].includes(name)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/_test\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('findUnfilteredEventReads', () => {
  it('signale une portée écrite à la main sans filtre', () => {
    const src = `const { data } = await supabase\n  .from('events')\n  .select('id')\n  .eq('venue_id', venueId);`;
    expect(findUnfilteredEventReads(src)).toHaveLength(1);
    const orString = "supabase.from('events').select('id').or(`organizer_user_id.eq.${id},partner_organizer_id.eq.${id}`);";
    expect(findUnfilteredEventReads(orString)).toHaveLength(1);
  });

  it('accepte external_source, is_active et les helpers de portée', () => {
    expect(findUnfilteredEventReads("supabase.from('events').select('id').eq('venue_id', v).is('external_source', null);")).toHaveLength(0);
    expect(findUnfilteredEventReads("supabase.from('events').select('id').eq('venue_id', v).eq('is_active', true);")).toHaveLength(0);
    expect(findUnfilteredEventReads("supabase.from('events').select('id').or(orgEventsOr(id));")).toHaveLength(0);
    expect(findUnfilteredEventReads("supabase.from('events').select('id').or(venueOwnEventsOr(id));")).toHaveLength(0);
  });

  it("ignore les lectures par identifiant et les écritures", () => {
    expect(findUnfilteredEventReads("supabase.from('events').select('venue_id').eq('id', eventId).maybeSingle();")).toHaveLength(0);
    expect(findUnfilteredEventReads("supabase.from('events').update({ a: 1 }).eq('venue_id', v);")).toHaveLength(0);
  });

  it("ne mélange pas deux requêtes voisines", () => {
    const src = [
      "const a = supabase.from('events').select('id').eq('venue_id', v);",
      "const b = supabase.from('tickets').select('id').eq('status', 'paid').is('external_source', null);",
    ].join('\n');
    expect(findUnfilteredEventReads(src)).toHaveLength(1);
  });
});

describe('Yuno CRM ⇄ Billetterie — les soirées miroir ne se lisent que par le CRM', () => {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'supabase', 'functions'))].filter(
    // La Console CRM et son admin lisent les miroirs exprès.
    (f) => !relative(ROOT, f).startsWith(join('src', 'crm') + '/'),
  );

  it('aucune lecture de la Billetterie ne liste les soirées d\'une portée sans écarter les miroirs', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f);
      if (ALLOWED[rel]) continue;
      for (const hit of findUnfilteredEventReads(readFileSync(f, 'utf8'))) offenders.push(`${rel}:${hit.line}  ${hit.text}`);
    }
    expect(offenders, `Ajouter .is('external_source', null) (ou orgEventsOr / venueEventsOr…) :\n${offenders.join('\n')}`).toEqual([]);
  });

  it("chaque exception déclarée existe encore et dit pourquoi", () => {
    for (const [rel, why] of Object.entries(ALLOWED)) {
      expect(why.length, rel).toBeGreaterThan(20);
      expect(() => statSync(join(ROOT, rel)), rel).not.toThrow();
    }
  });
});
