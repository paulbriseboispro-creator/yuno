// Les outils d'e-mail du serveur MCP : le kit de design (lecture enrichie des
// règles, des balises et de leur aperçu), et l'écriture d'un BROUILLON
// (préparer → contrôler → mcp_write). Aucun envoi, jamais.
//
// La base décide des droits (mcp_write : permission de la connexion, droit
// d'écrire dans l'espace, statut 'draft', débits) ; ce module prépare le
// contenu et refuse ce qui casserait l'e-mail avant d'écrire quoi que ce soit.

import { smartLang, type SmartLang } from '../../supabase/functions/_shared/email-smart';
import { compactResult } from './compact';
import { rpc } from './db';
import {
  applySectionUpdates, blocksNeedEvent, blockToSectionView, checkDraft, consoleUrl, factsToSmartEvent, sectionsToBlocks, tagPreview, themeFromInput,
  type EventFacts, type SectionInput, type SectionUpdate, type ThemeInput,
} from './emailDraft';
import { fetchRemoteImage, imageFailureText, storeSlotImage } from './emailImages';
import { EMAIL_DESIGN_METHOD, EMAIL_HTML_RULES, EXAMPLE_SECTION, smartTagReference } from './emailGuide';
import type { McpEnv } from './config';

interface CallEnvelope {
  ok: boolean;
  error?: string;
  message?: string;
  call_id?: number;
  space?: { key: string; name: string; kind: string; product: string };
  spaces?: unknown;
  result?: Record<string, unknown> | null;
}

export interface EmailToolOutcome { text: string; isError: boolean; code?: string; callId?: number }

const MAX_EMAIL_CHARS = 90_000;

/** Messages d'erreur des outils d'e-mail, écrits pour que l'IA sache quoi faire. */
export function emailErrorText(code: string, extra: Record<string, unknown> = {}): string {
  switch (code) {
    case 'drafts_not_allowed':
      return 'This connection was approved before email drafts existed, or without them: Yuno cannot create drafts for it. The person can reconnect Yuno in their AI app (the consent screen includes email drafts). Meanwhile, share the email as HTML in the conversation.';
    case 'write_forbidden':
      return 'This person cannot create emails in this space in the Yuno Console (for a club: the owner only; for an organization: the founder; for Yuno CRM: owner, admin or editor). Ask them which space to use, or share the email as HTML.';
    case 'product_not_available':
      return `This product is not active on this space. Products available: ${JSON.stringify(extra.products ?? [])}.`;
    case 'draft_not_found':
      return 'No email draft with this id in this space. get_email_design_kit lists the recent drafts.';
    case 'draft_changed':
      return 'The draft changed since you read it (the person edited it in the Console, or another change was saved). Nothing was written. Call get_email_draft again and apply the change to the new version (pass its "version" as draft_version).';
    case 'draft_not_editable':
      return `This email is not a draft anymore (status ${String(extra.status ?? 'unknown')}): it cannot be changed. Create a new draft instead (its design can be read with get_email_draft).`;
    case 'event_not_found':
      return 'No event of this space matches "event". get_email_design_kit lists the upcoming events with their ids.';
    case 'audience_not_found':
      return `Unknown audience "${String(extra.audience ?? '')}" for this space and product. Use an id from list_email_audiences.`;
    case 'invalid_content':
      return 'The sections are not valid (1 to 40 sections, total under 300 KB).';
    case 'ab_not_in_plan':
      return 'A/B subject tests are not included in this account plan: remove subject_b.';
    case 'sending_frozen':
      return 'Email sending is paused on this account by Yuno: drafts cannot be prepared right now.';
    case 'rate_limited':
      return 'Too many drafts for this connection today (30 created, 200 updates). Reuse update_email_draft on an existing draft.';
    case 'space_not_allowed':
      return `This space is not part of the connection. Spaces: ${JSON.stringify(extra.spaces ?? [])}.`;
    case 'invalid_args':
      return `Invalid arguments${extra.message ? `: ${String(extra.message)}` : ''}.`;
    default:
      return 'The draft could not be saved on the Yuno side. Try again in a moment.';
  }
}

async function call(env: McpEnv, accessHash: string, tool: string, args: Record<string, unknown>, timeoutMs = 25_000): Promise<CallEnvelope> {
  return rpc<CallEnvelope>(env, 'mcp_call', { p_access_hash: accessHash, p_tool: tool, p_args: args }, timeoutMs);
}

// ── Lecture : kit, audiences, brouillon ──────────────────────────────────────

/** Ajoute au kit lu en base les règles, la méthode, les balises et leur aperçu. */
export function enrichKit(result: Record<string, unknown>, lang: SmartLang): Record<string, unknown> {
  const facts = (result.event ?? null) as EventFacts | null;
  const preview = tagPreview(factsToSmartEvent(facts), smartLang((result.language_hint as string) || lang));
  return {
    ...result,
    smart_tags: {
      syntax: 'Handlebars: {{value}}, {{#if x}}…{{else}}…{{/if}}, {{#unless x}}…{{/unless}}, {{#each list}}…{{/each}} with {{@first}} and {{@last}}. Inside {{#each tickets}} use {{name}}, {{price}}, {{detail}}, {{sold_out}}; inside {{#each lineup}} use {{name}}, {{photo}}, {{initials}}; inside {{#each tables.packs}} or {{#each tables.zones}} use {{name}}, {{detail}}, {{price}}. Every value is escaped (no {{{raw}}}). Values are read again when the email leaves.',
      tags: smartTagReference(),
    },
    ...(preview ? { tag_preview: preview } : {}),
    html_rules: EMAIL_HTML_RULES,
    design_method: EMAIL_DESIGN_METHOD,
    example_section: EXAMPLE_SECTION,
    drafts: 'create_email_draft saves a DRAFT in the Yuno Console; nothing is ever sent by the AI. The person reviews, adjusts and sends it from the Console link returned.',
  };
}

/** Mise en forme d'une réponse de lecture e-mail (images gardées). */
export function formatEmailRead(tool: string, space: CallEnvelope['space'], inner: Record<string, unknown>, lang: SmartLang): string {
  if (tool === 'get_email_design_kit') {
    return compactResult({ space, ...enrichKit(inner, lang) }, 80_000, { keepImages: true });
  }
  if (tool === 'get_email_draft') {
    const sections = Array.isArray(inner.sections) ? (inner.sections as Record<string, unknown>[]) : [];
    const out = {
      space,
      ...inner,
      console_url: consoleUrl(String(inner.product || 'suite'), String(inner.draft_id || ''), inner.venue_id as string | null, inner.organizer_user_id as string | null),
      sections: sections.map((b, index) => blockToSectionView(b, index)),
      editing: 'To change this draft, call update_email_draft with draft_version = version and section_updates that target sections by id: '
        + 'action edit (new html, or options of a native block, label, show_to, background, padding), remove, insert_before / insert_after (a new html section or yuno_block), '
        + 'or move (move_to). Match what the person shows on a screenshot with the "text" of each section. Change only what was asked.',
    };
    delete (out as Record<string, unknown>).venue_id;
    delete (out as Record<string, unknown>).organizer_user_id;
    delete (out as Record<string, unknown>).blocks_version;
    // Le contenu d'un brouillon se rend tel quel (HTML compris) : une version
    // tronquée serait réécrite tronquée.
    const text = JSON.stringify(out);
    return text.length <= 200_000 ? text : compactResult(out, 200_000, { keepImages: true });
  }
  return compactResult({ space, ...inner }, 60_000, { keepImages: true });
}

// ── Écriture d'un brouillon ──────────────────────────────────────────────────

interface WriteArgs {
  space?: string;
  draft_id?: string;
  draft_version?: string;
  product?: string;
  event?: string;
  name?: string;
  subject?: string;
  subject_b?: string;
  preheader?: string;
  language?: string;
  audience?: string[];
  audience_label?: string;
  exclude_event_buyers?: boolean;
  exclude_recent_days?: number;
  theme?: ThemeInput;
  sections?: SectionInput[];
  section_updates?: SectionUpdate[];
}

function issueList(issues: { code: string; message: string; section?: number }[]) {
  return issues.map((i) => (i.section != null ? { section: i.section, code: i.code, message: i.message } : { code: i.code, message: i.message }));
}

export async function runEmailWrite(
  env: McpEnv,
  accessHash: string,
  tool: 'create_email_draft' | 'update_email_draft',
  a: WriteArgs,
  personLang: string | null | undefined,
): Promise<EmailToolOutcome> {
  const isCreate = tool === 'create_email_draft';
  let current: Record<string, unknown> | null = null;

  // 1. Le brouillon actuel (modification) : ses sections, sa soirée.
  if (!isCreate) {
    const r = await call(env, accessHash, 'get_email_draft', { ...(a.space ? { space: a.space } : {}), draft_id: a.draft_id });
    if (r.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
    if (!r.ok || !r.result || r.result.ok === false) {
      const code = String(r.result?.error ?? r.error ?? 'draft_not_found');
      return { text: emailErrorText(code, { spaces: r.spaces }), isError: true, code };
    }
    current = r.result;
    if (current.status !== 'draft') return { text: emailErrorText('draft_not_editable', { status: current.status }), isError: true, code: 'draft_not_editable' };
    // L'IA modifie la version qu'elle a lue : si le pro l'a retouchée dans le
    // Studio entre-temps, ses index et son HTML ne correspondent plus.
    if (a.draft_version && current.version && String(a.draft_version) !== String(current.version)) {
      const now = Array.isArray(current.sections) ? (current.sections as Record<string, unknown>[]) : [];
      return {
        text: JSON.stringify({
          saved: false,
          error: 'draft_changed',
          message: emailErrorText('draft_changed'),
          current_version: current.version,
          current_sections: now.map((b, i) => {
            const v = blockToSectionView(b, i);
            return { index: v.index, id: v.id, label: v.label, text: v.text };
          }),
        }),
        isError: true,
        code: 'draft_changed',
      };
    }
  }
  // Langue de l'e-mail : celle demandée, sinon celle du brouillon, sinon celle de la personne.
  const lang = smartLang(a.language ?? (current?.language as string | undefined) ?? personLang);

  // 2. Les sections : remplacées, modifiées, ou inchangées.
  let blocks: Record<string, unknown>[] | undefined;
  let removed: { section: number; elements: string[] }[] = [];
  let changes: string[] = [];
  if (a.sections?.length) {
    const prepared = sectionsToBlocks(a.sections, lang);
    blocks = prepared.blocks;
    removed = prepared.removed;
    if (!isCreate) changes = [`replaced every section (${blocks.length})`];
  } else if (a.section_updates?.length && current) {
    const curBlocks = Array.isArray(current.sections) ? (current.sections as Record<string, unknown>[]) : [];
    const r = applySectionUpdates(curBlocks, a.section_updates, lang);
    if (r.error) return { text: r.error.message, isError: true, code: r.error.code };
    blocks = r.blocks;
    removed = r.removed;
    changes = r.changes;
  }
  if (isCreate && !blocks?.length) return { text: emailErrorText('invalid_content'), isError: true, code: 'invalid_content' };
  const finalBlocks = blocks ?? (Array.isArray(current?.sections) ? (current!.sections as Record<string, unknown>[]) : []);

  // 3. La soirée : faits lus pour contrôler les sections.
  const currentEvent = (current?.event as { id?: string } | null)?.id;
  const eventRef = a.event ?? currentEvent;
  const unlink = !!a.event && /^(none|null)$/i.test(a.event);
  let facts: EventFacts | null = null;
  if (eventRef && !unlink) {
    const r = await call(env, accessHash, 'get_email_design_kit', {
      ...(a.space ? { space: a.space } : {}),
      ...(a.product ? { product: a.product } : current?.product ? { product: current.product } : {}),
      event: eventRef,
    });
    if (r.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
    if (!r.ok || !r.result || r.result.ok === false) {
      const code = String(r.result?.error ?? r.error ?? 'internal');
      return { text: emailErrorText(code, { products: r.result?.products }), isError: true, code };
    }
    facts = (r.result.event ?? null) as EventFacts | null;
  }
  const hasEvent = !!facts;
  if (!hasEvent && blocksNeedEvent(finalBlocks) && (isCreate || blocks || unlink)) {
    return { text: 'The sections use event tags or Yuno blocks but no event is linked: pass "event" (an id from get_email_design_kit.upcoming_events, "next", or part of the title).', isError: true, code: 'event_tags_without_event' };
  }

  // 4. Contrôle : une erreur arrête tout, rien n'est écrit.
  const subjectB = a.subject_b === undefined ? undefined : /^none$/i.test(a.subject_b) ? '' : a.subject_b;
  const check = checkDraft({
    blocks: finalBlocks,
    subject: isCreate ? a.subject ?? '' : a.subject ?? null,
    subjectB: subjectB ?? null,
    preheader: isCreate ? a.preheader ?? '' : a.preheader ?? null,
    hasEvent,
    facts,
    lang,
    requireSubject: isCreate,
  });
  if (check.estimated_kb * 1000 > MAX_EMAIL_CHARS && !check.errors.some((e) => e.code === 'email_too_large')) {
    check.errors.push({ code: 'email_too_large', level: 'error', message: `The email weighs about ${check.estimated_kb} KB: keep it under 90 KB (Gmail clips at 102 KB and hides the footer).` });
  }
  if (check.errors.length) {
    return {
      text: JSON.stringify({
        saved: false,
        message: 'Nothing was saved: fix these points, then call the tool again.',
        errors: issueList(check.errors),
        warnings: issueList(check.warnings),
      }),
      isError: true,
      code: 'checks_failed',
    };
  }

  // 5. Écriture (mcp_write) : droits, débits et statut décidés en base.
  const payload: Record<string, unknown> = {};
  if (a.space) payload.space = a.space;
  if (!isCreate) {
    payload.draft_id = a.draft_id;
    // Écriture atomique : la base refuse si le brouillon a bougé depuis la
    // lecture qui a servi à calculer ces sections.
    if (current?.version) payload.expected_version = String(current.version);
  }
  if (a.product) payload.product = a.product;
  if (a.event !== undefined) payload.event = unlink ? 'none' : a.event;
  if (a.name) payload.name = a.name;
  if (a.subject) payload.subject = a.subject;
  if (subjectB !== undefined) payload.subject_b = subjectB;
  if (a.preheader !== undefined) payload.preheader = a.preheader;
  if (a.language) payload.language = a.language;
  if (a.audience) payload.audience = a.audience;
  if (a.audience_label) payload.audience_label = a.audience_label;
  if (a.exclude_event_buyers !== undefined || a.exclude_recent_days !== undefined || isCreate) {
    payload.exclusions = {
      recentDays: a.exclude_recent_days === undefined ? (isCreate ? 3 : (current?.exclusions as Record<string, unknown> | undefined)?.recentDays ?? null) : (a.exclude_recent_days > 0 ? a.exclude_recent_days : null),
      excludeEventBuyers: a.exclude_event_buyers ?? (isCreate ? false : (current?.exclusions as Record<string, unknown> | undefined)?.excludeEventBuyers ?? false),
    };
  }
  const theme = themeFromInput(a.theme);
  if (theme) payload.theme = theme;
  if (blocks) payload.blocks = blocks;

  const w = await rpc<CallEnvelope>(env, 'mcp_write', { p_access_hash: accessHash, p_tool: tool, p_args: payload }, 28_000);
  if (w.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
  const res = w.result ?? {};
  if (!w.ok || res.ok === false) {
    const code = String(res.error ?? w.error ?? 'internal');
    return {
      text: emailErrorText(code, { products: res.products, audience: res.audience, status: res.status, spaces: w.spaces }),
      isError: true,
      code,
      callId: w.call_id,
    };
  }

  const draftId = String(res.draft_id || '');
  const out = {
    saved: true,
    sent: false,
    draft: {
      id: draftId,
      name: res.name,
      status: 'draft',
      product: res.product,
      language: res.language,
      subject: res.subject,
      ab_test: res.ab_test,
      event: res.event,
      sections: res.sections,
      version: res.version,
    },
    ...(changes.length ? { changes } : {}),
    audience: res.audience,
    console_url: consoleUrl(String(res.product || 'suite'), draftId, res.venue_id as string | null, res.organizer_user_id as string | null),
    checks: {
      warnings: issueList(check.warnings),
      estimated_kb: check.estimated_kb,
      ...(removed.length ? { removed_by_yuno: removed } : {}),
    },
    space: w.space,
    next: 'The draft is in the Yuno Console at console_url (if it is open there, it updates by itself). Nothing is sent until the person reviews it and clicks send; the Console shows the email with live data and sends them a test on request. For further changes, pass draft.version as draft_version.',
  };
  return { text: JSON.stringify(out), isError: false, callId: w.call_id };
}

// ── Images ───────────────────────────────────────────────────────────────────

interface ImageArgs {
  space?: string;
  name?: string;
  url?: string;
  image?: { download_url?: string; file_id?: string; mime_type?: string; file_name?: string };
}

/**
 * add_email_image : ouvre un emplacement (mcp_write), puis y dépose l'image
 * collée dans le chat (ChatGPT : lien temporaire `image.download_url`) ou celle
 * d'un lien. Sans fichier, ou si le téléchargement échoue, rend le lien de la
 * page où le pro colle ou dépose l'image lui-même.
 */
export async function runAddEmailImage(env: McpEnv, accessHash: string, a: ImageArgs, origin: string): Promise<EmailToolOutcome> {
  const source = a.image?.download_url ? 'chat_file' : a.url ? 'url' : 'upload';
  const name = a.name || a.image?.file_name || undefined;
  const w = await rpc<CallEnvelope>(env, 'mcp_write', {
    p_access_hash: accessHash,
    p_tool: 'add_email_image',
    p_args: { ...(a.space ? { space: a.space } : {}), ...(name ? { name: String(name).slice(0, 80) } : {}), source },
  }, 15_000);
  if (w.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
  const res = w.result ?? {};
  if (!w.ok || res.ok === false) {
    const code = String(res.error ?? w.error ?? 'internal');
    return { text: emailErrorText(code, { spaces: w.spaces }), isError: true, code, callId: w.call_id };
  }
  const code = String(res.code || '');
  const uploadPage = `${origin}/ai/image/${code}`;
  const waiting = (reason?: string) => ({
    text: JSON.stringify({
      ready: false,
      image_id: res.image_id,
      ...(reason ? { problem: imageFailureText(reason) } : {}),
      upload_page: uploadPage,
      upload_endpoint: `${origin}/mcp/image/${code}`,
      expires_at: res.expires_at,
      next: 'Give the person the upload_page link: they paste the image there (Ctrl+V or Cmd+V) or drop the file, in one step. '
        + 'If you can run code with internet access and hold the file, you may POST its bytes (or a multipart field "file") to upload_endpoint yourself. '
        + 'Then call list_email_images: the image gets its URL there, to use in an <img> of a section. The link works for 30 minutes.',
    }),
    isError: false,
    callId: w.call_id,
  });
  const from = a.image?.download_url || a.url;
  if (!from) return waiting();
  const fetched = await fetchRemoteImage(from);
  if (!fetched.ok) return waiting(fetched.reason);
  const stored = await storeSlotImage(env, code, fetched.bytes);
  if (!stored.ok) return waiting(stored.reason);
  return {
    text: JSON.stringify({
      ready: true,
      image: { ...stored.image, image_id: stored.image.image_id ?? res.image_id },
      how_to_use: `Use the URL in an <img> of a section: <img src="${stored.image.url}" width="…" alt="…" style="display:block;width:100%;max-width:…px;height:auto;border:0">. `
        + `It is ${stored.image.width}×${stored.image.height} px: keep that ratio.`,
    }),
    isError: false,
    callId: w.call_id,
  };
}
