/**
 * « Préparer avec mon IA » (agents, décisions 6 et 7 de Paul, 08/10). Yuno
 * n'appelle aucune IA : le bouton ouvre l'IA que la personne a branchée sur
 * Yuno (connexion MCP) avec la demande écrite. Sans connexion, il explique
 * comment en brancher une ; une connexion sans le droit voulu (brouillons
 * d'e-mails, de scénarios) le dit ; une IA sans application web (Claude Code,
 * Le Chat…) reçoit la demande à copier.
 */
import { useState } from 'react';
import { Modal, PillButton } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useAiConnections } from '@/crm/data/plan';
import { aiAppFor, askAiUrl, pickConnection, type AiApp, type AiNeed } from '@/crm/lib/askAi';
import { MCP_SERVER_URL } from '@/lib/mcp';

const APP_NAME: Record<AiApp, string> = { claude: 'Claude', chatgpt: 'ChatGPT' };
const GUIDE_URL = 'https://yunoapp.eu/ai';

type Panel = null | { kind: 'none' } | { kind: 'right'; client: string; app: AiApp | null } | { kind: 'copy'; client: string };

export function AskMyAiButton({ text, need, tone = 'light', size = 'md' }: {
  /** La demande, déjà écrite dans la langue de la personne. */
  text: string;
  need: AiNeed;
  tone?: 'dark' | 'light';
  size?: 'sm' | 'md';
}) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const conns = useAiConnections();
  const [panel, setPanel] = useState<Panel>(null);

  const open = (app: AiApp) => {
    // Ouvert dans le geste du clic (jamais après un await : Safari le bloquerait).
    window.open(askAiUrl(app, text), '_blank', 'noopener');
    toast(t('yc.ag.ai.opened', { app: APP_NAME[app] }));
    setPanel(null);
  };

  const go = () => {
    const { conn, right } = pickConnection(conns.data ?? [], space.key, need);
    if (!conn) { setPanel({ kind: 'none' }); return; }
    const app = aiAppFor(conn.client_name);
    if (!right) { setPanel({ kind: 'right', client: conn.client_name, app }); return; }
    if (!app) { setPanel({ kind: 'copy', client: conn.client_name }); return; }
    open(app);
  };

  const copy = async (value: string, done: string) => {
    try { await navigator.clipboard.writeText(value); toast(done); } catch { /* le texte reste sélectionnable */ }
  };

  return (
    <>
      <PillButton tone={tone} size={size} icon="sparkles" onClick={go} disabled={conns.isLoading}>{t('yc.ag.ai.button')}</PillButton>
      <Modal open={panel !== null} onClose={() => setPanel(null)} width={520} label={t('yc.ag.ai.button')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {panel?.kind === 'none' && (
            <>
              <h2 style={titleStyle}>{t('yc.ag.ai.none.title')}</h2>
              <p style={pStyle}>{t('yc.ag.ai.none.body')}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 14, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
                <code style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 13.5, overflowWrap: 'anywhere' }}>{MCP_SERVER_URL}</code>
                <PillButton size="sm" tone="light" icon="copy" onClick={() => { void copy(MCP_SERVER_URL, t('yc.ag.ai.none.copied')); }}>{t('yc.ag.ai.none.copy')}</PillButton>
              </div>
              <p style={pStyle}>{t('yc.ag.ai.none.after')}</p>
              <div style={rowStyle}>
                <PillButton tone="ghost" onClick={() => setPanel(null)}>{t('yc.ag.ai.close')}</PillButton>
                <PillButton tone="dark" onClick={() => { window.open(GUIDE_URL, '_blank', 'noopener'); }}>{t('yc.ag.ai.none.guide')}</PillButton>
              </div>
            </>
          )}
          {panel?.kind === 'right' && (
            <>
              <h2 style={titleStyle}>{t('yc.ag.ai.right.title')}</h2>
              <p style={pStyle}>{t(need === 'scenarios' ? 'yc.ag.ai.right.scenarios' : 'yc.ag.ai.right.drafts', { client: panel.client })}</p>
              <div style={rowStyle}>
                <PillButton tone="ghost" onClick={() => setPanel(null)}>{t('yc.ag.ai.close')}</PillButton>
                <PillButton tone="dark" onClick={() => (panel.app ? open(panel.app) : setPanel({ kind: 'copy', client: panel.client }))}>{t('yc.ag.ai.right.go')}</PillButton>
              </div>
            </>
          )}
          {panel?.kind === 'copy' && (
            <>
              <h2 style={titleStyle}>{t('yc.ag.ai.copy.title')}</h2>
              <p style={pStyle}>{t('yc.ag.ai.copy.body', { client: panel.client })}</p>
              <textarea readOnly value={text} rows={6} onFocus={(e) => e.currentTarget.select()}
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 12, borderRadius: 14, border: '1px solid var(--sand-200)', fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', color: 'var(--ink)', background: 'var(--sand-50)' }} />
              <div style={rowStyle}>
                <PillButton tone="ghost" onClick={() => setPanel(null)}>{t('yc.ag.ai.close')}</PillButton>
                <PillButton tone="dark" icon="copy" onClick={() => { void copy(text, t('yc.ag.ai.copy.done')); }}>{t('yc.ag.ai.copy.btn')}</PillButton>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

const titleStyle = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.15 } as const;
const pStyle = { margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--sand-700)', textWrap: 'pretty' } as const;
const rowStyle = { display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, paddingTop: 4 } as const;
