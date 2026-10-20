import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Les migrations d'isolation CRM ⇄ Billetterie réécrivent des fonctions SQL à
// partir de leur définition LIVE. Garde statique : chaque fonction réécrite
// pose `external_source`, garde la définition d'origine (md5 vérifié à
// l'application) et finit par ses REVOKE / GRANT explicites (CLAUDE.md :
// toute fonction SECURITY DEFINER), sans jamais ouvrir `anon`.

const DIR = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => /crm_billetterie_isolation/.test(f)).sort();

interface Fn { name: string; body: string; secdef: boolean }

function functionsOf(sql: string): Fn[] {
  const out: Fn[] = [];
  const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\$function\$([\s\S]*?)\$function\$;/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    out.push({ name: m[1], body: m[3], secdef: /SECURITY DEFINER/.test(m[2]) });
  }
  return out;
}

describe('migrations d\'isolation CRM ⇄ Billetterie', () => {
  it('les migrations existent', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    const fns = functionsOf(sql);

    // La migration des contacts ne filtre pas `external_source` : elle donne à la base de
    // contacts un produit (`p_product`, clé « …|crm ») que les appelants du CRM demandent.
    const isContacts = /isolation_(contacts|sms|consents)/.test(file);
    it(`${file} : réécrit des fonctions, chacune ${isContacts ? 'parle du produit' : 'écarte les miroirs'}`, () => {
      expect(fns.length).toBeGreaterThan(4);
      for (const f of fns) expect(f.body, f.name).toMatch(isContacts ? /p_product|'crm'|\|crm|external_source|connector:/ : /external_source/i);
    });

    it(`${file} : garde md5 de chaque fonction réécrite`, () => {
      const guard = sql.match(/FROM \(VALUES([\s\S]*?)\) AS v\(name, md5\)/);
      expect(guard).not.toBeNull();
      const guarded = [...guard![1].matchAll(/\('(\w+)', '[0-9a-f]{32}'\)/g)].map((x) => x[1]);
      // La migration SMS ne garde pas les trois fonctions que celle des contacts réécrit déjà, ni son trigger.
      const unguardedOk = /isolation_sms/.test(file) ? ['sms_campaign_set_product', 'crm_home__core', '_crm_admin_rows', '_mcp_tool'] : [];
      expect(guarded.sort()).toEqual(fns.map((f) => f.name).filter((n) => !unguardedOk.includes(n)).sort());
    });

    it(`${file} : REVOKE ... FROM PUBLIC, anon puis GRANT explicite, jamais anon`, () => {
      // Une fonction de trigger garde ses droits (rien ne l'appelle directement).
      const NO_GRANT = ['sms_campaign_set_product', '_mcp_tool', '_resolve_meta_audience_rows'];   // trigger / exécution réservée au propriétaire
      for (const f of fns.filter((x) => x.secdef && x.name !== 'contact_base_cache_invalidate')) {
        expect(sql, f.name).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f.name}\\([^)]*\\) FROM PUBLIC, anon`));
        if (!NO_GRANT.includes(f.name)) expect(sql, f.name).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f.name}\\([^)]*\\) TO (authenticated, )?service_role;`));
      }
      expect(sql).not.toMatch(/GRANT[^;]*\banon\b/);
    });
  }
});

describe('SMS : un produit par campagne', () => {
  const sms = readFileSync(join(DIR, files.find((f) => /isolation_sms/.test(f))!), 'utf8');

  it('la colonne, son trigger dérivé et le rattrapage existent', () => {
    expect(sms).toMatch(/ADD COLUMN IF NOT EXISTS product text/);
    expect(sms).toMatch(/CREATE TRIGGER trg_0_sms_campaign_product\s+BEFORE INSERT OR UPDATE OF segment_filters, product/);
    expect(sms).toMatch(/UPDATE public\.sms_campaigns\s+SET product = 'crm'/);
  });

  it('chaque lecteur du CRM filtre le produit (liste, chiffres, écritures)', () => {
    for (const fn of ['_crm_sms_stats', 'crm_sms_campaigns__core', 'crm_sms_overview__core', 'crm_sms_result__core', 'crm_sms_duplicate',
      'crm_sms_delete', 'crm_sms_save', 'crm_sms_schedule', 'crm_sms_unschedule', '_crm_msg_build', 'get_crm_wallet', 'get_crm_shell']) {
      const m = sms.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$;`));
      expect(m, fn).not.toBeNull();
      expect(m![0], fn).toMatch(/product\s*=\s*'crm'/);
    }
  });

  it('la liste SMS de la Billetterie masque les SMS du CRM', () => {
    const panel = readFileSync(join(process.cwd(), 'src', 'components', 'sms', 'SmsCampaignsPanel.tsx'), 'utf8');
    expect(panel).toContain("product.is.null,product.neq.crm");
  });
});

// ── Séparation stricte (20/10) : un produit par ligne ───────────────────────────────────────────
// NULL = Yuno Tickets, 'crm' = Yuno CRM. Les index d'unicité des tables partagées citent le produit :
// un écrivain qui garde l'ancienne cible `ON CONFLICT` lève « no unique constraint matching » (42P10),
// donc un achat ou un import cassé. Ce test lit l'ÉTAT FINAL des fonctions du dépôt.
describe('séparation stricte : un produit par ligne', () => {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const latest = new Map<string, { file: string; text: string }>();
  for (const f of all) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    const re = /CREATE OR REPLACE (?:FUNCTION|PROCEDURE) public\.(\w+)\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/g;
    for (let m = re.exec(sql); m; m = re.exec(sql)) latest.set(m[1], { file: f, text: m[0] });
  }
  const columns = readFileSync(join(DIR, files.length ? '20261107115000_crm_billetterie_separation_columns.sql' : ''), 'utf8');
  const cutover = readFileSync(join(DIR, '20261107140000_crm_billetterie_separation_cutover.sql'), 'utf8');

  it('les deux migrations de séparation existent, dans l\'ordre : socle, isolation contacts / SMS, bascule', () => {
    const order = all.filter((f) => /20261107\d+_crm_billetterie_(isolation|separation)/.test(f));
    expect(order.indexOf('20261107115000_crm_billetterie_separation_columns.sql')).toBeLessThan(order.findIndex((f) => /isolation_contacts/.test(f)));
    expect(order.findIndex((f) => /isolation_sms/.test(f))).toBeLessThan(order.indexOf('20261107140000_crm_billetterie_separation_cutover.sql'));
  });

  it('chaque table partagée reçoit sa colonne product (NULL ou \'crm\') et un index d\'unicité par produit', () => {
    for (const t of ['newsletter_subscriptions', 'email_opt_outs', 'contact_list_imports', 'email_list_imports', 'sms_list_imports',
      'imported_contacts', 'venue_sms_contacts', 'email_campaign_templates', 'contact_engagement']) {
      expect(columns, t).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS product text`));
    }
    expect(columns).toMatch(/uniq_newsletter_subs_email_venue_product[\s\S]*?NULLS NOT DISTINCT/);
    expect(columns).toMatch(/uniq_newsletter_subs_email_organizer_product[\s\S]*?NULLS NOT DISTINCT/);
    expect(columns).toMatch(/venue_sms_contacts_unique_scope_phone_product[\s\S]*?NULLS NOT DISTINCT/);
    expect(columns).toMatch(/CREATE OR REPLACE FUNCTION public\._separation_default_product\(\)/);
  });

  it('la bascule retire les anciens index ET remplace les écrivains dans la même migration', () => {
    expect(cutover).toMatch(/DROP INDEX IF EXISTS public\.uniq_newsletter_subs_email_venue;/);
    expect(cutover).toMatch(/DROP INDEX IF EXISTS public\.uniq_newsletter_subs_email_organizer;/);
    expect(cutover).toMatch(/CREATE OR REPLACE FUNCTION public\.auto_subscribe_newsletter_on_purchase\(/);
    expect(cutover).toMatch(/CREATE OR REPLACE FUNCTION public\.import_email_contacts\(/);
    expect(cutover).toMatch(/NOTIFY pgrst, 'reload schema';/);
    expect(cutover).toMatch(/FROM \(VALUES[\s\S]*?\) AS v\(sig, md5\)/);   // garde md5 de chaque fonction remplacée
  });

  it('aucune fonction (état final) ne vise encore l\'ancien index du registre ou des contacts SMS', () => {
    const stale: string[] = [];
    for (const [name, { file, text }] of latest) {
      if (/ON CONFLICT \(lower\(email\), (venue_id|organizer_user_id)\)/.test(text)) stale.push(`${name} (${file}) : registre sans produit`);
      if (/ON CONFLICT \((venue_id|organizer_user_id), phone_e164\)/.test(text)) stale.push(`${name} (${file}) : contacts SMS sans produit`);
      if (/ON CONFLICT \(lower\(email\), (venue_id|organizer_user_id)\)[^;]*email_opt_outs|email_opt_outs[\s\S]{0,400}ON CONFLICT \(lower\(email\), (venue_id|organizer_user_id)\)/.test(text)) stale.push(`${name} (${file}) : repoussoir sans produit`);
    }
    expect(stale).toEqual([]);
  });

  it('aucun upsert du front ni de l\'edge ne vise une cible d\'unicité disparue', () => {
    const offenders: string[] = [];
    const walkDir = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = join(dir, d.name);
      if (d.isDirectory()) return ['node_modules', '__tests__', 'dist'].includes(d.name) ? [] : walkDir(p);
      return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
    });
    for (const root of ['src', join('supabase', 'functions')]) {
      for (const f of walkDir(join(process.cwd(), root))) {
        const text = readFileSync(f, 'utf8');
        if (/onConflict:\s*["'](venue_id|organizer_user_id),phone_e164["']/.test(text)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('chaque nouvelle signature de la bascule supprime l\'ancienne (jamais de surcharge ambiguë)', () => {
    const drops = [...cutover.matchAll(/DROP (?:FUNCTION|PROCEDURE) IF EXISTS public\.(\w+)\(/g)].map((m) => m[1]);
    expect(drops.length).toBeGreaterThan(10);
    for (const name of drops) expect(cutover, name).toMatch(new RegExp(`CREATE OR REPLACE (FUNCTION|PROCEDURE) public\\.${name}\\(`));
  });
});
