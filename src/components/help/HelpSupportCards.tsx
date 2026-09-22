import { useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, Mail, MessageSquare } from 'lucide-react';
import { useHelpAssistant } from '@/lib/helpAssistant';
import { AskAiCard } from './HelpAskAi';
import { BORDER, INNER_BG, RED, T1, T2, T3 } from './helpUi';

export const SUPPORT_EMAIL = 'contact@yunoapp.eu';

function ContactCard({ icon, title, desc, onClick, href, trailing }: {
  icon: ReactNode; title: string; desc: string; onClick?: () => void; href?: string; trailing?: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const style = {
    padding: '16px 18px',
    borderRadius: 16,
    background: hover ? 'rgba(255,255,255,0.05)' : INNER_BG,
    border: `1px solid ${hover ? 'rgba(255,255,255,0.14)' : BORDER}`,
  } as const;
  const inner = (
    <>
      <div
        className="flex-none flex items-center justify-center transition-colors duration-150"
        style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: hover ? RED : T2 }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ color: T1, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.005em' }}>{title}</div>
        <div style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
      </div>
      <div className="flex-none" style={{ color: hover ? T1 : T3 }}>{trailing}</div>
    </>
  );
  const cls = 'w-full flex items-center gap-3.5 text-left cursor-pointer transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#E8192C]/60';
  if (href) {
    return (
      <a href={href} className={cls} style={style} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} style={style} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {inner}
    </button>
  );
}

/**
 * Bloc « Encore besoin d'aide ? » : l'assistant IA d'abord (quand il existe),
 * puis le formulaire de support, puis l'email. Du plus rapide au plus humain.
 */
export function HelpSupportCards({
  t, onContact, aiChips, aiPrompt, aiTitle, aiDesc,
}: {
  t: (k: string) => string;
  onContact: () => void;
  aiChips?: string[];
  aiPrompt?: (q: string) => string;
  aiTitle?: string;
  aiDesc?: string;
}) {
  const ai = useHelpAssistant();
  return (
    <div className="space-y-3">
      {ai && (
        <AskAiCard
          t={t}
          title={aiTitle ?? t('ohelp.ui.aiCardTitle')}
          desc={aiDesc ?? t('ohelp.ui.aiCardDesc')}
          chips={aiChips}
          buildPrompt={aiPrompt}
        />
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ContactCard
          icon={<MessageSquare className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} aria-hidden="true" />}
          title={t('ohelp.ui.contactTitle')}
          desc={t('ohelp.ui.contactDesc')}
          onClick={onContact}
          trailing={<ChevronRight className="w-4 h-4" aria-hidden="true" />}
        />
        <ContactCard
          icon={<Mail style={{ width: 18, height: 18 }} aria-hidden="true" />}
          title={t('ohelp.ui.emailTitle')}
          desc={SUPPORT_EMAIL}
          href={`mailto:${SUPPORT_EMAIL}`}
          trailing={<ArrowUpRight className="w-4 h-4" aria-hidden="true" />}
        />
      </div>
    </div>
  );
}
