/**
 * Connecteurs › Assistants IA (2026-10-19, demande de Paul avant l'ouverture
 * de Yuno CRM). Le pro branche SON IA sur ses chiffres Yuno par le serveur MCP
 * (https://yunoapp.eu/mcp, docs/MCP.md) :
 *
 *   section    trois cartes : Claude (disponible, ou « Connecté » avec ses
 *              lectures), ChatGPT et Gemini (« Bientôt disponible »)
 *   ?v=claude  le guide, comme Stripe dans Claude : « Ouvrir Yuno dans
 *              Claude » (fiche de l'annuaire, `claude.ai/directory/yuno-mcp`)
 *              → « Connecter » → la fenêtre Yuno, déjà connectée (elle passe
 *              sur crm.yunoapp.eu pour un client CRM, src/lib/productHint.ts)
 *              → « Autoriser Claude ». Puis des premières questions, et « C'est
 *              branché » dès que la connexion arrive (relue toutes les 4 s).
 *              L'ajout manuel (adresse à coller) n'est plus qu'un secours replié.
 *              `&c=code` : Claude Code.
 *
 * Rien ne se branche depuis Yuno : c'est Claude qui ajoute le connecteur et la
 * personne qui autorise (/connect-ai). Couper une connexion =
 * `mcp_revoke_connection`, comme Réglages › Assistants IA de la Billetterie.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Segmented } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { rpc } from '@/crm/lib/rpc';
import { useAiConnections } from '@/crm/data/plan';
import { MCP_SERVER_URL, type McpConnection } from '@/lib/mcp';
import { AI_BRAND_PATHS, type AiBrand } from '@/crm/assets/aiBrands';
import { CLAUDE_CODE_COMMAND, CLAUDE_CONNECTORS_URL, CLAUDE_DIRECTORY_URL } from '@/crm/lib/aiConnect';
import { BackLink, GradientCta } from './connectorsUi';
import { CARD, ENTER } from './connectorsStyle';

const EXT = 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6';
const PROMPTS = ['lastNight', 'target', 'draft', 'compare'] as const;

const BRAND_BG: Record<AiBrand, string> = {
  claude: '#D97757',
  chatgpt: '#0F0F0F',
  gemini: 'linear-gradient(135deg,#4285F4 0%,#9B72CB 55%,#D96570 100%)',
};

function BrandTile({ brand, size = 56 }: { brand: AiBrand; size?: number }) {
  return (
    <span aria-hidden style={{ flex: 'none', width: size, height: size, borderRadius: Math.round(size * 0.27), background: BRAND_BG[brand], display: 'grid', placeItems: 'center', boxShadow: '0 0 0 1px rgba(28,21,23,.08),var(--shadow-xs)' }}>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.54)} height={Math.round(size * 0.54)} fill="#fff"><path d={AI_BRAND_PATHS[brand]} /></svg>
    </span>
  );
}

/** Connexions actives de cet espace (les siennes et, pour le titulaire, celles de l'équipe). */
function useSpaceConnections(poll = false) {
  const { space } = useCrmScope();
  const q = useAiConnections(poll ? { refetchInterval: 4000 } : undefined);
  const list = (q.data ?? []).filter((c) => !c.revoked_at && c.spaces.some((s) => s.key === space.key));
  return { q, list };
}

function useCopy() {
  const toast = useCrmToast();
  return async (value: string, done: string) => {
    try { await navigator.clipboard.writeText(value); toast(done); } catch { /* le texte reste sélectionnable */ }
  };
}

const pill = (bg: string, fg: string): CSSProperties => ({ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: bg, color: fg, whiteSpace: 'nowrap' });

// ── Section de la liste ──────────────────────────────────────────────────

export function AiConnectorsSection({ onGuide }: { onGuide: () => void }) {
  const { t, dShort } = useCrmT();
  const { list } = useSpaceConnections();
  const claude = list[0] ?? null;
  const calls = list.reduce((s, c) => s + (c.calls_count || 0), 0);

  return (
    <section aria-labelledby="yc-ai-h" style={{ display: 'flex', flexDirection: 'column', gap: 18, ...ENTER }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.ai.kick')}</span>
        <h2 id="yc-ai-h" style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,2.4vw,30px)', lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('yc.ai.h2')}</h2>
        <p style={{ margin: 0, maxWidth: 680, fontSize: 15.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.ai.sub')}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 14 }}>
        <div style={{ ...CARD, gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <BrandTile brand="claude" size={52} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>Claude</b>
                {claude
                  ? <span style={pill('var(--green-50)', 'var(--green-700)')}><span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t('yc.ai.connected')}</span>
                  : <span style={pill('var(--red-50)', 'var(--red-700)')}>{t('yc.ai.available')}</span>}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.ai.claude.where')}</span>
            </div>
          </div>
          <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-700)', textWrap: 'pretty' }}>
            {claude ? t('yc.ai.claude.on', { date: dShort(claude.created_at), n: calls }) : t('yc.ai.claude.d')}
          </span>
          <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {claude ? (
              <Hv as="button" type="button" onClick={onGuide} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--shadow-xs)' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
                {t('yc.ai.manage')}
              </Hv>
            ) : (
              <span data-yc-guide="claude-add" style={{ display: 'inline-flex' }}>
                <GradientCta onClick={() => {
                  // Dans le geste du clic (Safari bloque une fenêtre ouverte après un await).
                  window.open(CLAUDE_DIRECTORY_URL, '_blank', 'noopener');
                  onGuide();
                }}>{t('yc.ai.addToClaude')}</GradientCta>
              </span>
            )}
          </div>
        </div>
        {(['chatgpt', 'gemini'] as const).map((b) => (
          <div key={b} style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ opacity: 0.55 }}><BrandTile brand={b} size={52} /></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', color: 'var(--sand-700)' }}>{b === 'chatgpt' ? 'ChatGPT' : 'Gemini'}</b>
                  <span style={pill('var(--sand-100)', 'var(--sand-600)')}>{t('yc.ai.soon')}</span>
                </span>
                <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t(`yc.ai.${b}.where`)}</span>
              </div>
            </div>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.ai.soonD', { app: b === 'chatgpt' ? 'ChatGPT' : 'Gemini' })}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Le guide ───────────────────────────────────────────────────────────────

function Step({ n, last, title, children }: { n: number; last?: boolean; title: string; children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 16 }}>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ width: 32, height: 32, borderRadius: 99, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 600 }}>{n}</span>
        {!last && <span style={{ flex: 1, width: 1, background: 'var(--sand-200)', margin: '6px 0' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: last ? '3px 0 0' : '3px 0 26px' }}>
        <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</span>
        {children}
      </div>
    </li>
  );
}

const body: CSSProperties = { margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' };
const kbd: CSSProperties = { padding: '1px 8px', borderRadius: 8, background: 'var(--sand-100)', color: 'var(--ink)', fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap' };

/** Une valeur à copier (adresse, commande) : police mono, bouton « Copier ». */
function CopyBox({ value, label, done, text = false }: { value: string; label: string; done: string; text?: boolean }) {
  const { t } = useCrmT();
  const copy = useCopy();
  const [ok, setOk] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, paddingLeft: 16, borderRadius: 16, background: '#fff', boxShadow: 'inset 0 0 0 1.5px var(--sand-200)' }}>
      <code aria-label={label} style={text
        ? { flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 14.5, lineHeight: 1.45, color: 'var(--ink)', padding: '6px 0', userSelect: 'all' }
        : { flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--ink)', overflowX: 'auto', whiteSpace: 'nowrap', userSelect: 'all' }}>{value}</code>
      <Hv as="button" type="button" onClick={() => { void copy(value, done); setOk(true); window.setTimeout(() => setOk(false), 1800); }}
        style={{ flex: 'none', height: 38, padding: '0 14px', borderRadius: 12, border: 0, background: ok ? 'var(--green-50)' : 'var(--ink)', color: ok ? 'var(--green-700)' : '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
        hover={ok ? undefined : { background: 'var(--sand-700)' }}>
        <Icon name={ok ? 'check' : 'copy'} size={15} stroke={2.4} />{t(ok ? 'yc.ai.copied' : 'yc.ai.copy')}
      </Hv>
    </div>
  );
}

function OutLink({ href, children, tone = 'light' }: { href: string; children: ReactNode; tone?: 'light' | 'claude' }) {
  const claude = tone === 'claude';
  return (
    <Hv as="a" href={href} target="_blank" rel="noopener noreferrer"
      style={{ alignSelf: 'flex-start', minHeight: 40, boxSizing: 'border-box', padding: '8px 14px 8px 16px', borderRadius: 99, lineHeight: 1.25, border: claude ? 0 : '1px solid var(--sand-200)', background: claude ? '#D97757' : '#fff', color: claude ? '#fff' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', boxShadow: 'var(--shadow-xs)' }}
      hover={claude ? { filter: 'brightness(1.06)', color: '#fff', textDecoration: 'none' } : { borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none' }}>
      {children}<Icon d={EXT} size={14} stroke={2.4} />
    </Hv>
  );
}

/** Aperçu de la fiche Yuno dans l'annuaire de Claude : le bouton à cliquer. */
function ListingMock() {
  const { t } = useCrmT();
  return (
    <figure aria-label={t('yc.ai.mock.label')} style={{ margin: 0, maxWidth: 440, padding: 16, borderRadius: 18, background: '#F7F5F0', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/icon-512.png" alt="" width={40} height={40} style={{ flex: 'none', borderRadius: 10, boxShadow: '0 0 0 1px rgba(28,21,23,.08)' }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 15.5, fontWeight: 600 }}>Yuno MCP</b>
            <span style={{ height: 20, padding: '0 7px', borderRadius: 6, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontSize: 11, fontWeight: 600, color: 'var(--sand-600)', display: 'inline-flex', alignItems: 'center' }}>{t('yc.ai.mock.community')}</span>
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.ai.mock.by')}</span>
        </div>
        <span style={{ flex: 'none', height: 34, padding: '0 14px', borderRadius: 10, background: 'var(--ink)', color: '#fff', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', boxShadow: '0 0 0 3px rgba(217,119,87,.35)' }}>{t('yc.ai.mock.connect')}</span>
      </div>
      <figcaption style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t('yc.ai.mock.caption')}</figcaption>
    </figure>
  );
}

function WhatClaudeDoes() {
  const { t } = useCrmT();
  return (
    <aside style={{
      flex: '1 1 300px', minWidth: 0, position: 'relative', overflow: 'hidden', isolation: 'isolate', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20, padding: 28, borderRadius: 28, alignSelf: 'flex-start',
      color: 'var(--text-on-night)', background: 'radial-gradient(90% 70% at 100% 110%,rgba(217,119,87,.42),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.ai.re.k')}</span>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 14 }}>
          <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px var(--border-night)', display: 'grid', placeItems: 'center', color: i === 3 ? '#FFB4A2' : '#7CE0A2' }}>
            <Icon name={i === 3 ? 'lock' : 'check'} size={14} stroke={2.6} />
          </span>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-on-night-2)', textWrap: 'pretty' }}>
            <b style={{ fontWeight: 600, color: '#fff' }}>{t(`yc.ai.re${i}b`)}</b> {t(`yc.ai.re${i}t`)}
          </span>
        </div>
      ))}
    </aside>
  );
}

/** Les IA branchées sur cet espace, avec « Couper l'accès ». */
function Connections({ list }: { list: McpConnection[] }) {
  const { t, dShort, time } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const [cut, setCut] = useState<McpConnection | null>(null);
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;
  const revoke = async () => {
    if (!cut) return;
    setBusy(true);
    try {
      const r = await rpc<{ ok?: boolean }>('mcp_revoke_connection', { p_grant_id: cut.id });
      if (!r?.ok) throw new Error('revoke');
      toast(t('yc.ai.cutDone', { app: cut.client_name }));
      await qc.invalidateQueries({ queryKey: ['crm', 'ai-connections'] });
      setCut(null);
    } catch {
      toast(t('yc.ai.cutFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.ai.list')}</span>
      {list.map((c) => (
        <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '14px 16px', borderRadius: 18, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <BrandTile brand="claude" size={36} />
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <b style={{ fontSize: 15, fontWeight: 600 }}>{c.client_name}{!c.mine && c.person ? <span style={{ fontWeight: 500, color: 'var(--sand-500)' }}> · {c.person}</span> : null}</b>
            <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>
              {[t('yc.ai.since', { date: dShort(c.created_at) }), t(c.level === 'customers' ? 'yc.ai.level.customers' : 'yc.ai.level.analytics'),
                c.last_used_at ? t('yc.ai.lastUsed', { date: dShort(c.last_used_at), time: time(c.last_used_at) }) : t('yc.ai.neverUsed')].join(' · ')}
            </span>
          </div>
          <Hv as="button" type="button" onClick={() => setCut(c)} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', color: 'var(--red-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>
            {t('yc.ai.cut')}
          </Hv>
        </div>
      ))}
      <Modal open={!!cut} onClose={() => setCut(null)} width={460} label={t('yc.ai.cut')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('yc.ai.cutTitle', { app: cut?.client_name ?? 'Claude' })}</h2>
          <p style={body}>{t('yc.ai.cutBody')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setCut(null)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
            <Hv as="button" type="button" onClick={() => void revoke()} disabled={busy} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--red-600)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1 }}>{t('yc.ai.cut')}</Hv>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function ClaudeGuide({ code, go }: { code: boolean; go: (p: Record<string, string> | null) => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const { list } = useSpaceConnections(true);
  // « C'est branché » : une connexion de cet espace, arrivée pendant le guide ou avant.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(list.map((c) => c.id));
    if (seen.current) {
      const fresh = list.find((c) => !seen.current?.has(c.id));
      if (fresh) toast(t('yc.ai.liveToast', { app: fresh.client_name }));
    }
    seen.current = ids;
  }, [list, t, toast]);
  const connected = list.length > 0;
  const prompts = PROMPTS.map((k) => t(`yc.ai.q.${k}`));
  const copy = useCopy();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, ...ENTER }}>
      <BackLink onClick={() => go(null)} label={t('yc.ai.back')} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 20px' }}>
        <BrandTile brand="claude" size={60} />
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.ai.g.kick')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{t('yc.ai.g.h1')}</h1>
          <p style={{ margin: 0, maxWidth: 640, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.ai.g.sub')}</p>
        </div>
      </div>

      <div role="status" aria-live="polite" style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 18, fontSize: 14.5, lineHeight: 1.45,
        background: connected ? 'var(--green-50)' : 'var(--sand-50)', boxShadow: `inset 0 0 0 1px ${connected ? 'rgba(22,163,74,.28)' : 'var(--sand-200)'}`,
        color: connected ? 'var(--green-700)' : 'var(--sand-700)', transition: `background 300ms ${EASE}`,
      }}>
        {connected
          ? <span style={{ flex: 'none', width: 26, height: 26, borderRadius: 99, background: 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={14} stroke={3} /></span>
          : <span style={{ flex: 'none', width: 10, height: 10, margin: '0 8px', borderRadius: 99, background: 'var(--amber-500)', animation: 'yc-pulse 1.6s ease-in-out infinite' }} />}
        <span>{connected ? t('yc.ai.g.on', { app: list[0].client_name, space: space.name }) : t('yc.ai.g.wait', { space: space.name })}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ ...CARD, flex: '1 1 560px', minWidth: 0 }}>
          <Segmented<'web' | 'code'>
            value={code ? 'code' : 'web'}
            onChange={(v) => go(v === 'code' ? { v: 'claude', c: 'code' } : { v: 'claude' })}
            ariaLabel={t('yc.ai.g.where')}
            options={[{ value: 'web', label: t('yc.ai.g.tabWeb') }, { value: 'code', label: t('yc.ai.g.tabCode') }]}
          />
          {!code ? (
            <div key="web" style={{ display: 'flex', flexDirection: 'column', gap: 18, animation: `yc-rise 500ms ${EASE} both` }}>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                <Step n={1} title={t('yc.ai.w1.t')}>
                  <p style={body}>{t('yc.ai.w1.s1')} <span style={kbd}>{t('yc.ai.mock.connect')}</span>{t('yc.ai.w1.s2')}</p>
                  <span data-yc-guide="claude-add" style={{ display: 'inline-flex', alignSelf: 'flex-start' }}><OutLink href={CLAUDE_DIRECTORY_URL} tone="claude">{t('yc.ai.w1.open')}</OutLink></span>
                  <ListingMock />
                </Step>
                <Step n={2} title={t('yc.ai.w2.t', { space: space.name })}>
                  <p style={body}>{t('yc.ai.w2.s1', { space: space.name })} <span style={kbd}>{t('yc.ai.w2.allow')}</span>{t('yc.ai.w2.s2')}</p>
                </Step>
                <Step n={3} last title={t('yc.ai.w3.t')}>
                  <p style={body}>{t('yc.ai.w3.s1')} <span style={kbd}>+</span>{t('yc.ai.w3.s2')} <span style={kbd}>{t('yc.ai.w3.connectors')}</span>{t('yc.ai.w3.s3')}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {prompts.map((p) => (
                      <div key={p} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 10px 10px 14px', borderRadius: 14, background: 'var(--sand-50)' }}>
                        <span style={{ flex: '1 1 240px', minWidth: 0, fontSize: 14.5, lineHeight: 1.45 }}>« {p} »</span>
                        <span style={{ flex: 'none', display: 'flex', gap: 6 }}>
                          <Hv as="button" type="button" aria-label={t('yc.ai.copy')} onClick={() => { void copy(p, t('yc.ai.qCopied')); }} style={{ width: 34, height: 34, borderRadius: 10, border: 0, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>
                            <Icon name="copy" size={14} stroke={2.2} />
                          </Hv>
                          <Hv as="a" href={`https://claude.ai/new?q=${encodeURIComponent(p)}`} target="_blank" rel="noopener noreferrer" style={{ height: 34, padding: '0 12px', borderRadius: 10, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ background: 'var(--paper)', color: 'var(--ink)', textDecoration: 'none' }}>
                            {t('yc.ai.ask')}<Icon d={EXT} size={12} stroke={2.4} />
                          </Hv>
                        </span>
                      </div>
                    ))}
                  </div>
                </Step>
              </ol>
              <details style={{ borderRadius: 16, background: 'var(--sand-50)', padding: '0 16px' }}>
                <summary style={{ cursor: 'pointer', padding: '14px 0', fontSize: 14.5, fontWeight: 600, listStyle: 'revert' }}>{t('yc.ai.fb.t')}</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>
                  <p style={body}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.ai.fb.teamT')}</b> {t('yc.ai.fb.team')}</p>
                  <p style={body}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.ai.fb.manualT')}</b> {t('yc.ai.fb.manual1')} <span style={kbd}>{t('yc.ai.fb.add')}</span> {t('yc.ai.fb.manual2')} <span style={kbd}>{t('yc.ai.fb.custom')}</span>{t('yc.ai.fb.manual3')}</p>
                  <CopyBox value={MCP_SERVER_URL} label={t('yc.ai.url')} done={t('yc.ai.urlCopied')} />
                  <OutLink href={CLAUDE_CONNECTORS_URL}>{t('yc.ai.fb.open')}</OutLink>
                </div>
              </details>
            </div>
          ) : (
            <ol key="code" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', animation: `yc-rise 500ms ${EASE} both` }}>
              <Step n={1} title={t('yc.ai.c1.t')}>
                <p style={body}>{t('yc.ai.c1.s')}</p>
                <CopyBox value={CLAUDE_CODE_COMMAND} label={t('yc.ai.cmd')} done={t('yc.ai.cmdCopied')} />
              </Step>
              <Step n={2} title={t('yc.ai.c2.t')}>
                <p style={body}>{t('yc.ai.c2.s1')} <span style={kbd}>/mcp</span>{t('yc.ai.c2.s2')} <span style={kbd}>yuno</span>{t('yc.ai.c2.s3')} <span style={kbd}>Authenticate</span>{t('yc.ai.c2.s4', { space: space.name })}</p>
              </Step>
              <Step n={3} last title={t('yc.ai.c3.t')}>
                <p style={body}>{t('yc.ai.c3.s')}</p>
                <CopyBox value={prompts[0]} label={t('yc.ai.q.label')} done={t('yc.ai.qCopied')} text />
              </Step>
            </ol>
          )}
          {code && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 10, background: '#fff', color: 'var(--sand-700)', display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}><Icon name="help" size={15} stroke={2} /></span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.ai.plans.t')}</b> {t('yc.ai.plans.code')}</span>
            </div>
          )}
          <Connections list={list} />
        </div>
        <WhatClaudeDoes />
      </div>
    </div>
  );
}
