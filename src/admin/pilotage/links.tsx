/** Un lien texte aux couleurs du kit (adresses des fiches : ./format.ts). */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function TextLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} onClick={(e) => e.stopPropagation()}
      className={`a-focus a-t1 min-w-0 truncate underline decoration-[var(--a-border-strong)] underline-offset-2 hover:decoration-[var(--a-text)] ${className ?? ''}`}>
      {children}
    </Link>
  );
}
