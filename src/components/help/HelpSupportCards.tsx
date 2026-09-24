import { useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, Mail, MessageSquare } from 'lucide-react';
import { CONTACT_COLOR, EMAIL_COLOR, INNER_BG, T1, T3, rgba } from './helpUi';

export const SUPPORT_EMAIL = 'contact@yunoapp.eu';

function ContactCard({ icon, color, title, desc, onClick, href, trailing }: {
  icon: ReactNode; color: string; title: string; desc: string; onClick?: () => void; href?: string; trailing?: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const style = {
    padding: '16px 18px',
    borderRadius: 16,
    background: hover
      ? `radial-gradient(ellipse 70% 80% at 0% 50%, ${rgba(color, 0.14)} 0%, transparent 60%), rgb(var(--ink)/0.045)`
      : `radial-gradient(ellipse 70% 80% at 0% 50%, ${rgba(color, 0.07)} 0%, transparent 60%), ${INNER_BG}`,
    border: `1px solid ${hover ? rgba(color, 0.4) : rgba(color, 0.18)}`,
  } as const;
  const inner = (
    <>
      <div
        className="flex-none flex items-center justify-center transition-all duration-150"
        style={{
          width: 42, height: 42, borderRadius: 13,
          background: rgba(color, hover ? 0.2 : 0.13),
          border: `1px solid ${rgba(color, hover ? 0.5 : 0.3)}`,
          color,
          boxShadow: hover ? `0 0 18px -6px ${rgba(color, 0.7)}` : undefined,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ color: T1, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.005em' }}>{title}</div>
        <div style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
      </div>
      <div className="flex-none transition-colors duration-150" style={{ color: hover ? color : T3 }}>{trailing}</div>
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

/** Les deux voies humaines : formulaire de support (bleu) et email (violet). */
export function HelpSupportCards({ t, onContact }: { t: (k: string) => string; onContact: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ContactCard
        icon={<MessageSquare style={{ width: 18, height: 18 }} aria-hidden="true" />}
        color={CONTACT_COLOR}
        title={t('ohelp.ui.contactTitle')}
        desc={t('ohelp.ui.contactDesc')}
        onClick={onContact}
        trailing={<ChevronRight className="w-4 h-4" aria-hidden="true" />}
      />
      <ContactCard
        icon={<Mail style={{ width: 18, height: 18 }} aria-hidden="true" />}
        color={EMAIL_COLOR}
        title={t('ohelp.ui.emailTitle')}
        desc={SUPPORT_EMAIL}
        href={`mailto:${SUPPORT_EMAIL}`}
        trailing={<ArrowUpRight className="w-4 h-4" aria-hidden="true" />}
      />
    </div>
  );
}
