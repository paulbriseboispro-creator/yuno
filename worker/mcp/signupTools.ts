// Les outils « pages d'inscription » du serveur MCP : le kit de design (lecture
// enrichie des types, gabarits, modèle sur mesure, balises, règles), la lecture
// d'une page pour l'itérer, et l'écriture (préparer → contrôler → mcp_write).
// Rien ne publie : une page créée est un brouillon, une page publiée reçoit une
// proposition que le pro applique dans la Console.

import { compactResult } from './compact';
import { rpc } from './db';
import type { McpEnv } from './config';
import { normalizeCustomDesign, type CustomDesign, type PageIssue } from '../../src/crm/signup/custom';
import {
  applyPageSectionUpdates, buildDesign, checkPage, pageConsoleUrl, pagePublicUrl, pageTagPreview, sectionView, settingsPatch, templateFallback,
  type EventFactsLite, type PageArgs, type PreparedDesign,
} from './signupDesign';
import {
  CUSTOM_DESIGN_MODEL, EXAMPLE_PAGE, PAGE_DESIGN_METHOD, PAGE_KIND_RULES, PAGE_TAG_SYNTAX, PAGE_WEB_RULES, TEMPLATE_FONTS_HELP,
  pageTagReference, templateCatalog,
} from './signupGuide';

interface CallEnvelope {
  ok: boolean;
  error?: string;
  call_id?: number;
  space?: { key: string; name: string; kind: string; product: string };
  spaces?: unknown;
  result?: Record<string, unknown> | null;
}

export interface PageToolOutcome { text: string; isError: boolean; code?: string; callId?: number }

/** Messages d'erreur des outils de pages, écrits pour que l'IA sache quoi faire. */
export function pageErrorText(code: string, extra: Record<string, unknown> = {}): string {
  switch (code) {
    case 'pages_not_allowed':
      return 'This connection was approved before signup pages existed, or without them: Yuno cannot write pages for it. The person can reconnect Yuno in their AI app (the consent screen includes signup pages). Meanwhile, describe the page in the conversation.';
    case 'write_forbidden':
      return 'This person cannot edit signup pages in this space of the Yuno Console (owner, admin or editor of Yuno CRM). Ask which space to use.';
    case 'crm_not_active':
      return 'Signup pages are a Yuno CRM feature, and Yuno CRM is not active on this space. Another space of the connection may have it (get_account_overview lists them).';
    case 'page_not_found':
      return 'No signup page with this id in this space. get_signup_page_kit lists the pages with their ids.';
    case 'page_changed':
      return 'The page changed since you read it (the person edited it in the Console). Nothing was written. Call get_signup_page again and apply the change to the new version (pass its "version" as page_version).';
    case 'event_not_found':
      return 'No night of this space matches "event". get_signup_page_kit lists the upcoming nights with their ids.';
    case 'invalid_fields':
      return 'The form fields are not valid: contact both, email, phone or all; two questions at most, each with 2 to 6 answers of 40 characters at most.';
    case 'invalid_dates':
      return 'A date is not valid: use ISO 8601 with a timezone offset, and a closing mode that fits the page type (see page_kinds in get_signup_page_kit).';
    case 'invalid_content':
      return 'The custom design was refused by Yuno (structure, size, or forbidden content such as scripts or event handlers). Rebuild it with sections and exactly one form block.';
    case 'nothing_to_change':
      return 'Nothing to change was given: pass settings, theme, sections or section_updates.';
    case 'rate_limited':
      return 'Too many signup page changes for this connection today (20 pages created, 200 updates). Reuse update_signup_page on an existing page.';
    case 'space_not_allowed':
      return `This space is not part of the connection. Spaces: ${JSON.stringify(extra.spaces ?? [])}.`;
    case 'invalid_args':
      return `Invalid arguments${extra.message ? `: ${String(extra.message)}` : ''}.`;
    default:
      return 'The page could not be saved on the Yuno side. Try again in a moment.';
  }
}

async function call(env: McpEnv, accessHash: string, tool: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<CallEnvelope> {
  return rpc<CallEnvelope>(env, 'mcp_call', { p_access_hash: accessHash, p_tool: tool, p_args: args }, timeoutMs);
}

const langOf = (v: unknown): 'fr' | 'en' | 'es' => (v === 'en' || v === 'es' ? v : 'fr');

/** Le design que l'IA itère : sa proposition en attente si elle en a une, sinon celui de la page. */
function workingDesign(page: Record<string, unknown>): { design: CustomDesign | null; source: 'proposal' | 'page' | 'none' } {
  const prop = page.proposal as Record<string, unknown> | null | undefined;
  if (prop && Object.prototype.hasOwnProperty.call(prop, 'custom_design')) {
    const d = normalizeCustomDesign(prop.custom_design);
    return { design: d, source: d ? 'proposal' : 'none' };
  }
  const d = normalizeCustomDesign(page.custom_design);
  return { design: d, source: d ? 'page' : 'none' };
}

// ── Lecture ──────────────────────────────────────────────────────────────────

/** Mise en forme d'une lecture de page (kit ou page), images gardées. */
export function formatPageRead(tool: string, space: CallEnvelope['space'], inner: Record<string, unknown>, personLang: string | null | undefined): string {
  if (tool === 'get_signup_page_kit') {
    const ev = (inner.event ?? null) as EventFactsLite | null;
    const brand = (inner.brand ?? {}) as Record<string, unknown>;
    const social = (brand.social ?? {}) as Record<string, unknown>;
    const lang = langOf(inner.language_hint ?? personLang);
    const out: Record<string, unknown> = {
      space,
      ...inner,
      page_kinds: PAGE_KIND_RULES,
      templates: templateCatalog(),
      template_fonts: TEMPLATE_FONTS_HELP,
      custom_design: CUSTOM_DESIGN_MODEL,
      page_tags: { syntax: PAGE_TAG_SYNTAX, tags: pageTagReference() },
      tag_preview: pageTagPreview({
        lang, kind: 'prevente', poster: ev?.cover_url ?? null,
        host: { name: String(brand.name ?? space?.name ?? ''), logo: brand.logo_url as string | null, city: brand.city as string | null, instagram: social.instagram as string | null },
        event: ev,
      }),
      web_rules: PAGE_WEB_RULES,
      design_method: PAGE_DESIGN_METHOD,
      example: EXAMPLE_PAGE,
      pages_are_drafts: 'create_signup_page saves a DRAFT in the Yuno CRM Console; only the person publishes it. update_signup_page on a published page saves a PROPOSAL the person applies or ignores: visitors never see a change they did not approve.',
    };
    return compactResult(out, 90_000, { keepImages: true });
  }
  // get_signup_page
  const page = { ...inner };
  const { design, source } = workingDesign(page);
  const prop = page.proposal as Record<string, unknown> | null | undefined;
  const id = String(page.page_id || '');
  const out: Record<string, unknown> = {
    space,
    ...page,
    console_url: pageConsoleUrl(id, page.status === 'draft'),
    ...(page.status !== 'draft' && page.slug ? { public_url: pagePublicUrl(String(page.slug)) } : {}),
    design: design
      ? { mode: 'custom', source, theme: design.theme, sections: design.sections.map((s, i) => sectionView(s, i)) }
      : { mode: 'template', template: page.template },
    ...(prop ? {
      proposal: {
        pending: true,
        prepared_by: prop.author, at: prop.at, changes: prop.changes,
        settings: prop.patch,
        note: 'Visitors still see the published page. The design above is your pending proposal: further updates add to it, and the person applies or ignores it in the Console.',
      },
    } : {}),
    editing: 'To change this page, call update_signup_page with page_version = version and only what changes: settings (title, tagline, fields…), theme (partial: only the keys to change), '
      + 'section_updates by section id (edit html/css/label/show_on, remove, insert_before / insert_after a new html section or yuno_block, move with move_to), '
      + 'or sections to replace every section. Match what the person shows on a screenshot with the "text" of each section. The form block cannot be removed.',
  };
  delete out.custom_design;
  delete out.venue_id;
  delete out.organizer_user_id;
  const text = JSON.stringify(out);
  return text.length <= 220_000 ? text : compactResult(out, 220_000, { keepImages: true });
}

// ── Écriture ─────────────────────────────────────────────────────────────────

function issueList(issues: PageIssue[]) {
  return issues.map((i) => (i.section != null ? { section: i.section, code: i.code, message: i.message } : { code: i.code, message: i.message }));
}

const NIGHT_KINDS = new Set(['prevente', 'venue']);

export async function runPageWrite(
  env: McpEnv,
  accessHash: string,
  tool: 'create_signup_page' | 'update_signup_page',
  a: PageArgs,
): Promise<PageToolOutcome> {
  const isCreate = tool === 'create_signup_page';
  let current: Record<string, unknown> | null = null;

  // 1. La page actuelle (modification) : réglages, design, proposition, version.
  if (!isCreate) {
    const r = await call(env, accessHash, 'get_signup_page', { ...(a.space ? { space: a.space } : {}), page_id: a.page_id });
    if (r.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
    if (!r.ok || !r.result || r.result.ok === false) {
      const code = String(r.result?.error ?? r.error ?? 'page_not_found');
      return { text: pageErrorText(code, { spaces: r.spaces }), isError: true, code };
    }
    current = r.result;
    if (a.page_version && current.version && String(a.page_version) !== String(current.version)) {
      const { design } = workingDesign(current);
      return {
        text: JSON.stringify({
          saved: false,
          error: 'page_changed',
          message: pageErrorText('page_changed'),
          current_version: current.version,
          current_sections: design ? design.sections.map((s, i) => { const v = sectionView(s, i); return { index: v.index, id: v.id, label: v.label, text: v.text, yuno_block: v.yuno_block }; }) : [],
        }),
        isError: true,
        code: 'page_changed',
      };
    }
  }
  const kind = String(a.kind ?? current?.kind ?? 'prevente');

  // 2. Les réglages, dans la forme de la Console.
  const settings = settingsPatch(a, kind);

  // 3. Le design : gabarit, sur mesure (créé, remplacé, modifié), ou inchangé.
  let custom: CustomDesign | null | undefined; // undefined = inchangé
  let removed: PreparedDesign['removed'] = [];
  let notes: string[] = [];
  let changes: string[] = [];
  const designErrors: PageIssue[] = [];
  const base = current ? workingDesign(current).design : null;
  if (a.design_mode === 'template') {
    custom = null;
    changes.push('switched back to a Yuno template');
  } else if (a.sections?.length) {
    const prepared = buildDesign(a.theme, a.sections, base?.theme);
    if (prepared.error) designErrors.push({ code: prepared.error.code, level: 'error', message: prepared.error.message });
    custom = prepared.design;
    removed = prepared.removed;
    notes = prepared.notes;
    if (!isCreate) changes.push(`replaced every section (${prepared.design.sections.length})`);
  } else if (a.section_updates?.length) {
    if (!base) {
      designErrors.push({ code: 'not_custom', level: 'error', message: 'This page uses a Yuno template: there are no sections to update. Send theme + sections to give it a custom design, or "template" to restyle the template.' });
    } else {
      const r = applyPageSectionUpdates(base, a.section_updates, a.theme);
      if (r.error) return { text: r.error.message, isError: true, code: r.error.code };
      custom = r.design!;
      removed = r.removed;
      changes = r.changes;
      if (a.theme) changes.push('updated the theme');
    }
  } else if (a.theme) {
    if (!base) {
      designErrors.push({ code: 'not_custom', level: 'error', message: isCreate
        ? 'A custom design needs sections (at least {"yuno_block": "form"}) with the theme. For a Yuno template, use "template" instead of "theme".'
        : 'This page uses a Yuno template: a theme needs sections. Send theme + sections (at least the form block) for a custom design, or use "template" to change the template colors.' });
    } else {
      custom = normalizeCustomDesign({ ...base, theme: { ...base.theme, ...a.theme } })!;
      changes.push('updated the theme');
    }
  }
  if (custom && isCreate && !a.template) settings.patch.design = templateFallback(custom.theme);
  if (!isCreate && a.template) changes.push('updated the template');
  for (const k of ['title', 'tagline', 'button_label', 'thanks_message', 'poster_url', 'fields', 'reward', 'show_count', 'countdown', 'opens_at', 'sale_opens_at', 'closes_mode', 'closes_at', 'lang', 'kind'] as const) {
    if (!isCreate && k in settings.patch) changes.push(`changed ${k === 'lang' ? 'language' : k.replace(/_/g, ' ')}`);
  }
  if (!isCreate && a.event !== undefined) changes.push('changed the night');

  // 4. Contrôle : une erreur arrête tout, rien n'est écrit.
  const willHaveEvent = a.event !== undefined ? !!a.event && !/^(none|null)$/i.test(a.event) : !!(current?.event);
  const checkDesign = custom === undefined ? null : custom;
  const check = checkPage({ design: checkDesign, removed, hasEvent: willHaveEvent, settingErrors: [...settings.errors, ...designErrors], notes });
  if (NIGHT_KINDS.has(kind) && !willHaveEvent && (isCreate || a.event !== undefined || a.kind)) {
    check.warnings.push({ code: 'no_night', level: 'warning', message: 'This page type is about a night but none is linked: the page will say "Date to be announced". Pass "event" when the night exists.' });
  }
  if (check.errors.length) {
    return {
      text: JSON.stringify({ saved: false, message: 'Nothing was saved: fix these points, then call the tool again.', errors: issueList(check.errors), warnings: issueList(check.warnings) }),
      isError: true,
      code: 'checks_failed',
    };
  }

  // 5. Écriture (mcp_write) : droits, débits et brouillon / proposition décidés en base.
  const payload: Record<string, unknown> = { ...settings.patch };
  if (a.space) payload.space = a.space;
  if (!isCreate) {
    payload.page_id = a.page_id;
    if (current?.version) payload.expected_version = String(current.version);
    payload.changes = changes.slice(0, 20);
  }
  if (a.event !== undefined) payload.event = a.event;
  if (custom !== undefined) payload.custom_design = custom;

  const w = await rpc<CallEnvelope>(env, 'mcp_write', { p_access_hash: accessHash, p_tool: tool, p_args: payload }, 28_000);
  if (w.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
  const res = w.result ?? {};
  if (!w.ok || res.ok === false) {
    const code = String(res.error ?? w.error ?? 'internal');
    return { text: pageErrorText(code, { spaces: w.spaces, message: res.detail }), isError: true, code, callId: w.call_id };
  }

  const id = String(res.page_id || '');
  const mode = String(res.mode || (isCreate ? 'created' : 'updated'));
  const out = {
    saved: true,
    published: false,
    mode,
    page: {
      id, title: res.title, kind: res.kind, state: res.state, language: res.lang,
      design: res.design_mode, sections: res.sections ?? undefined, version: res.version,
      event: res.event,
    },
    ...(changes.length ? { changes } : {}),
    console_url: pageConsoleUrl(id, mode !== 'proposed' && res.status === 'draft'),
    ...(res.status !== 'draft' && res.slug ? { public_url: pagePublicUrl(String(res.slug)) } : {}),
    checks: {
      warnings: issueList(check.warnings),
      ...(removed.length ? { removed_by_yuno: removed } : {}),
    },
    space: w.space,
    next: mode === 'proposed'
      ? 'This page is published: nothing changed for visitors. The person sees the proposal on the page in the Yuno CRM Console (console_url), previews it and applies or ignores it. Further updates add to the same proposal.'
      : `The page is a DRAFT in the Yuno CRM Console (console_url, with a live phone preview). Nothing is public until ${res.can_publish ? 'the person publishes it there' : 'the account owner publishes it there'}. For further changes, pass page.version as page_version.`,
  };
  return { text: JSON.stringify(out), isError: false, callId: w.call_id };
}
